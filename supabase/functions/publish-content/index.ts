import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const GRAPH="https://graph.instagram.com";
const TIKTOK="https://open.tiktokapis.com/v2";
const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
const errText=(v:any)=>v?.error?.message||v?.error?.message||v?.message||v?.error_description||String(v||"Erro desconhecido");
async function graph(path:string,init:RequestInit={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);try{const r=await fetch(`${GRAPH}${path}`,{...init,signal:controller.signal});const d=await r.json().catch(()=>({}));if(!r.ok||d?.error)throw new Error(errText(d)||`Instagram Graph HTTP ${r.status}`);return d;}catch(e){if(e?.name==="AbortError")throw new Error("Instagram Graph demorou mais de 30 segundos.");throw e;}finally{clearTimeout(timer);}}
async function instagram(a:{id:string;token:string;image:string;caption:string;link:string}){if(!a.image)throw new Error("O conteúdo não possui uma imagem pública para o Instagram.");const c=await graph(`/${encodeURIComponent(a.id)}/media`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({image_url:a.image,caption:a.caption||"",access_token:a.token})});const creation=c?.id;if(!creation)throw new Error("O Instagram não retornou o ID do conteúdo.");for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,2000));const s=await graph(`/${encodeURIComponent(creation)}?fields=status_code,status&access_token=${encodeURIComponent(a.token)}`);const st=s?.status_code||s?.status||"";if(st==="FINISHED")break;if(["ERROR","EXPIRED"].includes(st))throw new Error(`Instagram rejeitou o conteúdo (${st}).`);if(i===29)throw new Error(`Instagram não concluiu o processamento (${st||"status desconhecido"}).`);}const p=await graph(`/${encodeURIComponent(a.id)}/media_publish`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({creation_id:creation,access_token:a.token})});if(!p?.id)throw new Error("O Instagram não retornou o ID da publicação.");if(a.link){try{await graph(`/${encodeURIComponent(p.id)}/comments`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({message:`🔗 Clique no link abaixo para comprar 👇\n${a.link}`,access_token:a.token})});}catch(e){console.error("INSTAGRAM_COMENTARIO",e);}}return{externalId:p.id,status:"publicada",creationId:creation};}
async function tiktokToken(db:any,userId:string){const {data:t,error}=await db.from("tiktok_tokens").select("*").eq("user_id",userId).maybeSingle();if(error)throw error;if(!t?.access_token)throw new Error("TikTok não está conectado. Conecte novamente o TikTok.");if(t.expires_at&&new Date(t.expires_at).getTime()>Date.now()+120000)return t.access_token;const key=Deno.env.get("TIKTOK_CLIENT_KEY")||"",secret=Deno.env.get("TIKTOK_CLIENT_SECRET")||"";if(!key||!secret||!t.refresh_token)throw new Error("O token do TikTok expirou. Reconecte o TikTok.");const r=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Cache-Control":"no-cache"},body:new URLSearchParams({client_key:key,client_secret:secret,grant_type:"refresh_token",refresh_token:t.refresh_token})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token)throw new Error(errText(d)||"Não foi possível renovar o token do TikTok.");const ex=new Date(Date.now()+Number(d.expires_in||86400)*1000).toISOString();const rex=new Date(Date.now()+Number(d.refresh_expires_in||31536000)*1000).toISOString();const {error:ue}=await db.from("tiktok_tokens").update({access_token:d.access_token,refresh_token:d.refresh_token||t.refresh_token,expires_at:ex,refresh_expires_at:rex,scopes:d.scope||t.scopes||"",updated_at:new Date().toISOString()}).eq("user_id",userId);if(ue)throw ue;return d.access_token;}
async function creatorInfo(token:string){const r=await fetch(`${TIKTOK}/post/publish/creator_info/query/`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json; charset=UTF-8"},body:"{}"});const d=await r.json().catch(()=>({}));if(!r.ok||d?.error?.code!=="ok")throw new Error(d?.error?.message||d?.error?.code||`TikTok creator_info falhou (HTTP ${r.status}).`);return d.data||{};}
async function tiktok(a:{db:any;userId:string;videoUrl:string;title:string;isAigc?:boolean}){if(!a.videoUrl)throw new Error("O TikTok exige um vídeo pronto para publicação.");const token=await tiktokToken(a.db,a.userId);const info=await creatorInfo(token);const opts=Array.isArray(info.privacy_level_options)?info.privacy_level_options:[];if(!opts.length)throw new Error("O TikTok não retornou as opções de privacidade da conta.");const privacy=opts.includes("PUBLIC_TO_EVERYONE")?"PUBLIC_TO_EVERYONE":opts[0];
  const vr=await fetch(a.videoUrl);if(!vr.ok)throw new Error(`Não foi possível baixar o vídeo para o TikTok (HTTP ${vr.status}).`);const type=(vr.headers.get("content-type")||"video/mp4").split(";")[0];if(!type.startsWith("video/"))throw new Error("O arquivo do conteúdo não é um vídeo válido.");const buf=new Uint8Array(await vr.arrayBuffer());if(!buf.length)throw new Error("O vídeo está vazio.");const size=buf.byteLength;const chunk=Math.min(10_000_000,size);if(size<5_000_000&&size!==chunk)throw new Error("O vídeo é menor que o mínimo aceito pelo upload do TikTok.");const total=Math.ceil(size/chunk);
  const caption=(a.title||"Oferta").slice(0,2200);
  const init=await fetch(`${TIKTOK}/post/publish/video/init/`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json; charset=UTF-8"},body:JSON.stringify({post_info:{title:caption,privacy_level:privacy,disable_duet:false,disable_comment:false,disable_stitch:false,video_cover_timestamp_ms:1000,is_aigc:!!a.isAigc},source_info:{source:"FILE_UPLOAD",video_size:size,chunk_size:chunk,total_chunk_count:total}})});const d=await init.json().catch(()=>({}));if(!init.ok||d?.error?.code!=="ok")throw new Error(d?.error?.message||d?.error?.code||`TikTok recusou a publicação (HTTP ${init.status}).`);const publishId=d?.data?.publish_id,upload=d?.data?.upload_url;if(!publishId||!upload)throw new Error("TikTok não retornou os dados de upload.");for(let i=0;i<total;i++){const start=i*chunk;const end=Math.min(start+chunk,size)-1;const part=buf.slice(start,end+1);const ur=await fetch(upload,{method:"PUT",headers:{"Content-Type":type,"Content-Length":String(part.byteLength),"Content-Range":`bytes ${start}-${end}/${size}`},body:part});if(!ur.ok)throw new Error(`TikTok falhou no upload do vídeo (HTTP ${ur.status}).`);}
  let last:any={};for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,2000));const sr=await fetch(`${TIKTOK}/post/publish/status/fetch/`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json; charset=UTF-8"},body:JSON.stringify({publish_id:publishId})});last=await sr.json().catch(()=>({}));const st=last?.data?.status;if(st==="PUBLISH_COMPLETE")return{externalId:publishId,status:"publicada",publishId,publicPostIds:last?.data?.publicaly_available_post_id||[]};if(st==="FAILED")throw new Error(last?.data?.fail_reason||last?.error?.message||"TikTok falhou ao publicar o vídeo.");}
  return{externalId:publishId,status:"publicando",publishId};}


const KWAI_API = "https://open.kuaishou.com";
async function kwaiToken(db:any,userId:string){
  const {data:a,error}=await db.from("channel_accounts").select("id,status,configuracao").eq("user_id",userId).eq("canal","kwai").maybeSingle();
  if(error) throw error;
  if(!a || a.status!=="conectada" || !a.configuracao?.access_token) throw new Error("Kwai não está conectado. Conecte o Kwai em Configurações.");
  const cfg=a.configuracao;
  if(cfg.expires_at && new Date(cfg.expires_at).getTime()>Date.now()+120000) return {token:cfg.access_token,config:cfg};
  if(!cfg.refresh_token) throw new Error("O token do Kwai expirou. Reconecte o Kwai.");
  const appId=Deno.env.get("KWAI_APP_ID")||"",appSecret=Deno.env.get("KWAI_APP_SECRET")||"";
  if(!appId||!appSecret) throw new Error("Kwai não está configurado no Supabase. Cadastre KWAI_APP_ID e KWAI_APP_SECRET.");
  const u=new URL(KWAI_API+"/oauth2/refresh_token");
  u.searchParams.set("app_id",appId);u.searchParams.set("app_secret",appSecret);u.searchParams.set("refresh_token",cfg.refresh_token);u.searchParams.set("grant_type","refresh_token");
  const r=await fetch(u.toString());const d=await r.json().catch(()=>({}));
  if(!r.ok||d.result!==1||!d.access_token) throw new Error(d.error_msg||"Não foi possível renovar o token do Kwai. Reconecte o Kwai.");
  const expiresAt=new Date(Date.now()+Number(d.expires_in||172800)*1000).toISOString();
  const refreshExpiresAt=new Date(Date.now()+Number(d.refresh_token_expires_in||15552000)*1000).toISOString();
  const next={...cfg,access_token:d.access_token,refresh_token:d.refresh_token||cfg.refresh_token,expires_at:expiresAt,refresh_expires_at:refreshExpiresAt,scopes:Array.isArray(d.scopes)?d.scopes.join(","):(d.scopes||cfg.scopes||"")};
  const {error:ue}=await db.from("channel_accounts").update({configuracao:next,status:"conectada",updated_at:new Date().toISOString()}).eq("id",a.id);
  if(ue) throw ue;
  return {token:d.access_token,config:next};
}
async function kwai(a:{db:any;userId:string;videoUrl:string;imageUrl:string;title:string}){
  if(!a.videoUrl) throw new Error("O Kwai exige um vídeo pronto para publicação.");
  const {token,config}=await kwaiToken(a.db,a.userId);
  const appId=Deno.env.get("KWAI_APP_ID")||"";
  if(!appId) throw new Error("KWAI_APP_ID não configurado.");
  const vr=await fetch(a.videoUrl);if(!vr.ok)throw new Error(`Não foi possível baixar o vídeo para o Kwai (HTTP ${vr.status}).`);
  const type=(vr.headers.get("content-type")||"video/mp4").split(";")[0];const bytes=new Uint8Array(await vr.arrayBuffer());if(!bytes.length)throw new Error("O vídeo está vazio.");
  const start=new URL(KWAI_API+"/openapi/photo/start_upload");start.searchParams.set("app_id",appId);start.searchParams.set("access_token",token);
  const sr=await fetch(start.toString(),{method:"POST"});const sd=await sr.json().catch(()=>({}));
  if(!sr.ok||sd.result!==1||!sd.upload_token||!sd.endpoint)throw new Error(sd.error_msg||`Kwai recusou o início do upload (HTTP ${sr.status}).`);
  const uploadToken=sd.upload_token,endpoint=String(sd.endpoint).replace(/^https?:\/\//,"");
  if(bytes.byteLength<10_000_000){
    const u=new URL("http://"+endpoint+"/api/upload");u.searchParams.set("upload_token",uploadToken);
    const ur=await fetch(u.toString(),{method:"POST",headers:{"Content-Type":type},body:bytes});
    const ud=await ur.json().catch(()=>({}));if(!ur.ok||ud.result!==1)throw new Error(ud.error_msg||`Kwai falhou no upload (HTTP ${ur.status}).`);
  }else{
    const chunk=8_000_000,total=Math.ceil(bytes.byteLength/chunk);
    for(let i=0;i<total;i++){const u=new URL("http://"+endpoint+"/api/upload/fragment");u.searchParams.set("upload_token",uploadToken);u.searchParams.set("fragment_id",String(i));const part=bytes.slice(i*chunk,Math.min((i+1)*chunk,bytes.byteLength));const ur=await fetch(u.toString(),{method:"POST",headers:{"Content-Type":type},body:part});const ud=await ur.json().catch(()=>({}));if(!ur.ok||ud.result!==1)throw new Error(ud.error_msg||`Kwai falhou no upload da parte ${i+1}/${total} (HTTP ${ur.status}).`);}
    const u=new URL("http://"+endpoint+"/api/upload/complete");u.searchParams.set("upload_token",uploadToken);u.searchParams.set("fragment_count",String(total));const ur=await fetch(u.toString(),{method:"POST"});const ud=await ur.json().catch(()=>({}));if(!ur.ok||ud.result!==1)throw new Error(ud.error_msg||"Kwai não concluiu o upload.");
  }
  const form=new FormData();
  if(a.imageUrl){try{const ir=await fetch(a.imageUrl);if(ir.ok){const ib=new Uint8Array(await ir.arrayBuffer());if(ib.byteLength<=10_000_000)form.append("cover",new Blob([ib],{type:(ir.headers.get("content-type")||"image/jpeg").split(";")[0]}),"cover.jpg");}}catch{}}
  if(!form.has("cover"))throw new Error("O Kwai exige uma imagem de capa pública para publicar o vídeo.");
  form.append("caption",(a.title||"Oferta").slice(0,100));
  const pub=new URL(KWAI_API+"/openapi/photo/publish");pub.searchParams.set("app_id",appId);pub.searchParams.set("access_token",token);pub.searchParams.set("upload_token",uploadToken);
  const pr=await fetch(pub.toString(),{method:"POST",body:form});const pd=await pr.json().catch(()=>({}));
  if(!pr.ok||pd.result!==1||!pd.video_info?.photo_id)throw new Error(pd.error_msg||`Kwai recusou a publicação (HTTP ${pr.status}).`);
  return {externalId:String(pd.video_info.photo_id),status:pd.video_info.pending?"publicando":"publicada",photoId:String(pd.video_info.photo_id),url:pd.video_info.play_url||null};
}
\nconst PINTEREST_API = "https://api.pinterest.com/v5";
async function pinterestToken(db:any,userId:string){
  const {data:a,error}=await db.from("channel_accounts").select("id,status,configuracao").eq("user_id",userId).eq("canal","pinterest").maybeSingle();
  if(error) throw error;
  if(!a || a.status!=="conectada" || !a.configuracao?.access_token) throw new Error("Pinterest não está conectado. Conecte o Pinterest em Configurações.");
  const cfg=a.configuracao;
  if(cfg.expires_at && new Date(cfg.expires_at).getTime()>Date.now()+120000) return {token:cfg.access_token,config:cfg};
  if(!cfg.refresh_token) throw new Error("O token do Pinterest expirou. Reconecte o Pinterest.");
  const id=Deno.env.get("PINTEREST_APP_ID")||"",secret=Deno.env.get("PINTEREST_APP_SECRET")||"";
  if(!id||!secret) throw new Error("Pinterest não está configurado no Supabase. Cadastre PINTEREST_APP_ID e PINTEREST_APP_SECRET.");
  const basic=btoa(id+":"+secret);
  const r=await fetch(PINTEREST_API+"/oauth/token",{method:"POST",headers:{Authorization:"Basic "+basic,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:cfg.refresh_token})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token) throw new Error(d?.message||d?.error_description||"Não foi possível renovar o token do Pinterest. Reconecte o Pinterest.");
  const next={...cfg,access_token:d.access_token,refresh_token:d.refresh_token||cfg.refresh_token,expires_at:new Date(Date.now()+Number(d.expires_in||5184000)*1000).toISOString()};
  const {error:ue}=await db.from("channel_accounts").update({configuracao:next,status:"conectada",updated_at:new Date().toISOString()}).eq("id",a.id);
  if(ue) throw ue;
  return {token:d.access_token,config:next};
}
async function pinterest(a:{db:any;userId:string;imageUrl:string;title:string;description:string;link:string}){
  if(!a.imageUrl) throw new Error("O Pinterest precisa de uma imagem pública para criar o Pin.");
  const {token,config}=await pinterestToken(a.db,a.userId);
  let boardId=String(config?.board_id||"");
  if(!boardId){
    const br=await fetch(PINTEREST_API+"/boards?page_size=25",{headers:{Authorization:"Bearer "+token}});
    const bd=await br.json().catch(()=>({}));
    if(br.ok&&bd?.items?.length) boardId=String(bd.items[0]?.id||"");
  }
  if(!boardId){
    const cr=await fetch(PINTEREST_API+"/boards",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({name:"Ofertas do Robô",description:"Ofertas e promoções selecionadas automaticamente pelo Robô de Ofertas."})});
    const cd=await cr.json().catch(()=>({}));
    if(!cr.ok||!cd?.id) throw new Error(cd?.message||cd?.error?.message||`Pinterest não conseguiu criar o painel (HTTP ${cr.status}).`);
    boardId=String(cd.id);
    await a.db.from("channel_accounts").update({configuracao:{...config,board_id:boardId},updated_at:new Date().toISOString()}).eq("user_id",a.userId).eq("canal","pinterest");
  }
  const body={board_id:boardId,title:(a.title||"Oferta").slice(0,100),description:(a.description||a.title||"Oferta").slice(0,500),link:a.link||undefined,media_source:{source_type:"image_url",url:a.imageUrl,is_standard:true}};
  const pr=await fetch(PINTEREST_API+"/pins",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const pd=await pr.json().catch(()=>({}));
  if(!pr.ok||!pd?.id) throw new Error(pd?.message||pd?.error?.message||`Pinterest recusou o Pin (HTTP ${pr.status}).`);
  return {externalId:String(pd.id),status:"publicada",url:pd?.id?`https://www.pinterest.com/pin/${pd.id}/`:null,boardId};
}

const YOUTUBE_UPLOAD = "https://www.googleapis.com/upload/youtube/v3";
const GOOGLE_OAUTH = "https://oauth2.googleapis.com/token";

async function youtubeToken(db:any,userId:string){
  const {data:t,error}=await db.from("youtube_tokens")
    .select("*").eq("user_id",userId).maybeSingle();
  if(error) throw error;
  if(!t?.access_token) throw new Error("YouTube não está conectado. Conecte novamente o YouTube.");
  if(t.expires_at && new Date(t.expires_at).getTime()>Date.now()+120000) return t.access_token;

  const clientId=Deno.env.get("YOUTUBE_CLIENT_ID")||"";
  const clientSecret=Deno.env.get("YOUTUBE_CLIENT_SECRET")||"";
  if(!clientId||!clientSecret||!t.refresh_token)
    throw new Error("O token do YouTube expirou. Reconecte o YouTube.");

  const r=await fetch(GOOGLE_OAUTH,{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      client_id:clientId,
      client_secret:clientSecret,
      refresh_token:t.refresh_token,
      grant_type:"refresh_token"
    })
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token) throw new Error(d?.error_description||d?.error||"Não foi possível renovar o token do YouTube.");

  const ex=new Date(Date.now()+Number(d.expires_in||3600)*1000).toISOString();
  const {error:ue}=await db.from("youtube_tokens").update({
    access_token:d.access_token,
    expires_at:ex,
    scope:d.scope||t.scope||"https://www.googleapis.com/auth/youtube.upload",
    updated_at:new Date().toISOString()
  }).eq("user_id",userId);
  if(ue) throw ue;
  return d.access_token;
}

async function youtube(a:{db:any;userId:string;videoUrl:string;title:string;description:string;affiliateUrl:string}){
  if(!a.videoUrl) throw new Error("O YouTube exige um vídeo pronto para publicação.");

  const token=await youtubeToken(a.db,a.userId);
  const vr=await fetch(a.videoUrl);
  if(!vr.ok) throw new Error(`Não foi possível baixar o vídeo para o YouTube (HTTP ${vr.status}).`);
  const type=(vr.headers.get("content-type")||"video/mp4").split(";")[0];
  if(!type.startsWith("video/")) throw new Error("O arquivo do conteúdo não é um vídeo válido.");
  const lengthHeader=vr.headers.get("content-length");
  if(!lengthHeader) throw new Error("O vídeo não informou o tamanho do arquivo; não foi possível iniciar o upload do YouTube.");
  const size=Number(lengthHeader);
  if(!Number.isFinite(size)||size<=0) throw new Error("Tamanho de vídeo inválido.");

  const title=(a.title||"Oferta").replace(/\\s+/g," ").trim().slice(0,100)||"Oferta";
  const baseDescription=(a.description||"").trim();
  const affiliateUrl=a.affiliateUrl||"";
  const description=affiliateUrl&& !baseDescription.includes(affiliateUrl)
    ? `${baseDescription}${baseDescription?"\\n\\n":""}🛒 COMPRE AQUI:\\n${affiliateUrl}`.slice(0,5000)
    : baseDescription.slice(0,5000);
  const metadata={
    snippet:{
      title,
      description,
      categoryId:"22"
    },
    status:{
      privacyStatus:"public",
      selfDeclaredMadeForKids:false,
      embeddable:true,
      publicStatsViewable:true
    }
  };

  const init=await fetch(`${YOUTUBE_UPLOAD}/videos?uploadType=resumable&part=snippet,status`,{
    method:"POST",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":"application/json; charset=UTF-8",
      "X-Upload-Content-Length":String(size),
      "X-Upload-Content-Type":type
    },
    body:JSON.stringify(metadata)
  });
  const initText=await init.text();
  let initData:any={};
  try{initData=JSON.parse(initText);}catch{}
  if(!init.ok){
    throw new Error(initData?.error?.message||initData?.error?.errors?.[0]?.reason||`YouTube recusou o início do upload (HTTP ${init.status}).`);
  }
  const uploadUrl=init.headers.get("location");
  if(!uploadUrl) throw new Error("YouTube não retornou a URL de upload.");

  const put=await fetch(uploadUrl,{
    method:"PUT",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":type,
      "Content-Length":String(size)
    },
    body:vr.body
  });
  const putText=await put.text();
  let result:any={};
  try{result=JSON.parse(putText);}catch{}
  if(!put.ok){
    throw new Error(result?.error?.message||result?.error?.errors?.[0]?.reason||`YouTube falhou no upload (HTTP ${put.status}).`);
  }
  const videoId=result?.id;
  if(!videoId) throw new Error("YouTube não retornou o ID do vídeo.");

  let processingStatus="processing";
  try{
    const sr=await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`,{
      headers:{Authorization:`Bearer ${token}`}
    });
    const sd=await sr.json().catch(()=>({}));
    processingStatus=sd?.items?.[0]?.processingDetails?.processingStatus||"processing";
  }catch{}

  return {
    externalId:videoId,
    status:"publicada",
    processingStatus,
    privacyStatus:result?.status?.privacyStatus||"public",
    url:`https://www.youtube.com/shorts/${videoId}`
  };
}

async function youtubeFirstComment(token:string,channelId:string,videoId:string,link:string){
  if(!link||!videoId||!channelId) return null;
  const text="🔗 Clique no link abaixo para comprar 👇\\n"+link;
  const r=await fetch("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json; charset=UTF-8"},body:JSON.stringify({snippet:{channelId:channelId,videoId:videoId,topLevelComment:{snippet:{textOriginal:text}}}})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d?.error?.message||d?.error?.errors?.[0]?.reason||"YouTube não aceitou o comentário (HTTP "+r.status+").");
  return d?.id||null;
}

