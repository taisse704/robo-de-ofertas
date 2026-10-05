import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const U=Deno.env.get("SUPABASE_URL")||"";
const S=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const BASE=(Deno.env.get("STORRITO_API_BASE_URL")||"").replace(/\/$/,"");
const TOKEN=Deno.env.get("STORRITO_API_TOKEN")||"";

const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...C,"Content-Type":"application/json"}});

function esc(v:string){
 return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

async function rpc(procedure:string,params:Record<string,unknown>={}){
 if(!BASE||!TOKEN) throw new Error("Storrito ainda não configurado. Adicione STORRITO_API_BASE_URL e STORRITO_API_TOKEN nos Secrets do Supabase.");
 const r=await fetch(BASE+"/api/v1/"+procedure,{
   method:"POST",
   headers:{"Authorization":"Bearer "+TOKEN,"Content-Type":"application/json"},
   body:JSON.stringify(params)
 });
 const data=await r.json().catch(()=>({}));
 if(!r.ok) throw new Error(data?.errorMessage||data?.message||("Storrito HTTP "+r.status));
 return data;
}

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:C});
 try{
  if(!U||!S)return j({ok:false,error:"Supabase não configurado."},500);
  const auth=req.headers.get("Authorization")||"";
  if(auth!=="Bearer "+S)return j({ok:false,error:"Acesso interno obrigatório."},401);

  const db=createClient(U,S);
  const b=await req.json().catch(()=>({}));
  const userId=String(b.user_id||"");
  const contentId=String(b.content_id||"");
  if(!userId||!contentId)return j({ok:false,error:"user_id e content_id são obrigatórios."},400);

  const {data:content,error:ce}=await db.from("contents")
    .select("id,user_id,offer_id,titulo,legenda,thumbnail_url,imagem_1080_url,imagem_story_1080_url,video_url")
    .eq("id",contentId).eq("user_id",userId).maybeSingle();
  if(ce)throw ce;
  if(!content)return j({ok:false,error:"Conteúdo não encontrado."},404);

  const {data:offer,error:oe}=await db.from("offers")
    .select("id,affiliate_url,url_produto,imagem_url")
    .eq("id",content.offer_id).maybeSingle();
  if(oe)throw oe;

  const affiliateUrl=offer?.affiliate_url||offer?.url_produto||"";
  if(!affiliateUrl)return j({ok:false,error:"O produto não possui link de afiliado."},409);

  const imageUrl=content.imagem_story_1080_url||content.imagem_1080_url||content.thumbnail_url||offer?.imagem_url||"";
  if(!imageUrl)return j({ok:false,error:"O conteúdo não possui imagem pública para o Story."},409);

  const {data:account,error:ae}=await db.from("channel_accounts")
    .select("configuracao").eq("user_id",userId).eq("canal","instagram").eq("status","conectada").maybeSingle();
  if(ae)throw ae;
  const username=String(account?.configuracao?.instagram_username||"").replace(/^@/,"");
  if(!username)return j({ok:false,error:"Usuário do Instagram não encontrado na conexão atual."},409);

  const storyUuid=crypto.randomUUID();
  const html=`<insta-story>
    <img src="${esc(imageUrl)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#ffffff;">
    <div style="position:absolute;inset:0;box-sizing:border-box;padding:250px 40px 300px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:36px;">
      <p style="margin:0;text-align:center;font-family:Arial,sans-serif;font-size:54px;line-height:1.08;color:#111;font-weight:800;text-shadow:0 1px 2px #fff;">${esc(content.titulo||"Oferta")}</p>
      <insta-link url="${esc(affiliateUrl)}" text="🛍️ COMPRAR AGORA" design="default"></insta-link>
    </div>
  </insta-story>`;

  const {data:existing}=await db.from("story_publications").select("id,status,story_post_uuid")
    .eq("content_id",contentId).eq("user_id",userId).limit(1).maybeSingle();
  if(existing && ["scheduled","publicando","publicada"].includes(existing.status)){
    return j({ok:true,duplicado:true,story_publication_id:existing.id,status:existing.status,story_post_uuid:existing.story_post_uuid});
  }

  const {data:row,error:re}=await db.from("story_publications").upsert({
    id:existing?.id,
    user_id:userId,
    content_id:contentId,
    status:"publicando",
    affiliate_url:affiliateUrl,
    story_post_uuid:storyUuid,
    tentativas:(existing?.status==="erro"?1:1),
    dados:{provider:"storrito",instagram_username:username}
  },{onConflict:"content_id,channel_id"}).select("id").single();
  if(re)throw re;

  try{
    const result=await rpc("schedule-instagram-story",{
      html,
      instagramUsername:username,
      storyPostUuid:storyUuid
    });
    await db.from("story_publications").update({
      status:"scheduled",
      preview_url:result?.previewUrl||null,
      scheduled_at:new Date().toISOString(),
      dados:{provider:"storrito",instagram_username:username,warnings:result?.warnings||[]},
      erro:null,
      updated_at:new Date().toISOString()
    }).eq("id",row.id);

    return j({ok:true,status:"scheduled",story_publication_id:row.id,story_post_uuid:storyUuid,preview_url:result?.previewUrl||null,warnings:result?.warnings||[]});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    await db.from("story_publications").update({status:"erro",erro:msg,updated_at:new Date().toISOString()}).eq("id",row.id);
    return j({ok:false,status:"erro",story_publication_id:row.id,error:msg},502);
  }
 }catch(e){
  console.error("STORRITO-STORY ERRO:",e);
  return j({ok:false,error:e instanceof Error?e.message:"Erro interno."},500);
 }
});