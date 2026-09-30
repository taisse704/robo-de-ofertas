import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ML="https://api.mercadolibre.com", TERMS=["celular","notebook","air fryer","smart tv"], MAX=30, SEARCH_LIMIT=20, TIMEOUT=10000;
Deno.serve(async(req)=>{
 const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const out=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,"Content-Type":"application/json"}});
 try{
  const auth=req.headers.get("Authorization")||"", url=Deno.env.get("SUPABASE_URL")||"", key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!auth.startsWith("Bearer "))return out({ok:false,error:"Autorização obrigatória."},401);
  if(!url||!key)return out({ok:false,error:"Configuração do Supabase incompleta."},500);
  const db=createClient(url,key), body=await req.json().catch(()=>({})), bearer=auth.slice(7);
  let userId="";
  if(bearer===key) userId=String(body?.user_id||"");
  else {const {data,error}=await db.auth.getUser(bearer);if(error||!data?.user)return out({ok:false,error:"Sessão inválida."},401);userId=data.user.id;}
  if(!userId)return out({ok:false,error:"user_id obrigatório."},400);
  const limit=Math.min(Math.max(Number(body?.limit)||20,1),MAX), somente=body?.somente_descontos===true;
  const {data:platform,error:pe}=await db.from("platforms").select("id,nome").eq("nome","Mercado Livre").eq("ativo",true).limit(1).maybeSingle();
  if(pe||!platform)return out({ok:false,error:"Plataforma Mercado Livre não cadastrada."},400);
  const {data:accounts,error:ae}=await db.from("affiliate_accounts").select("configuracao").eq("user_id",userId).eq("platform_id",platform.id).eq("status","conectada").order("updated_at",{ascending:false}).limit(1);
  if(ae||!accounts?.length)return out({ok:false,error:"Mercado Livre não está conectado."},400);
  const cfg=accounts[0].configuracao||{};
  if(typeof cfg.access_token!=="string"||!cfg.access_token)return out({ok:false,error:"Token do Mercado Livre não encontrado."},400);
  const accessToken=cfg.access_token;
  async function search(term){
   const c=new AbortController(), t=setTimeout(()=>c.abort(),TIMEOUT);
   try{
    const r=await fetch(ML+"/sites/MLB/search?limit="+SEARCH_LIMIT+"&q="+encodeURIComponent(term)+"&sort=relevance",{
      headers:{Accept:"application/json","Authorization":"Bearer "+accessToken,"User-Agent":"RoboDeOfertas/1.0"},
      signal:c.signal
    });
    const raw=await r.text();let data=null;try{data=JSON.parse(raw)}catch{}
    return {status:r.status,ok:r.ok,data};
   } finally{clearTimeout(t);}
  }
  function make(item,term){
   const current=Number(item?.price);if(!item?.id||!Number.isFinite(current)||current<=0)return null;
   const old=Number(item?.original_price), original=Number.isFinite(old)&&old>current?old:null, discount=original?Math.round((original-current)/original*100):0;
   if(somente&&discount<=0)return null;
   return {id:String(item.id),title:item.title||"Produto Mercado Livre",current,original,discount,image:item.thumbnail||item.pictures?.[0]?.url||null,url:item.permalink||null,score:discount*10+(item.shipping?.free_shipping?5:0),term};
  }
  const candidates=[],diagnostico=[];
  for(const term of TERMS){const r=await search(term),d={term,status:r.status,resultados_api:Array.isArray(r.data?.results)?r.data.results.length:0,candidatos_validos:0};if(r.ok&&Array.isArray(r.data?.results))for(const item of r.data.results){const o=make(item,term);if(o){candidates.push(o);d.candidatos_validos++;}}diagnostico.push(d);}
  const unique=[],seen=new Set();
  for(const o of candidates.sort((a,b)=>b.score-a.score||b.discount-a.discount||a.current-b.current)){if(seen.has(o.id))continue;seen.add(o.id);unique.push(o);if(unique.length>=limit)break;}
  let novas=0,atualizadas=0;const ofertas=[];
  for(const o of unique){
   const now=new Date().toISOString(), values={user_id:userId,platform_id:platform.id,product_id:null,product_external_id:o.id,titulo:o.title,url_produto:o.url,store_provider:"mercadolivre",store_product_url:o.url,preco_atual:o.current,preco_anterior:o.original,desconto_percentual:o.discount,moeda:"BRL",disponibilidade:true,classificacao:o.discount>=10?"interessante":"verificar",permitido_afiliado:true,permitido_divulgacao:true,imagem_url:o.image,dados_origem:{fonte:"mercadolivre-search-publico",termo:o.term,item_id:o.id},promocao_id_externo:null,oferta_tipo:"oferta",melhor_preco:o.score>0,score_oferta:o.score,atualizada_em:now,coletada_em:now};
   const {data:ex,error:fe}=await db.from("offers").select("id").eq("user_id",userId).eq("platform_id",platform.id).eq("product_external_id",o.id).limit(1).maybeSingle();if(fe)throw fe;
   let id=ex?.id;if(id){const {error}=await db.from("offers").update(values).eq("id",id).eq("user_id",userId);if(error)throw error;atualizadas++;}else{const {data:ins,error}=await db.from("offers").insert({...values,encontrada_em:now}).select("id").single();if(error)throw error;id=ins.id;novas++;}
   ofertas.push({id,external_id:o.id,title:o.title,current:o.current,original:o.original,discount:o.discount,image:o.image,permalink:o.url,score:o.score});
  }
  return out({ok:true,produtos_encontrados:ofertas.length,novas,atualizadas,limite:limit,ofertas,diagnostico});
 }catch(e){console.error("PROCESS-OFFERS ERRO:",e);return out({ok:false,error:e?.message||"Erro interno."},500);}
});