import {NextRequest,NextResponse} from "next/server";
import bcrypt from "bcryptjs";
import {sql} from "@/lib/db";
import {createSession,currentUser,destroySession,requireUser} from "@/lib/auth";
const json=(data:unknown,status=200)=>NextResponse.json(data,{status});
const failure=(e:unknown)=>{
  const message=e instanceof Error?e.message:"";
  if(message==="UNAUTHORIZED")return json({error:"Sessione scaduta o non autorizzata"},401);
  if(message==="BUSY")return json({error:"Tavolo già occupato"},409);
  if(message==="CLOSED")return json({error:"Ordine già chiuso"},409);
  return json({error:"Operazione non riuscita"},500);
};

export async function GET(req:NextRequest){
  const action=req.nextUrl.searchParams.get("action");
  try{
    if(action==="setupStatus"){const [{available}]=await sql`select not exists(select 1 from users where role='ADMIN') available`;return json({available})}
    if(action==="me"){const session=await currentUser();if(session)await createSession(session);return json({user:session})}
    const user=await requireUser();
    if(action==="state"){
      const [settings]=await sql`select * from app_settings limit 1`;
      const tables=await sql`select t.*,u.display_name waiter_name,o.id order_id,o.account_name,o.total from restaurant_tables t left join users u on u.id=t.assigned_waiter_id left join orders o on o.table_id=t.id and o.status='APERTO' where t.active=true order by t.table_number`;
      const menuCategories=user.role==="ADMIN"?await sql`select * from menu_categories order by display_order,name`:await sql`select * from menu_categories where active=true order by display_order,name`;
      const menu=user.role==="ADMIN"?await sql`select m.*,c.name category from menu_items m join menu_categories c on c.id=m.category_id order by c.display_order,m.display_order,m.name`:await sql`select m.*,c.name category from menu_items m join menu_categories c on c.id=m.category_id where m.active=true and c.active=true order by c.display_order,m.display_order,m.name`;
      const workEvenings=user.role==="ADMIN"?await sql`select * from work_evenings order by work_date`:await sql`select * from work_evenings where active=true`;
      const directOrders=user.role==="CAMERIERE"?[]:await sql`select o.id order_id,o.account_name,o.total,u.display_name waiter_name from orders o join users u on u.id=o.waiter_id where o.table_id is null and o.status='APERTO' order by o.opened_at`;
      return json({user,settings,tables,menuCategories,menu,workEvenings,directOrders});
    }
    if(action==="order"){
      const id=req.nextUrl.searchParams.get("id");
      const [order]=await sql`select o.*,t.table_number,u.display_name waiter_name from orders o left join restaurant_tables t on t.id=o.table_id join users u on u.id=o.waiter_id where o.id=${id||0} and o.status='APERTO'`;
      if(!order)return json({error:"Ordine non trovato"},404);
      if(user.role==="CAMERIERE"&&order.waiter_id!==user.id)return json({error:"Ordine assegnato a un altro cameriere"},403);
      const items=await sql`select * from order_items where order_id=${order.id} order by id`;
      return json({order,items});
    }
    if(action==="receipt"){
      await requireUser(["ADMIN","CASSIERE"]);
      const id=req.nextUrl.searchParams.get("id");
      const [order]=await sql`select o.*,t.table_number,u.display_name waiter_name,c.display_name cashier_name,w.work_date from orders o left join restaurant_tables t on t.id=o.table_id join users u on u.id=o.waiter_id left join users c on c.id=o.cashier_id join work_evenings w on w.id=o.work_evening_id where o.id=${id||0} and o.status='CHIUSO'`;
      if(!order)return json({error:"Ricevuta non trovata"},404);
      const items=await sql`select item_name,unit_price,quantity,subtotal from order_items where order_id=${order.id} order by id`;
      const [settings]=await sql`select * from app_settings limit 1`;
      return json({order,items,settings});
    }
    if(action==="orders"){
      if(user.role==="CAMERIERE")return json({error:"Non autorizzato"},403);
      const orders=user.role==="CASSIERE"
        ?await sql`select o.*,t.table_number,u.display_name waiter_name,c.display_name cashier_name from orders o left join restaurant_tables t on t.id=o.table_id join users u on u.id=o.waiter_id left join users c on c.id=o.cashier_id join work_evenings w on w.id=o.work_evening_id where o.status='CHIUSO' and w.active=true order by o.closed_at desc`
        :await sql`select o.*,t.table_number,u.display_name waiter_name,c.display_name cashier_name from orders o left join restaurant_tables t on t.id=o.table_id join users u on u.id=o.waiter_id left join users c on c.id=o.cashier_id where o.status='CHIUSO' order by o.closed_at desc`;
      return json({orders});
    }
    if(action==="stats"){
      await requireUser(["ADMIN"]);
      const [summary]=await sql`select count(*) filter(where status='CHIUSO')::int orders_count,coalesce(sum(total) filter(where status='CHIUSO'),0)::numeric revenue,coalesce(avg(total) filter(where status='CHIUSO'),0)::numeric average_order,count(distinct work_evening_id) filter(where status='CHIUSO')::int evenings_count,coalesce(sum(total) filter(where status='APERTO'),0)::numeric open_total from orders`;
      const evenings=await sql`select w.work_date,count(o.id)::int orders_count,coalesce(sum(o.total),0)::numeric revenue from work_evenings w left join orders o on o.work_evening_id=w.id and o.status='CHIUSO' group by w.id,w.work_date order by w.work_date desc`;
      const products=await sql`select m.id,m.name item_name,coalesce((select sum(oi.quantity)::int from order_items oi join orders o on o.id=oi.order_id where oi.menu_item_id=m.id and o.status='CHIUSO'),0) quantity,coalesce((select sum(oi.subtotal)::numeric from order_items oi join orders o on o.id=oi.order_id where oi.menu_item_id=m.id and o.status='CHIUSO'),0) revenue,coalesce((select json_agg(d order by d.work_date) from (select w.work_date,sum(oi.quantity)::int quantity,sum(oi.subtotal)::numeric revenue from order_items oi join orders o on o.id=oi.order_id join work_evenings w on w.id=o.work_evening_id where oi.menu_item_id=m.id and o.status='CHIUSO' group by w.work_date) d),'[]'::json) daily from menu_items m order by quantity desc,revenue desc,m.name`;
      const tables=await sql`select t.id,t.table_number,count(o.id)::int orders_count,coalesce(sum(o.total),0)::numeric revenue from restaurant_tables t left join orders o on o.table_id=t.id and o.status='CHIUSO' group by t.id,t.table_number order by t.table_number`;
      const waiters=await sql`select u.id,u.display_name,count(o.id)::int orders_count,coalesce(sum(o.total),0)::numeric revenue from users u left join orders o on o.waiter_id=u.id and o.status='CHIUSO' where u.role='CAMERIERE' group by u.id,u.display_name order by revenue desc,u.display_name`;
      return json({summary,evenings,products,tables,waiters});
    }
    if(action==="users"){await requireUser(["ADMIN"]);return json({users:await sql`select id,display_name,username,role,active from users order by created_at`})}
    return json({error:"Azione non valida"},400);
  }catch(e){return failure(e)}
}

