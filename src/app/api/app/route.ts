import {NextRequest,NextResponse} from "next/server";
import bcrypt from "bcryptjs";
import {sql} from "@/lib/db";
import {createSession,currentUser,destroySession,requireUser} from "@/lib/auth";
const json=(data:unknown,status=200)=>NextResponse.json(data,{status});

export async function GET(req:NextRequest){
  const action=req.nextUrl.searchParams.get("action");
  try{
    if(action==="me")return json({user:await currentUser()});
    const user=await requireUser();
    if(action==="state"){
      const [settings]=await sql`select * from app_settings limit 1`;
      const tables=await sql`select t.*,u.display_name waiter_name,o.id order_id,o.account_name,o.total from restaurant_tables t left join users u on u.id=t.assigned_waiter_id left join orders o on o.table_id=t.id and o.status='APERTO' where t.active=true order by t.table_number`;
      const menu=await sql`select m.*,c.name category from menu_items m join menu_categories c on c.id=m.category_id where m.active=true order by c.display_order,m.display_order,m.name`;
      return json({user,settings,tables,menu});
    }
    if(action==="orders"){
      if(user.role==="CAMERIERE")return json({error:"Non autorizzato"},403);
      const orders=user.role==="CASSIERE"
        ?await sql`select o.*,t.table_number,u.display_name waiter_name,c.display_name cashier_name from orders o join restaurant_tables t on t.id=o.table_id join users u on u.id=o.waiter_id left join users c on c.id=o.cashier_id join work_evenings w on w.id=o.work_evening_id where o.status='CHIUSO' and w.active=true order by o.closed_at desc`
        :await sql`select o.*,t.table_number,u.display_name waiter_name,c.display_name cashier_name from orders o join restaurant_tables t on t.id=o.table_id join users u on u.id=o.waiter_id left join users c on c.id=o.cashier_id where o.status='CHIUSO' order by o.closed_at desc`;
      return json({orders});
    }
    if(action==="users"){await requireUser(["ADMIN"]);return json({users:await sql`select id,display_name,username,role,active from users order by created_at`})}
    return json({error:"Azione non valida"},400);
  }catch{return json({error:"Non autorizzato"},401)}
}

export async function POST(req:NextRequest){
  const b=await req.json();
  try{
    if(b.action==="setup"){
      const [{count}]=await sql`select count(*)::int count from users`;
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
    if(b.action==="addTable"){await requireUser(["ADMIN"]);const [t]=await sql`insert into restaurant_tables(table_number) values(${b.tableNumber}) returning *`;return json({table:t},201)}
    if(b.action==="openEvening"){await requireUser(["ADMIN"]);await sql.begin(async tx=>{await tx`update work_evenings set active=false,closed_at=case when active then now() else closed_at end`;await tx`update work_evenings set active=true,opened_at=coalesce(opened_at,now()),closed_at=null where work_date=${b.workDate}`});return json({success:true})}
    if(b.action==="openTable"){
      await requireUser(["CAMERIERE"]);const [evening]=await sql`select id from work_evenings where active=true`;if(!evening)return json({error:"Nessuna serata attiva"},409);
      const order=await sql.begin(async tx=>{const [t]=await tx`select * from restaurant_tables where id=${b.tableId} for update`;if(!t||t.status!=="LIBERO")throw new Error("BUSY");await tx`update restaurant_tables set status='OCCUPATO',assigned_waiter_id=${user.id} where id=${b.tableId}`;const [o]=await tx`insert into orders(table_id,work_evening_id,account_name,waiter_id) values(${b.tableId},${evening.id},${b.accountName},${user.id}) returning *`;return o});return json({order},201);
    }
    if(b.action==="setItem"){
      const [o]=await sql`select * from orders where id=${b.orderId} and status='APERTO'`;if(!o||(user.role==="CAMERIERE"&&o.waiter_id!==user.id))return json({error:"Ordine non modificabile"},403);
      const [m]=await sql`select * from menu_items where id=${b.menuItemId} and active=true`;if(!m)return json({error:"Prodotto non trovato"},404);
      if(b.quantity<=0)await sql`delete from order_items where order_id=${b.orderId} and menu_item_id=${b.menuItemId}`;
      else await sql`insert into order_items(order_id,menu_item_id,item_name,unit_price,quantity) values(${b.orderId},${m.id},${m.name},${m.price},${b.quantity}) on conflict(order_id,menu_item_id) do update set quantity=excluded.quantity,updated_at=now()`;
      await sql`update orders set total=coalesce((select sum(subtotal) from order_items where order_id=${b.orderId}),0) where id=${b.orderId}`;return json({success:true});
    }
    if(b.action==="closeOrder"){
      await requireUser(["ADMIN","CASSIERE"]);
      const result=await sql.begin(async tx=>{const [o]=await tx`select * from orders where id=${b.orderId} and status='APERTO' for update`;if(!o)throw new Error("CLOSED");const [{total}]=await tx`select coalesce(sum(subtotal),0)::numeric total from order_items where order_id=${o.id}`;const code=`ORD-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${String(o.id).padStart(4,"0")}`;await tx`update orders set status='CHIUSO',cashier_id=${user.id},total=${total},order_code=${code},closed_at=now(),paid_at=now() where id=${o.id}`;await tx`update restaurant_tables set status='LIBERO',assigned_waiter_id=null where id=${o.table_id}`;return{code,total}});return json(result);
    }
    return json({error:"Azione non valida"},400);
  }catch(e){return json({error:e instanceof Error&&e.message==="BUSY"?"Tavolo già occupato":"Operazione non riuscita"},e instanceof Error&&e.message==="BUSY"?409:500)}
}
