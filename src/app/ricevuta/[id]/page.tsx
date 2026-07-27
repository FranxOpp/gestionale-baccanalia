"use client";
import {useEffect,useState} from "react";

type ReceiptData={
  settings?:{festival_name:string;cellar_name:string};
  order:{id:number;order_code:string;table_number:number|null;account_name:string;waiter_name:string;cashier_name:string;closed_at:string;total:number|string};
  items:{item_name:string;unit_price:number|string;quantity:number;subtotal:number|string}[];
};
const money=(value:number|string)=>new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(Number(value));

export default function Receipt({params}:{params:Promise<{id:string}>}){
  const [data,setData]=useState<ReceiptData|null>(null),[error,setError]=useState("");
  useEffect(()=>{params.then(({id})=>fetch(`/api/app?action=receipt&id=${id}`).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error);setData(result);setTimeout(()=>window.print(),300)}).catch(e=>setError((e as Error).message)))},[params]);
  if(error)return <main className="receipt error">{error}</main>;
  if(!data)return <main className="receipt">Preparazione ricevuta…</main>;
  return <main className="receipt"><header><h1>{data.settings?.festival_name||"Manifestazione"}</h1><h2>{data.settings?.cellar_name||""}</h2><p>Documento non fiscale</p></header><div className="receipt-info"><b>{data.order.order_code}</b><span>{data.order.table_number===null?"Ordine diretto":`Tavolo ${data.order.table_number}`} · {data.order.account_name}</span><span>{new Date(data.order.closed_at).toLocaleString("it-IT")}</span><span>{data.order.table_number===null?"Operatore":"Cameriere"}: {data.order.waiter_name}</span><span>Cassiere: {data.order.cashier_name}</span></div><div className="receipt-items">{data.items.map((item,index)=><article key={index}><div><b>{item.quantity} × {item.item_name}</b><small>{money(item.unit_price)} cad.</small></div><strong>{money(item.subtotal)}</strong></article>)}</div><div className="receipt-total"><span>TOTALE</span><strong>{money(data.order.total)}</strong></div><footer><b>PAGATO IN CONTANTI</b><p>Documento non fiscale</p></footer><button className="no-print" onClick={()=>window.print()}>Stampa ricevuta</button></main>;
}
