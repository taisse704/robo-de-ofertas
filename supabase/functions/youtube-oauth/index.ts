import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SUPABASE_PUBLISHABLE_KEYS=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
const SUPABASE_SECRET_KEYS=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
const PUBLISHABLE_KEY=SUPABASE_PUBLISHABLE_KEYS.default||Deno.env.get("SUPABASE_ANON_KEY")||"";
const SECRET_KEY=SUPABASE_SECRET_KEYS.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const CLIENT_ID=Deno.env.get("YOUTUBE_CLIENT_ID")||"";
const CLIENT_SECRET=Deno.env.get("YOUTUBE_CLIENT_SECRET")||"";
const REDIRECT_URI="https://ytymdncyaynmypiodhfc.supabase.co/functions/v1/youtube-oauth";
const APP_URL="https://taisse704.github.io/robo-de-ofertas/";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
const redirectToApp=(status:string,message="")=>{const u=new URL(APP_URL);u.searchParams.set("youtube",status);if(message)u.searchParams.set("message",message.slice(0,300));return Response.redirect(u.toString(),302);};
const randomState=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
async function sha256(v:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,"0")).join("");}
function bearer(req:Request){const h=req.headers.get("authorization")||"";return h.startsWith("Bearer ")?h.slice(7):"";}
async function getUser(req:Request){const t=bearer(req);if(!t||!PUBLISHABLE_KEY)return null;const c=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{global:{headers:{Authorization:`Bearer ${t}`}}});const {data,error}=await c.auth.getUser(t);return error||!data.user?null:data.user;}
function requireConfig(){if(!CLIENT_ID||!CLIENT_SECRET)throw new Error("YouTube ainda não está configurado no Supabase.");}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 const url=new URL(req.url);const action=url.searchParams.get("action")||(url.searchParams.has("code")||url.searchParams.has("error")?"callback":"start");
 try{
  if(action==="start"){
   requireConfig();const user=await getUser(req);if(!user)return json({ok:false,error:"Sessão inválida. Faça login novamente."},401);
   const admin=createClient(SUPABASE_URL,SECRET_KEY);const state=randomState();const stateHash=await sha256(state);
   await admin.from("youtube_oauth_states").delete().lt("expires_at",new Date().toISOString());
   const {error}=await admin.from("youtube_oauth_states").insert({user_id:user.id,state_hash:stateHash,expires_at:new Date(Date.now()+600000).toISOString()});if(error)throw error;
   const a=new URL("https://accounts.google.com/o/oauth2/v2/auth");
   a.searchParams.set("client_id",CLIENT_ID);a.searchParams.set("redirect_uri",REDIRECT_URI);a.searchParams.set("response_type","code");
   a.searchParams.set("scope","https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl");
   a.searchParams.set("access_type","offline");a.searchParams.set("prompt","consent");a.searchParams.set("include_granted_scopes","true");a.searchParams.set("state",state);
   return json({ok:true,authorization_url:a.toString()});
  }
  if(action==="callback"){
   requireConfig();const oauthError=url.searchParams.get("error");if(oauthError)return redirectToApp("error",url.searchParams.get("error_description")||oauthError);
   const code=url.searchParams.get("code"),state=url.searchParams.get("state");if(!code||!state)return redirectToApp("error","Retorno do Google incompleto.");
   const admin=createClient(SUPABASE_URL,SECRET_KEY),stateHash=await sha256(state);
   const {data:s,error:se}=await admin.from("youtube_oauth_states").select("id,user_id,expires_at").eq("state_hash",stateHash).maybeSingle();
   if(se||!s||new Date(s.expires_at).getTime()<Date.now())return redirectToApp("error","Estado OAuth inválido ou expirado.");
   await admin.from("youtube_oauth_states").delete().eq("id",s.id);
   const tr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:CLIENT_ID,client_secret:CLIENT_SECRET,code,grant_type:"authorization_code",redirect_uri:REDIRECT_URI})});
   const token=await tr.json().catch(()=>({}));if(!tr.ok||!token.access_token)return redirectToApp("error",token.error_description||token.error||"Não foi possível obter o token do YouTube.");
   const cr=await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",{headers:{Authorization:`Bearer ${token.access_token}`}});const cd=await cr.json().catch(()=>({}));const ch=cd.items?.[0];const channelId=ch?.id||null;const channelTitle=ch?.snippet?.title||null;
   const scope=token.scope||"https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl";const expiresAt=new Date(Date.now()+Number(token.expires_in||3600)*1000).toISOString();
   const {error:te}=await admin.from("youtube_tokens").upsert({user_id:s.user_id,access_token:token.access_token,refresh_token:token.refresh_token||null,token_type:token.token_type||"Bearer",scope,expires_at:expiresAt,channel_id:channelId,channel_title:channelTitle,updated_at:new Date().toISOString()},{onConflict:"user_id"});if(te)throw te;
   const accountConfig={provider:"youtube",conectado:true,channel_id:channelId,channel_title:channelTitle,scope,expires_at:expiresAt};
   const account=await admin.from("channel_accounts").select("id").eq("user_id",s.user_id).eq("canal","youtube").maybeSingle();
   if(account.data?.id)await admin.from("channel_accounts").update({status:"conectada",configuracao:accountConfig,updated_at:new Date().toISOString()}).eq("id",account.data.id);
   else await admin.from("channel_accounts").insert({user_id:s.user_id,canal:"youtube",status:"conectada",configuracao:accountConfig});
   const pc=await admin.from("publication_channels").select("id").eq("user_id",s.user_id).eq("tipo","youtube_shorts").maybeSingle();
   const pcConfig={provider:"youtube",conectado:true,channel_id:channelId,channel_title:channelTitle};
   if(pc.data?.id)await admin.from("publication_channels").update({nome:"YouTube Shorts",ativo:true,identificador:channelId,configuracao:pcConfig,updated_at:new Date().toISOString()}).eq("id",pc.data.id);
   else await admin.from("publication_channels").insert({user_id:s.user_id,tipo:"youtube_shorts",nome:"YouTube Shorts",ativo:true,identificador:channelId,configuracao:pcConfig});
   return redirectToApp("success");
  }
  return json({ok:false,error:"Ação inválida."},400);
 }catch(e){console.error("YOUTUBE OAUTH:",e);return action==="callback"?redirectToApp("error",e instanceof Error?e.message:"Erro OAuth."):json({ok:false,error:e instanceof Error?e.message:"Erro OAuth."},500);}
});