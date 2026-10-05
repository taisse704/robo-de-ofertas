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
  const {data:settings}=await db.from("robot_settings").select("configuracao,gerar_texto,gerar_imagem,gerar_video").eq("user_id",userId).maybeSingle();
  const cfg=settings?.configuracao||{}, approval=cfg.aprovacao_antes_publicar===true, status=approval?"aguardando_revisao":"pronto";
  const selectedOfferIds=Array.isArray(body?.offer_ids) ? body.offer_ids.map(String).filter(Boolean).slice(0,50) : [];
  let offersQuery=db.from("offers").select("*").eq("user_id",userId).eq("permitido_divulgacao",true);
  if(selectedOfferIds.length) offersQuery=offersQuery.in("id",selectedOfferIds);
  const {data:offers,error}=await offersQuery.order("score_oferta",{ascending:false}).order("created_at",{ascending:false}).limit(selectedOfferIds.length || 10);if(error)throw error;
  if(!offers?.length)return out({ok:true,count:0,message:"Nenhuma oferta pronta para gerar conteúdo."});
  let count=0;const conteudos=[];
  for(const offer of offers){
   const {data:exists}=await db.from("contents").select("id").eq("user_id",userId).eq("offer_id",offer.id).in("status",["rascunho","aguardando_revisao","pronto","publicando","publicado"]).limit(1).maybeSingle();if(exists)continue;
   const price=Number(offer.preco_atual||0),old=Number(offer.preco_anterior||0),discount=Number(offer.desconto_percentual||0),title=offer.titulo||"Oferta especial",link=offer.affiliate_url||offer.url_produto||"";
   let legenda="🔥 "+title+"\n\n💰 Por R$ "+price.toFixed(2).replace(".",",");if(old>price)legenda+=" (antes R$ "+old.toFixed(2).replace(".",",")+")";if(discount>0)legenda+="\n🏷️ "+discount+"% OFF";legenda+="\n\n🛒 Aproveite: "+link;
   const {data:content,error:ce}=await db.from("contents").insert({user_id:userId,offer_id:offer.id,tipo:settings?.gerar_video?"video_oferta":"oferta_rapida",formato:"9:16",titulo:title,legenda,cta:"Aproveite a oferta",thumbnail_url:offer.imagem_url,status,dados_geracao:{fonte:"generate-content",affiliate_url:link,gerar_texto:settings?.gerar_texto!==false,gerar_imagem:settings?.gerar_imagem!==false,gerar_video:settings?.gerar_video===true}}).select().single();if(ce)throw ce;conteudos.push(content);count++;
  }
  return out({ok:true,count,conteudos});
 }catch(e){console.error("GENERATE-CONTENT ERRO:",e);return out({ok:false,error:e?.message||"Erro interno."},500);}
});