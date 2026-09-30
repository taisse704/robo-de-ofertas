import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML="https://api.mercadolibre.com";
const TERMS=["celular","notebook","air fryer","smart tv"];
const MAX=30;
const SEARCH_LIMIT=20;
const REQUEST_TIMEOUT_MS=10000;

Deno.serve(async(req)=>{
  const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
  try{
    const auth=req.headers.get("Authorization");
    if(!auth?.startsWith("Bearer ")) return json({ok:false,error:"Autorização obrigatória."},401);
    const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
    const serviceRoleKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    if(!supabaseUrl||!serviceRoleKey) return json({ok:false,error:"Configuração do Supabase incompleta."},500);
    const db=createClient(supabaseUrl,serviceRoleKey);
    const {data:userData,error:userError}=await db.auth.getUser(auth.slice(7));
    if(userError||!userData?.user) return json({ok:false,error:"Sessão inválida."},401);
    const userId=userData.user.id;
    const body=await req.json().catch(()=>({}));
    const limit=Math.min(Math.max(Number(body?.limit)||20,1),MAX);
    const somenteDescontos=body?.somente_descontos===true;

    const {data:platform,error:platformError}=await db.from("platforms").select("id,nome").eq("nome","Mercado Livre").eq("ativo",true).limit(1).maybeSingle();
    if(platformError||!platform) return json({ok:false,error:"Plataforma Mercado Livre não cadastrada."},400);

    const {data:accounts,error:accountError}=await db.from("affiliate_accounts").select("id,status,configuracao,updated_at").eq("user_id",userId).eq("platform_id",platform.id).eq("status","conectada").order("updated_at",{ascending:false}).limit(1);
    if(accountError||!accounts?.length) return json({ok:false,error:"Mercado Livre não está conectado."},400);

    const cfg=accounts[0].configuracao&&typeof accounts[0].configuracao==="object"?accounts[0].configuracao:{};
    const accessToken=typeof cfg.access_token==="string"?cfg.access_token:"";
    if(!accessToken) return json({ok:false,error:"Token do Mercado Livre não encontrado."},400);

    async function search(term:string){
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
      try{
        const url=ML+"/sites/MLB/search?limit="+SEARCH_LIMIT+"&q="+encodeURIComponent(term)+"&sort=relevance";
        const r=await fetch(url,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"},signal:controller.signal});
        const text=await r.text();
        let data:any=null;
        try{data=JSON.parse(text);}catch{}
        return {ok:r.ok,status:r.status,data};
      }finally{clearTimeout(timer);}
    }

    function makeOffer(item:any,term:string){
      const current=Number(item?.price);
      if(!item?.id||!Number.isFinite(current)||current<=0) return null;
      const originalRaw=Number(item?.original_price);
      const original=Number.isFinite(originalRaw)&&originalRaw>current?originalRaw:null;
      const discount=original?Math.round(((original-current)/original)*100):0;
      if(somenteDescontos&&discount<=0) return null;
      return {
        external_id:String(item.id),
        product_external_id:String(item.id),
        title:item.title||"Produto Mercado Livre",
        current,original,discount,
        image:item.thumbnail||item.pictures?.[0]?.url||null,
        permalink:item.permalink||null,
        score:discount*10+(item.shipping?.free_shipping?5:0),
        term
      };
    }

    const candidates:any[]=[];
    const diagnostics:any[]=[];
    for(const term of TERMS){
      const result=await search(term);
      const diagnostic={term,status:result.status,resultados_api:Array.isArray(result.data?.results)?result.data.results.length:0,candidatos_validos:0};
      if(result.ok&&Array.isArray(result.data?.results)){
        for(const item of result.data.results){
          const offer=makeOffer(item,term);
          if(offer){candidates.push(offer);diagnostic.candidatos_validos++;}
        }
      }
      diagnostics.push(diagnostic);
    }

    const unique:any[]=[];
    const seen=new Set<string>();
    for(const item of candidates.sort((a,b)=>b.score-a.score||b.discount-a.discount||a.current-b.current)){
      if(seen.has(item.external_id)) continue;
      seen.add(item.external_id);
      unique.push(item);
      if(unique.length>=limit) break;
    }

    let novas=0,atualizadas=0;
    const ofertas:any[]=[];
    for(const o of unique){
      const now=new Date().toISOString();
      const values:any={
        user_id:userId,platform_id:platform.id,product_id:null,product_external_id:o.external_id,
        titulo:o.title,url_produto:o.permalink,store_provider:"mercadolivre",store_product_url:o.permalink,
        preco_atual:o.current,preco_anterior:o.original,desconto_percentual:o.discount,moeda:"BRL",
        disponibilidade:true,classificacao:o.discount>=10?"interessante":"verificar",
        permitido_afiliado:true,permitido_divulgacao:true,imagem_url:o.image,
        dados_origem:{fonte:"mercadolivre-search",termo:o.term,item_id:o.external_id},
        promocao_id_externo:null,oferta_tipo:"oferta",melhor_preco:o.score>0,score_oferta:o.score,
        atualizada_em:now,coletada_em:now
      };
      const {data:existing,error:findError}=await db.from("offers").select("id").eq("user_id",userId).eq("platform_id",platform.id).eq("product_external_id",o.external_id).limit(1).maybeSingle();
      if(findError) throw findError;
      let offerId=existing?.id||null;
      if(offerId){
        const {error}=await db.from("offers").update(values).eq("id",offerId).eq("user_id",userId);
        if(error) throw error;
        atualizadas++;
      }else{
        const {data:inserted,error}=await db.from("offers").insert({...values,encontrada_em:now}).select("id").single();
        if(error) throw error;
        offerId=inserted.id;
        novas++;
      }
      ofertas.push({id:offerId,external_id:o.external_id,title:o.title,current:o.current,original:o.original,discount:o.discount,image:o.image,permalink:o.permalink,score:o.score});
      if(ofertas.length>=limit) break;
    }

    return json({ok:true,produtos_encontrados:ofertas.length,novas,atualizadas,limite:limit,ofertas,diagnostico:diagnostics});
  }catch(e){
    console.error("PROCESS-OFFERS ERRO:",e);
    return json({ok:false,error:e instanceof Error?e.message:"Erro interno."},500);
  }
});