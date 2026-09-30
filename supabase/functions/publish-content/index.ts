import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const out=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,"Content-Type":"application/json"}});
 try{
  const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",auth=req.headers.get("Authorization")||"",body=await req.json().catch(()=>({}));
  if(!url||!key)return out({ok:false,error:"Configuração do Supabase incompleta."},500);if(!auth.startsWith("Bearer "))return out({ok:false,error:"Autorização obrigatória."},401);
  const db=createClient(url,key),bearer=auth.slice(7);let userId="";
  if(bearer===key)userId=String(body?.user_id||"");else{const {data,error}=await db.auth.getUser(bearer);if(error||!data?.user)return out({ok:false,error:"Sessão inválida."},401);userId=data.user.id;}
  if(!userId)return out({ok:false,error:"user_id obrigatório."},400);
  const {data:settings}=await db.from("robot_settings").select("configuracao,publicar_automaticamente").eq("user_id",userId).maybeSingle();
  if(settings?.publicar_automaticamente===false)return out({ok:true,count:0,message:"Publicação automática desativada."});
  if(settings?.configuracao?.aprovacao_antes_publicar===true)return out({ok:true,count:0,message:"Aprovação antes de publicar está ativa."});
  const {data:channels,error:ch}=await db.from("publication_channels").select("id,tipo,nome,ativo").eq("user_id",userId).eq("ativo",true);if(ch)throw ch;
  if(!channels?.length)return out({ok:true,count:0,message:"Nenhum canal de publicação ativo."});
  const {data:contents,error:ce}=await db.from("contents").select("id,offer_id,titulo,legenda,thumbnail_url,video_url,status").eq("user_id",userId).eq("status","pronto").limit(10);if(ce)throw ce;
  if(!contents?.length)return out({ok:true,count:0,message:"Nenhum conteúdo pronto para publicação."});
  let count=0;const filas=[];
  for(const content of contents)for(const channel of channels){
   const {data:exists}=await db.from("offer_publications").select("id").eq("user_id",userId).eq("content_id",content.id).eq("channel_id",channel.id).limit(1).maybeSingle();if(exists)continue;
   const {data:row,error}=await db.from("offer_publications").insert({user_id:userId,offer_id:content.offer_id,channel_id:channel.id,content_id:content.id,status:"pendente",titulo:content.titulo,texto:content.legenda,imagem_url:content.thumbnail_url,video_url:content.video_url,dados:{canal:channel.tipo,modo:"fila"}}).select().single();if(error)throw error;filas.push(row);count++;
  }
  if(count)for(const content of contents)await db.from("contents").update({status:"publicando",updated_at:new Date().toISOString()}).eq("id",content.id).eq("user_id",userId);
  return out({ok:true,count,enfileiradas:filas.length,publicacoes:filas});
 }catch(e){console.error("PUBLISH-CONTENT ERRO:",e);return out({ok:false,error:e?.message||"Erro interno."},500);}
});