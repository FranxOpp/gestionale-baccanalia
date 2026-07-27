import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";

export type SessionUser = { id:string; username:string; displayName:string; role:"ADMIN"|"CAMERIERE"|"CASSIERE" };
const key=()=>{
  const secret=process.env.AUTH_SECRET||"";
  if(secret.length<32)throw new Error("AUTH_SECRET deve contenere almeno 32 caratteri");
  return new TextEncoder().encode(secret);
};

export async function createSession(user:SessionUser){
  const token=await new SignJWT(user).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("12h").sign(key());
  (await cookies()).set("baccanalia_session",token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:43200});
}
export async function destroySession(){(await cookies()).delete("baccanalia_session")}
export async function currentUser():Promise<SessionUser|null>{
  const token=(await cookies()).get("baccanalia_session")?.value;
  if(!token)return null;
  try{
    const session=(await jwtVerify(token,key())).payload as unknown as SessionUser;
    const [user]=await sql`select id,username,display_name,role from users where id=${session.id} and active=true`;
    if(!user){await destroySession();return null}
    return{id:user.id,username:user.username,displayName:user.display_name,role:user.role};
  }catch{await destroySession();return null}
}
export async function requireUser(roles?:SessionUser["role"][]){
  const user=await currentUser();
  if(!user||(roles&&!roles.includes(user.role)))throw new Error("UNAUTHORIZED");
  return user;
}
