import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const U=Deno.env.get("SUPABASE_URL")??"",S=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",A=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??"";
const db=createClient(U,S);
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...C,"Content-Type":"application/json"}});
async function user(req:Request){const t=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!t)return null;const c=createClient(U,A,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${t}`}}});const {data}=await c.auth.getUser();return data.user||null;}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:C});
 try{
  const u=await user(req);if(!u)return j({ok:false,error:"Não autenticado."},401);
  const b=await req.json().catch(()=>({}));const cid=String(b.content_id||"");
  if(!cid)return j({ok:false,error:"content_id obrigatório."},400);
  const {data:c,error:ce}=await db.from("contents").select("*").eq("id",cid).eq("user_id",u.id).single();
  if(ce||!c)return j({ok:false,error:"Conteúdo não encontrado."},404);
  if(c.status!=="aguardando_revisao"&&c.status!=="aprovado")return j({ok:false,error:"Conteúdo não está aguardando aprovação."},409);
  const {data:link}=await db.from("affiliate_links").select("id,url_afiliada").eq("offer_id",c.offer_id).eq("status","gerado").not("url_afiliada","is",null).limit(1).maybeSingle();
  if(!link)return j({ok:false,error:"Sem link de afiliado válido."},409);
  const {data:chs}=await db.from("publication_channels").select("*").eq("user_id",u.id).eq("ativo",true);
  if(!chs?.length)return j({ok:false,error:"Nenhum canal de publicação ativo."},409);
  const rows=chs.map((ch:any)=>({user_id:u.id,offer_id:c.offer_id,affiliate_link_id:link.id,channel_id:ch.id,content_id:cid,status:"pendente",titulo:c.titulo,texto:c.legenda,imagem_url:c.thumbnail_url,video_url:c.video_url,dados:{content_id:cid,channel:ch.tipo,requires_connector:true,aprovado:true}}));
  const {data:pubs,error:pe}=await db.from("offer_publications").upsert(rows,{onConflict:"content_id,channel_id",ignoreDuplicates:true}).select("*");
  if(pe)throw pe;
  const {error:ue}=await db.from("contents").update({status:"pronto",aprovado_em:new Date().toISOString(),aprovado_por:u.id,updated_at:new Date().toISOString()}).eq("id",cid).eq("user_id",u.id);
  if(ue)throw ue;
  return j({ok:true,pendentes:pubs?.length||0,status:"pronto",publicacoes:pubs||[]});
 }catch(e){console.error(e);return j({ok:false,error:e instanceof Error?e.message:"Erro interno."},500);}
});