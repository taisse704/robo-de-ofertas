import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PUBLISHABLE_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SECRET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_ID = Deno.env.get("KWAI_APP_ID") || "";
const APP_SECRET = Deno.env.get("KWAI_APP_SECRET") || "";
const REDIRECT_URI = "https://ytymdncyaynmypiodhfc.supabase.co/functions/v1/kwai-oauth";
const APP_URL = "https://taisse704.github.io/robo-de-ofertas/";

const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
function redirectToApp(status:string,message=""){const u=new URL(APP_URL);u.searchParams.set("kwai",status);if(message)u.searchParams.set("message",message.slice(0,300));return Response.redirect(u.toString(),302);}
function randomState(){const b=crypto.getRandomValues(new Uint8Array(32));return Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");}
async function sha256(v:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d),x=>x.toString(16).padStart(2,"0")).join("");}
function bearer(req:Request){const h=req.headers.get("authorization")||"";return h.startsWith("Bearer ")?h.slice(7):"";}
async function getUser(req:Request){const token=bearer(req);if(!token||!PUBLISHABLE_KEY)return null;const c=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}});const {data,error}=await c.auth.getUser(token);return error||!data.user?null:data.user;}
function config(){if(!APP_ID||!APP_SECRET)throw new Error("Kwai ainda não está configurado no Supabase. Cadastre KWAI_APP_ID e KWAI_APP_SECRET.");}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 const u=new URL(req.url);const action=u.searchParams.get("action")||(u.searchParams.has("code")||u.searchParams.has("error")?"callback":"start");
 try{
  if(action==="start"){
   config();const user=await getUser(req);if(!user)return json({ok:false,error:"Sessão inválida. Faça login novamente."},401);
   const admin=createClient(SUPABASE_URL,SECRET_KEY);const state=randomState();const hash=await sha256(state);const expires=new Date(Date.now()+10*60*1000).toISOString();
   await admin.from("kwai_oauth_states").delete().lt("expires_at",new Date().toISOString());
   const {error:se}=await admin.from("kwai_oauth_states").insert({user_id:user.id,state_hash:hash,expires_at:expires});if(se)throw se;
   const auth=new URL("https://open.kuaishou.com/oauth2/authorize");auth.searchParams.set("app_id",APP_ID);auth.searchParams.set("scope","user_info,user_video_publish");auth.searchParams.set("response_type","code");auth.searchParams.set("redirect_uri",REDIRECT_URI);auth.searchParams.set("state",state);
   return json({ok:true,authorization_url:auth.toString()});
  }
  if(action==="callback"){
   config();if(u.searchParams.get("error"))return redirectToApp("error",u.searchParams.get("error_msg")||u.searchParams.get("error")||"Autorização recusada.");
   const code=u.searchParams.get("code"),state=u.searchParams.get("state");if(!code||!state)return redirectToApp("error","Retorno do Kwai incompleto.");
   const admin=createClient(SUPABASE_URL,SECRET_KEY);const hash=await sha256(state);const {data:sr,error:se}=await admin.from("kwai_oauth_states").select("id,user_id,expires_at").eq("state_hash",hash).maybeSingle();
   if(se||!sr||new Date(sr.expires_at).getTime()<Date.now())return redirectToApp("error","Estado OAuth do Kwai inválido ou expirado.");
   await admin.from("kwai_oauth_states").delete().eq("id",sr.id);
   const tokenUrl=new URL("https://open.kuaishou.com/oauth2/access_token");tokenUrl.searchParams.set("app_id",APP_ID);tokenUrl.searchParams.set("app_secret",APP_SECRET);tokenUrl.searchParams.set("code",code);tokenUrl.searchParams.set("grant_type","authorization_code");
   const tr=await fetch(tokenUrl.toString());const t=await tr.json().catch(()=>({}));
   if(!tr.ok||t.result!==1||!t.access_token||!t.refresh_token){console.error("Kwai token error",t);return redirectToApp("error",t.error_msg||"Não foi possível obter o token do Kwai.");}
   const expiresAt=new Date(Date.now()+Number(t.expires_in||172800)*1000).toISOString(),refreshExpiresAt=new Date(Date.now()+Number(t.refresh_token_expires_in||15552000)*1000).toISOString();
   const cfg={provider:"kwai",conectado:true,open_id:t.open_id||null,scopes:Array.isArray(t.scopes)?t.scopes.join(","):(t.scopes||""),access_token:t.access_token,refresh_token:t.refresh_token,expires_at:expiresAt,refresh_expires_at:refreshExpiresAt};
   const {data:acc}=await admin.from("channel_accounts").select("id").eq("user_id",sr.user_id).eq("canal","kwai").maybeSingle();
   if(acc?.id)await admin.from("channel_accounts").update({status:"conectada",configuracao:cfg,updated_at:new Date().toISOString()}).eq("id",acc.id);else await admin.from("channel_accounts").insert({user_id:sr.user_id,canal:"kwai",status:"conectada",configuracao:cfg});
   const {data:ch}=await admin.from("publication_channels").select("id").eq("user_id",sr.user_id).eq("tipo","kwai").maybeSingle();
   if(ch?.id)await admin.from("publication_channels").update({nome:"Kwai",ativo:true,identificador:t.open_id||null,configuracao:{provider:"kwai",conectado:true},updated_at:new Date().toISOString()}).eq("id",ch.id);else await admin.from("publication_channels").insert({user_id:sr.user_id,tipo:"kwai",nome:"Kwai",ativo:true,identificador:t.open_id||null,configuracao:{provider:"kwai",conectado:true}});
   return redirectToApp("success");
  }
  return json({ok:false,error:"Ação inválida."},400);
 }catch(e){console.error("KWAI OAUTH",e);if(action==="callback")return redirectToApp("error",e instanceof Error?e.message:"Erro OAuth do Kwai.");return json({ok:false,error:e instanceof Error?e.message:"Erro OAuth do Kwai."},500);}
});