Deno.serve(async(req)=>{if(req.method==="OPTIONS")return json("ok");try{const url=Deno.env.get("SUPABASE_URL")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",auth=req.headers.get("Authorization")||"";const body=await req.json().catch(()=>({}));if(!url||!service)return json({ok:false,error:"Configuração do Supabase incompleta."},500);if(!auth.startsWith("Bearer "))return json({ok:false,error:"Autorização obrigatória."},401);const db=createClient(url,service);const bearer=auth.slice(7);let userId="";if(bearer===service)userId=String(body?.user_id||"");else{const {data,error}=await db.auth.getUser(bearer);if(error||!data?.user)return json({ok:false,error:"Sessão inválida."},401);userId=data.user.id;}if(!userId)return json({ok:false,error:"Usuário não identificado."},400);const contentId=String(body?.content_id||"");if(!contentId)return json({ok:false,error:"content_id obrigatório."},400);
const {data:content,error:ce}=await db.from("contents").select("id,user_id,offer_id,titulo,legenda,thumbnail_url,imagem_1080_url,video_url,video_status,tipo,status,video_source").eq("id",contentId).eq("user_id",userId).maybeSingle();if(ce)throw ce;if(!content)return json({ok:false,error:"Conteúdo não encontrado."},404);if(!["pronto","aguardando_revisao","aprovado","publicando"].includes(content.status))return json({ok:false,error:`Conteúdo com status \"${content.status}\" não pode ser publicado agora.`},409);if(content.tipo==="video_oferta"&&!content.video_url)return json({ok:false,error:"O vídeo ainda está sendo gerado. Aguarde o vídeo ficar pronto."},409);
const {data:offer,error:oe}=await db.from("offers").select("id,store_provider,affiliate_url,url_produto,imagem_url").eq("id",content.offer_id).maybeSingle();if(oe)throw oe;const isMercadoLivre=String(offer?.store_provider||"").toLowerCase()==="mercadolivre";
const affiliateUrl=isMercadoLivre?String(offer?.affiliate_url||"").trim():String(offer?.affiliate_url||offer?.url_produto||"");
if(isMercadoLivre&&!affiliateUrl)return json({ok:false,error:"O link oficial de afiliado do Mercado Livre ainda não foi gerado para esta oferta."},409);const {data:robotSettings,error:rsErr}=await db.from("robot_settings").select("configuracao").eq("user_id",userId).maybeSingle();if(rsErr)throw rsErr;const cfg=robotSettings?.configuracao||{};const enabledTypes=["instagram","tiktok","youtube_shorts","whatsapp","kwai","facebook","pinterest"].filter((t)=>cfg[t]===true);const requested=Array.isArray(body?.channel_ids)?body.channel_ids.map(String).filter(Boolean):[];let cq=db.from("publication_channels").select("id,tipo,nome,ativo,identificador").eq("user_id",userId).eq("ativo",true);if(requested.length)cq=cq.in("id",requested);else if(enabledTypes.length)cq=cq.in("tipo",enabledTypes);const {data:channels,error:cherr}=await cq;if(cherr)throw cherr;if(!channels?.length)return json({ok:false,error:requested.length?"Nenhuma das redes selecionadas está ativa.":"Nenhum canal ativo foi encontrado."},409);
const results:any[]=[];for(const channel of channels){let publication:any;const {data:existing,error:ee}=await db.from("offer_publications").select("id,status,tentativas,dados,external_post_id").eq("user_id",userId).eq("content_id",content.id).eq("channel_id",channel.id).limit(1).maybeSingle();if(ee)throw ee;if(existing?.status==="publicada"){results.push({channel:channel.tipo,channel_name:channel.nome,ok:true,skipped:true,status:"publicada",publication_id:existing.id,external_post_id:existing.external_post_id});continue;}if(existing?.status==="publicando" && channel.tipo==="tiktok" && existing?.external_post_id){try{const token=await tiktokToken(db,userId);const sr=await fetch(TIKTOK+"/post/publish/status/fetch/",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json; charset=UTF-8"},body:JSON.stringify({publish_id:existing.external_post_id})});const sd=await sr.json().catch(()=>({}));const st=sd?.data?.status;if(st==="PUBLISH_COMPLETE"){await db.from("offer_publications").update({status:"publicada",published_at:new Date().toISOString(),erro:null,dados:{...(existing.dados||{}),canal:"tiktok",publish_id:existing.external_post_id,public_post_ids:sd?.data?.publicaly_available_post_id||[]},updated_at:new Date().toISOString()}).eq("id",existing.id);results.push({channel:channel.tipo,channel_name:channel.nome,ok:true,status:"publicada",skipped:true,publication_id:existing.id,external_post_id:existing.external_post_id});continue;}if(st==="FAILED"){const m=sd?.data?.fail_reason||sd?.error?.message||"TikTok falhou ao concluir a publicação.";await db.from("offer_publications").update({status:"erro",erro:m,dados:{...(existing.dados||{}),canal:"tiktok",publish_id:existing.external_post_id,erro:m},updated_at:new Date().toISOString()}).eq("id",existing.id);results.push({channel:channel.tipo,channel_name:channel.nome,ok:false,publication_id:existing.id,error:m});continue;}results.push({channel:channel.tipo,channel_name:channel.nome,ok:true,status:"publicando",skipped:true,publication_id:existing.id,external_post_id:existing.external_post_id});continue;}catch(e){}}if(existing){publication=existing;await db.from("offer_publications").update({status:"publicando",erro:null,tentativas:Number(existing.tentativas||0)+1,updated_at:new Date().toISOString()}).eq("id",existing.id);}else{const {data:created,error:ie}=await db.from("offer_publications").insert({user_id:userId,offer_id:content.offer_id,channel_id:channel.id,content_id:content.id,status:"publicando",titulo:content.titulo,texto:content.legenda,imagem_url:content.imagem_1080_url||content.thumbnail_url||offer?.imagem_url||"",video_url:content.video_url,dados:{canal:channel.tipo,modo:body?.modo||"manual"}}).select("id,status").single();if(ie)throw ie;publication=created;}
try{let pub:any;if(channel.tipo==="instagram"){const {data:account,error:ae}=await db.from("channel_accounts").select("id,canal,status,configuracao").eq("user_id",userId).eq("canal","instagram").eq("status","conectada").maybeSingle();if(ae)throw ae;if(!account)throw new Error("A conta do Instagram não está conectada.");const cfg=account.configuracao||{};const token=cfg.access_token||"";if(!token)throw new Error("Token do Instagram não encontrado. Reconecte o Instagram.");const me=await graph(`/me?fields=id&access_token=${encodeURIComponent(token)}`);const instagramId=String(me?.id||channel.identificador||"");if(!instagramId)throw new Error("ID do Instagram não encontrado.");pub=await instagram({id:instagramId,token,image:content.imagem_1080_url||content.thumbnail_url||offer?.imagem_url||"",caption:content.legenda||content.titulo||"",link:affiliateUrl});await db.from("offer_publications").update({status:"publicada",external_post_id:pub.externalId,published_at:new Date().toISOString(),erro:null,dados:{canal:"instagram",modo:body?.modo||"manual",instagram_user_id:instagramId,creation_id:pub.creationId},updated_at:new Date().toISOString()}).eq("id",publication.id);
}else if(channel.tipo==="tiktok"){pub=await tiktok({db,userId,videoUrl:content.video_url,title:content.titulo||"Oferta",isAigc:String(content.video_source||"").toLowerCase().includes("ai")});const finalStatus=pub.status==="publicada"?"publicada":"publicando";await db.from("offer_publications").update({status:finalStatus,external_post_id:pub.externalId,published_at:finalStatus==="publicada"?new Date().toISOString():null,erro:null,dados:{canal:"tiktok",modo:body?.modo||"manual",publish_id:pub.publishId,public_post_ids:pub.publicPostIds||[]},updated_at:new Date().toISOString()}).eq("id",publication.id);
}else if(channel.tipo==="kwai"){pub=await kwai({db,userId,videoUrl:content.video_url,imageUrl:content.imagem_1080_url||content.thumbnail_url||offer?.imagem_url||"",title:content.titulo||"Oferta"});await db.from("offer_publications").update({status:pub.status,external_post_id:pub.externalId,published_at:pub.status==="publicada"?new Date().toISOString():null,erro:null,dados:{canal:"kwai",modo:body?.modo||"manual",photo_id:pub.photoId,url:pub.url},updated_at:new Date().toISOString()}).eq("id",publication.id);
}else if(channel.tipo==="pinterest"){pub=await pinterest({db,userId,imageUrl:content.imagem_1080_url||content.thumbnail_url||offer?.imagem_url||"",title:content.titulo||"Oferta",description:content.legenda||content.titulo||"Oferta",link:affiliateUrl});await db.from("offer_publications").update({status:"publicada",external_post_id:pub.externalId,published_at:new Date().toISOString(),erro:null,dados:{canal:"pinterest",modo:body?.modo||"manual",pin_id:pub.externalId,url:pub.url,board_id:pub.boardId},updated_at:new Date().toISOString()}).eq("id",publication.id);
}else if(channel.tipo==="youtube_shorts"){pub=await youtube({db,userId,videoUrl:content.video_url,title:content.titulo||"Oferta",description:content.legenda||content.titulo||"Oferta",affiliateUrl});let commentId=null;try{commentId=await youtubeFirstComment(await youtubeToken(db,userId),String(channel.identificador||""),pub.externalId,affiliateUrl);}catch(e){console.error("YOUTUBE_COMENTARIO",e);}await db.from("offer_publications").update({status:"publicada",external_post_id:pub.externalId,published_at:new Date().toISOString(),erro:null,dados:{canal:"youtube_shorts",modo:body?.modo||"manual",youtube_video_id:pub.externalId,processing_status:pub.processingStatus,privacy_status:pub.privacyStatus,url:pub.url,first_comment_id:commentId},updated_at:new Date().toISOString()}).eq("id",publication.id);
}else{throw new Error(`O conector de publicação da rede ${channel.nome||channel.tipo} ainda não está implantado.`);}results.push({channel:channel.tipo,channel_name:channel.nome,ok:true,status:pub.status,publication_id:publication.id,external_post_id:pub.externalId});}catch(e){const m=errText(e);console.error("PUBLISH-CHANNEL-ERROR",JSON.stringify({channel:channel.tipo,content_id:content.id,publication_id:publication.id,error:m}));await db.from("offer_publications").update({status:"erro",erro:m,dados:{canal:channel.tipo,erro:m},updated_at:new Date().toISOString()}).eq("id",publication.id);results.push({channel:channel.tipo,channel_name:channel.nome,ok:false,publication_id:publication.id,error:m});}}
const succeeded=results.filter(r=>r.ok).length,failed=results.filter(r=>!r.ok).length;const anyPublished=results.some(r=>r.ok&&r.status==="publicada");if(anyPublished)await db.from("contents").update({status:"publicado",updated_at:new Date().toISOString()}).eq("id",content.id).eq("user_id",userId);else if(!succeeded)await db.from("contents").update({status:"pronto",updated_at:new Date().toISOString()}).eq("id",content.id).eq("user_id",userId);return json({ok:succeeded>0,publicadas:results.filter(r=>r.ok&&r.status==="publicada").length,publicando:results.filter(r=>r.ok&&r.status==="publicando").length,erros:failed,resultados:results,message:succeeded>0?"Processamento das redes concluído.":"Nenhuma rede conseguiu publicar."},succeeded>0?200:502);}catch(e){console.error("PUBLISH-CONTENT",e);return json({ok:false,error:errText(e)},500);}});
