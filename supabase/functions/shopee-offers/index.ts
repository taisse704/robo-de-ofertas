import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), {status, headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}}); }
function getUserId(req: Request): string | null { const auth=req.headers.get("Authorization")||""; const token=auth.startsWith("Bearer ")?auth.slice(7):""; if(!token)return null; try { const payload=JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))); return typeof payload.sub==="string"?payload.sub:null; } catch{return null;} }
async function sha256Hex(value:string){ const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join(""); }
async function callShopee(query:string){ const appId=Deno.env.get("SHOPEE_APP_ID")||""; const secret=Deno.env.get("SHOPEE_APP_SECRET")||""; if(!appId||!secret)return{ok:false,status:503,error:"Credenciais da Shopee ainda não configuradas. Cadastre SHOPEE_APP_ID e SHOPEE_APP_SECRET nos Secrets."}; const body=JSON.stringify({query}); const timestamp=Math.floor(Date.now()/1000).toString(); const signature=await sha256Hex(appId+timestamp+body+secret); const response=await fetch(ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`},body}); const data=await response.json().catch(()=>({})); return{ok:response.ok&&!data?.errors?.length,status:response.status,data,error:data?.errors?.[0]?.message||null}; }
async function rest(path:string,options:RequestInit={}){ return fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...options,headers:{apikey:SERVICE_ROLE_KEY,Authorization:`Bearer ${SERVICE_ROLE_KEY}`,"Content-Type":"application/json",...(options.headers||{})}}); }
async function ensurePlatform(){ const r=await rest("platforms?nome=eq.Shopee&select=id&limit=1"); const rows=await r.json().catch(()=>[]); if(Array.isArray(rows)&&rows[0]?.id)return rows[0].id; const c=await rest("platforms",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({nome:"Shopee",tipo:"afiliado",ativo:true})}); const created=await c.json().catch(()=>[]); return Array.isArray(created)?created[0]?.id:created?.id; }
function buildQuery(keyword:string, limit:number){ const safe=JSON.stringify(keyword).slice(1,-1); return `{ productOfferV2(keyword: "${safe}", listType: 0, sortType: 1, page: 1, limit: ${Math.min(limit,50)}) { nodes { itemId productName productLink offerLink imageUrl priceMin priceMax priceDiscountRate sales ratingStar commissionRate sellerCommissionRate shopeeCommissionRate commission shopId shopName shopType periodStartTime periodEndTime } pageInfo { page limit hasNextPage } } }`; }

// Normaliza o titulo para detectar anuncios do mesmo produto mesmo quando a Shopee
// altera acentos, pontuacao, ordem ou usa termos equivalentes.
function normalizeTitle(value:string){
  const aliases:Record<string,string>={
    "running":"tenis","shoes":"tenis","shoe":"tenis","sneaker":"tenis","sneakers":"tenis",
    "professional":"profissional","profissional":"profissional","full":"completo","complete":"completo",
    "carbon":"carbono","plate":"placa","corrida":"corrida","maratona":"corrida","run":"corrida",
    "powerbank":"powerbank","power":"power","bank":"bank","bluetooth":"bluetooth","digital":"digital",
    "portable":"portatil","portatil":"portatil","neck":"pescoco","shoulder":"ombro","massage":"massageador",
    "massagem":"massageador","massageador":"massageador","thermal":"termico","cup":"copo","garrafa":"garrafa"
  };
  const stop=new Set(["de","da","do","das","dos","para","com","sem","e","em","um","uma","o","a","os","as","no","na","nos","nas","por","original","novo","nova","kit","tipo","modelo","cor","cores","tamanho","tamanhos","adulto","adulta","infantil","feminino","masculino"]);
  const base=value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
  return base.split(/\s+/).filter(Boolean).map(t=>aliases[t]||t).filter(t=>!stop.has(t));
}
function titleKey(value:string){ return normalizeTitle(value).join(" "); }
function titleSimilarity(a:string,b:string){
  const A=new Set(normalizeTitle(a)), B=new Set(normalizeTitle(b));
  if(!A.size||!B.size)return 0;
  let common=0; for(const t of A)if(B.has(t))common++;
  const union=new Set([...A,...B]).size;
  const jaccard=common/union;
  const containment=common/Math.min(A.size,B.size);
  return Math.max(jaccard,containment*0.92);
}
function isSimilarProduct(a:string,b:string){
  const ka=titleKey(a), kb=titleKey(b);
  if(ka===kb)return true;
  const sim=titleSimilarity(a,b);
  return sim>=0.72;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({ok:false,error:"Use POST."},405);
  const userId=getUserId(req); if(!userId)return json({ok:false,error:"Usuário não autenticado."},401);
  if(!SUPABASE_URL||!SERVICE_ROLE_KEY)return json({ok:false,error:"Configuração do Supabase incompleta."},500);
  const body=await req.json().catch(()=>({}));
  const limit=Math.min(Math.max(Number(body.limit)||20,1),50);
  const diagnostics:any[]=[]; let all:any[]=[];
  for(const keyword of ["", "ofertas", "promoção"]){
    const result=await callShopee(buildQuery(keyword,50)); const nodes=result.data?.data?.productOfferV2?.nodes||[];
    diagnostics.push({tipo:"busca_geral",keyword:keyword||"(geral)",status:result.status,resultados:nodes.length,erro:result.error});
    all.push(...nodes.map((x:any)=>({...x,keyword:keyword||null})));
    if(nodes.length>=50)break;
  }

  // Primeiro remove duplicatas pelo ID externo. Depois elimina anúncios
  // praticamente iguais pelo titulo normalizado, mantendo o melhor score.
  const unique=Array.from(new Map(all.filter((x:any)=>x?.itemId!=null).map((x:any)=>[String(x.itemId),x])).values());
  const ranked=unique.map((p:any)=>{ const sales=Math.max(Number(p.sales)||0,0); const discount=Math.max(Math.min(Number(p.priceDiscountRate)||0,100),0); const rating=Math.max(Number(p.ratingStar)||0,0); return {...p,_rankScore:Math.log10(sales+1)*18+discount*1.2+rating*2}; }).sort((a:any,b:any)=>b._rankScore-a._rankScore);

  const selected:any[]=[]; let similaresFiltrados=0;
  for(const candidate of ranked){
    if(selected.some(x=>isSimilarProduct(String(candidate.productName||""),String(x.productName||"")))){ similaresFiltrados++; continue; }
    selected.push(candidate);
    if(selected.length>=limit)break;
  }

  const platformId=await ensurePlatform(); if(!platformId)return json({ok:false,error:"Não foi possível localizar/cadastrar a plataforma Shopee."},500);

  // Carrega ofertas existentes para impedir que uma nova busca recrie
  // o mesmo produto com outro itemId/titulo semelhante.
  const existingResponse=await rest(`offers?user_id=eq.${encodeURIComponent(userId)}&platform_id=eq.${encodeURIComponent(platformId)}&store_provider=eq.shopee&select=id,product_external_id,titulo,preco_atual,comissao_estimada,score_oferta&limit=5000`);
  const existingRows=await existingResponse.json().catch(()=>[]);
  const existing=Array.isArray(existingRows)?existingRows:[];

  let novas=0,atualizadas=0,duplicatasEvitadas=0,similaresExistentesEvitados=0; const ofertas:any[]=[];
  for(const p of selected){
    const productName=String(p.productName||"Produto Shopee");
    const price=Number(p.priceMin), discount=Number(p.priceDiscountRate); const current=Number.isFinite(price)&&price>0?price:null; const discountPct=Number.isFinite(discount)&&discount>0?discount:0; const original=current&&discountPct>0&&discountPct<100?Number((current/(1-discountPct/100)).toFixed(2)):null;
    const values:any={user_id:userId,platform_id:platformId,titulo:productName,product_external_id:String(p.itemId),url_produto:p.productLink||null,preco_atual:current,preco_anterior:original,desconto_percentual:discountPct,comissao_percentual:Number(p.commissionRate)||null,comissao_estimada:Number(p.commission)||null,moeda:"BRL",disponibilidade:true,classificacao:discountPct>=10?"interessante":"verificar",permitido_afiliado:true,permitido_divulgacao:true,imagem_url:p.imageUrl||null,dados_origem:{provider:"shopee",...p,ranking:{score:p._rankScore,sales:Number(p.sales)||0,discount:discountPct}},store_provider:"shopee",store_product_url:p.productLink||null,affiliate_url:p.offerLink||null,oferta_tipo:"produto",score_oferta:p._rankScore,coletada_em:new Date().toISOString(),atualizada_em:new Date().toISOString()};

    const sameId=existing.find((x:any)=>String(x.product_external_id||"")===String(p.itemId));
    const sameTitle=existing.find((x:any)=>isSimilarProduct(productName,String(x.titulo||"")));
    const duplicate=sameId||sameTitle;

    if(duplicate){
      const offerId=duplicate.id;
      // Se for o mesmo produto, atualiza os dados. Se for apenas um anuncio
      // equivalente, não cria uma segunda oferta.
      if(sameId){
        await rest(`offers?id=eq.${encodeURIComponent(offerId)}&user_id=eq.${encodeURIComponent(userId)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(values)});
        atualizadas++; ofertas.push({id:offerId,...values});
      } else {
        similaresExistentesEvitados++; duplicatasEvitadas++;
      }
      continue;
    }

    const insertedResponse=await rest("offers",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(values)}); const inserted=await insertedResponse.json().catch(()=>[]); const createdId=Array.isArray(inserted)?inserted[0]?.id:inserted?.id;
    if(insertedResponse.ok){ novas++; ofertas.push({id:createdId,...values}); }
  }

  return json({ok:true,provider:"shopee",modo_busca:"geral_mais_vendidos_e_melhores_descontos",categorias_forcadas:false,produtos:unique.length,selecionados:selected.length,novas_ofertas:novas,atualizadas,duplicatas_evitadas:duplicatasEvitadas,similares_filtrados:similaresFiltrados,similares_existentes_evitados:similaresExistentesEvitados,diagnostico:diagnostics,ofertas});
});