export async function POST(req:NextRequest){
  const b=await req.json();
  try{
    if(b.action==="setup"){
      const [{count}]=await sql`select count(*)::int count from users where role='ADMIN'`;
      if(count>0)return json({error:"Configurazione già effettuata"},409);
      if(!b.username||!b.password||b.password.length<8)return json({error:"Password minima: 8 caratteri"},400);
      const hash=await bcrypt.hash(b.password,12);
      const [u]=await sql`insert into users(display_name,username,password_hash,role) values(${b.displayName||"Amministratore"},${b.username.toLowerCase()},${hash},'ADMIN') returning id,display_name,username,role`;
      await createSession({id:u.id,displayName:u.display_name,username:u.username,role:u.role});return json({user:u},201);
    }
    if(b.action==="login"){
      const [u]=await sql`select * from users where lower(username)=lower(${b.username||""}) and active=true`;
      if(!u||!await bcrypt.compare(b.password||"",u.password_hash))return json({error:"Credenziali non valide"},401);
      await createSession({id:u.id,displayName:u.display_name,username:u.username,role:u.role});return json({user:u});
    }
    if(b.action==="logout"){await destroySession();return json({success:true})}
    const user=await requireUser();
    if(b.action==="createUser"){
      await requireUser(["ADMIN"]);if(!b.username||!b.password||b.password.length<8)return json({error:"Dati non validi"},400);
      try{const [u]=await sql`insert into users(display_name,username,password_hash,role) values(${b.displayName},${b.username.toLowerCase()},${await bcrypt.hash(b.password,12)},${b.role}) returning id,display_name,username,role`;return json({user:u},201)}
      catch{return json({error:"Username già utilizzato"},409)}
    }
    if(b.action==="toggleUser"){
      await requireUser(["ADMIN"]);if(!b.userId||b.userId===user.id)return json({error:"Non puoi disattivare il tuo account"},400);
      const [u]=await sql`update users set active=${Boolean(b.active)},updated_at=now() where id=${b.userId} and role<>'ADMIN' returning id,active`;
      if(!u)return json({error:"Utente non trovato"},404);return json({user:u});
    }
    if(b.action==="addTable"){
      await requireUser(["ADMIN"]);
      const tableNumber=Number(b.tableNumber);
      if(!Number.isInteger(tableNumber)||tableNumber<1)return json({error:"Inserisci un numero tavolo valido"},400);
      const [existing]=await sql`select id,active from restaurant_tables where table_number=${tableNumber}`;
      if(existing?.active)return json({error:"Questo numero tavolo esiste già"},409);
      const [t]=existing
        ?await sql`update restaurant_tables set active=true,status='LIBERO',assigned_waiter_id=null where id=${existing.id} returning *`
        :await sql`insert into restaurant_tables(table_number) values(${tableNumber}) returning *`;
      return json({table:t},201);
    }
    if(b.action==="updateTable"){
      await requireUser(["ADMIN"]);
      const tableNumber=Number(b.tableNumber);
      if(!b.tableId||!Number.isInteger(tableNumber)||tableNumber<1)return json({error:"Inserisci un numero tavolo valido"},400);
      const [duplicate]=await sql`select id from restaurant_tables where table_number=${tableNumber} and id<>${b.tableId}`;
      if(duplicate)return json({error:"Questo numero tavolo esiste già"},409);
      const [t]=await sql`update restaurant_tables set table_number=${tableNumber} where id=${b.tableId} and active=true and status='LIBERO' returning *`;
      if(!t)return json({error:"Il tavolo occupato non può essere modificato"},409);
      return json({table:t});
    }
    if(b.action==="deleteTable"){
      await requireUser(["ADMIN"]);
      if(!b.tableId)return json({error:"Tavolo non valido"},400);
      const [t]=await sql`update restaurant_tables set active=false,assigned_waiter_id=null where id=${b.tableId} and active=true and status='LIBERO' returning id`;
      if(!t)return json({error:"Il tavolo occupato non può essere eliminato"},409);
      return json({success:true});
    }
    if(b.action==="addMenuCategory"){
      await requireUser(["ADMIN"]);
      const name=String(b.name||"").trim();
      if(!name)return json({error:"Inserisci il nome della categoria"},400);
      const [duplicate]=await sql`select id from menu_categories where lower(name)=lower(${name})`;
      if(duplicate)return json({error:"Questa categoria esiste già"},409);
      const [category]=await sql`insert into menu_categories(name,display_order) values(${name},coalesce((select max(display_order)+1 from menu_categories),1)) returning id,name,display_order`;
      return json({category},201);
    }
    if(b.action==="updateMenuCategory"){
      await requireUser(["ADMIN"]);
      const name=String(b.name||"").trim();
      if(!b.categoryId||!name)return json({error:"Categoria non valida"},400);
      const [duplicate]=await sql`select id from menu_categories where lower(name)=lower(${name}) and id<>${b.categoryId}`;
      if(duplicate)return json({error:"Questa categoria esiste già"},409);
      const displayOrder=Number(b.displayOrder);
      const [category]=await sql`update menu_categories set name=${name},active=${b.active!==false},display_order=${Number.isInteger(displayOrder)?displayOrder:0} where id=${b.categoryId} returning *`;
      if(!category)return json({error:"Categoria non trovata"},404);
      return json({category});
    }
    if(b.action==="addMenuItem"||b.action==="updateMenuItem"){
      await requireUser(["ADMIN"]);
      const name=String(b.name||"").trim(),price=Number(b.price),displayOrder=Number(b.displayOrder);
      if(!name||!b.categoryId||!Number.isFinite(price)||price<0)return json({error:"Compila correttamente nome, categoria e prezzo"},400);
      const [category]=await sql`select id from menu_categories where id=${b.categoryId}`;
      if(!category)return json({error:"Categoria non trovata"},404);
      if(b.action==="addMenuItem"){
        const [item]=await sql`insert into menu_items(category_id,name,price,display_order) values(${b.categoryId},${name},${price},coalesce((select max(display_order)+1 from menu_items where category_id=${b.categoryId}),1)) returning *`;
        return json({item},201);
      }
      if(!b.itemId)return json({error:"Prodotto non valido"},400);
      const [item]=await sql`update menu_items set category_id=${b.categoryId},name=${name},price=${price},active=${b.active!==false},display_order=${Number.isInteger(displayOrder)?displayOrder:0},updated_at=now() where id=${b.itemId} returning *`;
      if(!item)return json({error:"Prodotto non trovato"},404);
      return json({item});
    }
    if(b.action==="openEvening"){await requireUser(["ADMIN"]);await sql.begin(async tx=>{await tx`update work_evenings set active=false,closed_at=case when active then now() else closed_at end`;await tx`update work_evenings set active=true,opened_at=coalesce(opened_at,now()),closed_at=null where work_date=${b.workDate}`});return json({success:true})}
    if(b.action==="saveSettings"){
      await requireUser(["ADMIN"]);
      const festivalName=String(b.festivalName||"").trim(),cellarName=String(b.cellarName||"").trim();
      if(!festivalName||!cellarName||!b.startDate||!b.endDate||b.endDate<b.startDate)return json({error:"Compila correttamente i dati della manifestazione"},400);
      await sql.begin(async tx=>{const updated=await tx`update app_settings set festival_name=${festivalName},cellar_name=${cellarName},start_date=${b.startDate},end_date=${b.endDate},updated_at=now() returning id`;if(!updated.length)await tx`insert into app_settings(festival_name,cellar_name,start_date,end_date) values(${festivalName},${cellarName},${b.startDate},${b.endDate})`;await tx`insert into work_evenings(work_date) select d::date from generate_series(${b.startDate}::date,${b.endDate}::date,'1 day') d on conflict(work_date) do nothing`;await tx`insert into menu_categories(name,display_order) select name,position from unnest(array['Primi','Secondi','Panini','Contorni','Bevande','Altro']) with ordinality as c(name,position) where not exists(select 1 from menu_categories)`});return json({success:true});
    }
    if(b.action==="openTable"){
      await requireUser(["CAMERIERE"]);const [evening]=await sql`select id from work_evenings where active=true`;if(!evening)return json({error:"Nessuna serata attiva"},409);
      const accountName=String(b.accountName||"").trim();if(!accountName)return json({error:"Inserisci il nome del conto"},400);
      const order=await sql.begin(async tx=>{const [t]=await tx`select * from restaurant_tables where id=${b.tableId} for update`;if(!t||t.status!=="LIBERO")throw new Error("BUSY");await tx`update restaurant_tables set status='OCCUPATO',assigned_waiter_id=${user.id} where id=${b.tableId}`;const [o]=await tx`insert into orders(table_id,work_evening_id,account_name,waiter_id) values(${b.tableId},${evening.id},${accountName},${user.id}) returning *`;return o});return json({order},201);
    }
    if(b.action==="openCounterOrder"){
      await requireUser(["CASSIERE"]);
      const accountName=String(b.accountName||"").trim();
      if(!accountName)return json({error:"Inserisci il nome del conto"},400);
      const [evening]=await sql`select id from work_evenings where active=true`;
      if(!evening)return json({error:"Nessuna serata attiva"},409);
      const [order]=await sql`insert into orders(table_id,work_evening_id,account_name,waiter_id) values(null,${evening.id},${accountName},${user.id}) returning *`;
      return json({order},201);
    }
    if(b.action==="setItem"){
      const [o]=await sql`select * from orders where id=${b.orderId} and status='APERTO'`;if(!o||(user.role==="CAMERIERE"&&o.waiter_id!==user.id))return json({error:"Ordine non modificabile"},403);
      const [m]=await sql`select * from menu_items where id=${b.menuItemId} and active=true`;if(!m)return json({error:"Prodotto non trovato"},404);
      if(b.quantity<=0)await sql`delete from order_items where order_id=${b.orderId} and menu_item_id=${b.menuItemId}`;
      else await sql`insert into order_items(order_id,menu_item_id,item_name,unit_price,quantity) values(${b.orderId},${m.id},${m.name},${m.price},${b.quantity}) on conflict(order_id,menu_item_id) do update set quantity=excluded.quantity,updated_at=now()`;
      await sql`update orders set total=coalesce((select sum(subtotal) from order_items where order_id=${b.orderId}),0) where id=${b.orderId}`;return json({success:true});
    }
    if(b.action==="clearOrder"){
      const [o]=await sql`select * from orders where id=${b.orderId} and status='APERTO'`;
      if(!o||(user.role==="CAMERIERE"&&o.waiter_id!==user.id))return json({error:"Ordine non modificabile"},403);
      await sql.begin(async tx=>{await tx`delete from order_items where order_id=${o.id}`;await tx`update orders set total=0,updated_at=now() where id=${o.id}`});
      return json({success:true});
    }
    if(b.action==="closeOrder"){
      await requireUser(["ADMIN","CASSIERE"]);
      const result=await sql.begin(async tx=>{const [o]=await tx`select * from orders where id=${b.orderId} and status='APERTO' for update`;if(!o)throw new Error("CLOSED");const [{total}]=await tx`select coalesce(sum(subtotal),0)::numeric total from order_items where order_id=${o.id}`;const code=`ORD-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${String(o.id).padStart(4,"0")}`;await tx`update orders set status='CHIUSO',cashier_id=${user.id},total=${total},order_code=${code},closed_at=now(),paid_at=now(),updated_at=now() where id=${o.id}`;if(o.table_id)await tx`update restaurant_tables set status='LIBERO',assigned_waiter_id=null where id=${o.table_id}`;return{id:o.id,code,total}});return json(result);
    }
    if(b.action==="cancelOrder"){
      await requireUser(["ADMIN","CASSIERE"]);
      const [order]=await sql.begin(async tx=>{const [o]=await tx`update orders set status='ANNULLATO',cashier_id=${user.id},closed_at=now(),paid_at=null,updated_at=now() where id=${b.orderId} and status='APERTO' returning *`;if(o?.table_id)await tx`update restaurant_tables set status='LIBERO',assigned_waiter_id=null where id=${o.table_id}`;return[o]});
      if(!order)return json({error:"Ordine già chiuso o non trovato"},409);return json({success:true});
    }
    return json({error:"Azione non valida"},400);
  }catch(e){return failure(e)}
}
