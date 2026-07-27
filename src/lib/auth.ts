import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export type SessionUser = { id:string; username:string; displayName:string; role:"ADMIN"|"CAMERIERE"|"CASSIERE" };
const key=()=>new TextEncoder().encode(process.env.AUTH_SECRET||"");

export async function createSession(user:SessionUser){
  const token=await new SignJWT(user).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("12h").sign(key());
  (await cookies()).set("baccanalia_session",token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:43200});
}
export async function destroySession(){(await cookies()).delete("baccanalia_session")}
export async function currentUser():Promise<SessionUser|null>{
  const token=(await cookies()).get("baccanalia_session")?.value;
  if(!token)return null;
  try{return (await jwtVerify(token,key())).payload as unknown as SessionUser}catch{return null}
}
export async function requireUser(roles?:SessionUser["role"][]){
  const user=await currentUser();
  if(!user||(roles&&!roles.includes(user.role)))throw new Error("UNAUTHORIZED");
  return user;
}
