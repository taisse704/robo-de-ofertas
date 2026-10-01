import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {status, headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
function getUserId(req: Request): string | null {
  const auth=req.headers.get("Authorization")||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!token)return null;
  try {
    const payload=JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
    return typeof payload.sub==="string"?payload.sub:null;
  } catch{return null;}
}
async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function callShopee(query:string){
  const appId=Deno.env.get("SHOPEE_APP_ID")||"";
  const secret=Deno.env.get("SHOPEE_APP_SECRET")||"";
  if(!appId||!secret)return{ok:false,status:503,error:"Credenciais da Shopee ainda não configuradas. Cadastre SHOPEE_APP_ID e SHOPEE_APP_SECRET nos Secrets."};
  const body=JSON.stringify({query});
  const timestamp=Math.floor(Date.now()/1000).toString();
  const signature=await sha256Hex(appId+timestamp+body+secret);
  const response=await fetch(ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`},body});
  const data=await response.json().catch(()=>({}));
  return{ok:response.ok&&!data?.errors?.length,status:response.status,data,error:data?.errors?.[0]?.message||null};
}
async function rest(path:string,options:RequestInit={}){
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...options,headers:{apikey:SERVICE_ROLE_KEY,Authorization:`Bearer ${SERVICE_ROLE_KEY}`,"Content-Type":"application/json",...(options.headers||{})}});
}
async function ensurePlatform(){
  const r=await rest("platforms?nome=eq.Shopee&select=id&limit=1");
  const rows=await r.json().catch(()=>[]);
  if(Array.isArray(rows)&&rows[0]?.id)return rows[0].id;
  const c=await rest("platforms",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({nome:"Shopee",tipo:"afiliado",ativo:true})});
  const created=await c.json().catch(()=>[]);
  return Array.isArray(created)?created[0]?.id:created?.id;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({ok:false,error:"Use POST."},405);
  const userId=getUserId(req);
  if(!userId)return json({ok:false,error:"Usuário não autenticado."},401);
  if(!SUPABASE_URL||!SERVICE_ROLE_KEY)return json({ok:false,error:"Configuração do Supabase incompleta."},500);

  const body=await req.json().catch(()=>({}));
  const keywords=Array.isArray(body.keywords)?body.keywords.filter((x:unknown)=>typeof x==="string"&&x.trim()).slice(0,8):["celular","notebook","air fryer","smart tv"];
  const limit=Math.min(Math.max(Number(body.limit)||20,1),50);
  const all:any[]=[];const diagnostics:any[]=[];

  for(const keyword of keywords){
    const safe=JSON.stringify(String(keyword)).slice(1,-1);
    const query=`{ productOfferV2(keyword: "${safe}", listType: 0, sortType: 1, page: 1, limit: ${Math.min(limit,20)}) { nodes { itemId productName productLink offerLink imageUrl priceMin priceMax priceDiscountRate sales ratingStar commissionRate sellerCommissionRate shopeeCommissionRate commission shopId shopName shopType periodStartTime periodEndTime } pageInfo { page limit hasNextPage } } }`;
    const result=await callShopee(query);
    const nodes=result.data?.data?.productOfferV2?.nodes||[];
    diagnostics.push({keyword,status:result.status,resultados:nodes.length,erro:result.error});
    all.push(...nodes.map((x:any)=>({...x,keyword})));
  }

  const unique=Array.from(new Map(all.filter((x:any)=>x?.itemId!=null).map((x:any)=>[String(x.itemId),x])).values());
  const platformId=await ensurePlatform();
  if(!platformId)return json({ok:false,error:"Não foi possível localizar/cadastrar a plataforma Shopee."},500);

  let novas=0,atualizadas=0;const ofertas:any[]=[];
  for(const p of unique.slice(0,limit)){
    const price=Number(p.priceMin);
    const discount=Number(p.priceDiscountRate);
    const current=Number.isFinite(price)&&price>0?price:null;
    const discountPct=Number.isFinite(discount)&&discount>0?discount:0;
    const original=current&&discountPct>0&&discountPct<100?Number((current/(1-discountPct/100)).toFixed(2)):null;
    const values:any={user_id:userId,platform_id:platformId,titulo:p.productName||"Produto Shopee",product_external_id:String(p.itemId),url_produto:p.productLink||null,preco_atual:current,preco_anterior:original,desconto_percentual:discountPct,comissao_percentual:Number(p.commissionRate)||null,comissao_estimada:Number(p.commission)||null,moeda:"BRL",disponibilidade:true,classificacao:discountPct>=10?"interessante":"verificar",permitido_afiliado:true,permitido_divulgacao:true,imagem_url:p.imageUrl||null,dados_origem:{provider:"shopee",...p},store_provider:"shopee",store_product_url:p.productLink||null,affiliate_url:p.offerLink||null,oferta_tipo:"produto",score_oferta:discountPct*10+(Number(p.sales)||0)/100,coletada_em:new Date().toISOString(),atualizada_em:new Date().toISOString()};
    const find=await rest(`offers?user_id=eq.${encodeURIComponent(userId)}&platform_id=eq.${encodeURIComponent(platformId)}&product_external_id=eq.${encodeURIComponent(String(p.itemId))}&select=id&limit=1`);
    const existing=await find.json().catch(()=>[]);
    const offerId=Array.isArray(existing)?existing[0]?.id:null;
    if(offerId){
      await rest(`offers?id=eq.${encodeURIComponent(offerId)}&user_id=eq.${encodeURIComponent(userId)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(values)});
      atualizadas++;ofertas.push({id:offerId,...values});
    }else{
      const insertedResponse=await rest("offers",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(values)});
      const inserted=await insertedResponse.json().catch(()=>[]);
      const createdId=Array.isArray(inserted)?inserted[0]?.id:inserted?.id;
      novas++;ofertas.push({id:createdId,...values});
    }
  }
  return json({ok:true,provider:"shopee",produtos:unique.length,novas_ofertas:novas,atualizadas,diagnostico:diagnostics,ofertas});
});