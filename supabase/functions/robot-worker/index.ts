import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async(req)=>{
 const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const out=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,"Content-Type":"application/json"}});
 try{
  const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",auth=req.headers.get("Authorization")||"";
  if(!url||!key||auth!=="Bearer "+key)return out({ok:false,error:"Acesso interno obrigatório."},401);

  const db=createClient(url,key);
  const {data:users,error}=await db.from("robot_settings")
    .select("user_id,intervalo_minutos,publicar_automaticamente")
    .eq("ativo",true)
    .eq("busca_automatica",true);
  if(error)throw error;

  const resultados=[];
  const base=url+"/functions/v1";
  const h={"Authorization":"Bearer "+key,"apikey":key,"Content-Type":"application/json"};

  for(const u of users||[]){
   const intervalo=Math.max(5,Number(u.intervalo_minutos||30));
   if(u.publicar_automaticamente===false){
    resultados.push({user_id:u.user_id,fila:"publicacao_automatica_desativada",intervalo_minutos:intervalo});
    continue;
   }

   const sh=await fetch(base+"/shopee-offers",{method:"POST",headers:h,body:JSON.stringify({user_id:u.user_id,limit:20})});
   const sd=await sh.json().catch(()=>({ok:false,error:"Resposta inválida"}));

   const p=await fetch(base+"/process-offers",{method:"POST",headers:h,body:JSON.stringify({user_id:u.user_id,limit:20,somente_descontos:false})});
   const pd=await p.json().catch(()=>({ok:false,error:"Resposta inválida"}));

   const g=await fetch(base+"/generate-content",{method:"POST",headers:h,body:JSON.stringify({user_id:u.user_id})});
   const gd=await g.json().catch(()=>({ok:false,error:"Resposta inválida"}));

   // Recupera reservas antigas que ficaram presas em "publicando" sem publicação concluída.
   // Isso evita que uma falha antiga congele a fila inteira.
   const staleBefore=new Date(Date.now()-15*60*1000).toISOString();
   const {data:stale,error:staleError}=await db.from("contents")
     .select("id")
     .eq("user_id",u.user_id)
     .eq("status","publicando")
     .lt("updated_at",staleBefore);
   if(staleError)throw staleError;
   for(const item of stale||[]){
    const {data:done}=await db.from("offer_publications").select("id")
      .eq("user_id",u.user_id).eq("content_id",item.id).eq("status","publicada").limit(1).maybeSingle();
    if(!done){
      await db.from("contents").update({status:"pronto",updated_at:new Date().toISOString()})
        .eq("id",item.id).eq("user_id",u.user_id).eq("status","publicando");
    }
   }

   // Fila automática: no máximo 1 publicação por intervalo configurado.
   const {data:last,error:lastError}=await db.from("offer_publications")
     .select("published_at")
     .eq("user_id",u.user_id)
     .eq("status","publicada")
     .not("published_at","is",null)
     .order("published_at",{ascending:false})
     .limit(1)
     .maybeSingle();
   if(lastError)throw lastError;

   const now=Date.now();
   const lastAt=last?.published_at?new Date(last.published_at).getTime():0;
   const nextAt=lastAt+intervalo*60*1000;

   if(lastAt&&now<nextAt){
    resultados.push({user_id:u.user_id,shopee:sd,ofertas:pd,conteudo:gd,fila:"aguardando_intervalo",proxima_publicacao:new Date(nextAt).toISOString()});
    continue;
   }

   const {data:conteudo,error:ce}=await db.from("contents")
     .select("id,titulo,status,created_at")
     .eq("user_id",u.user_id)
     .eq("status","pronto")
     .order("created_at",{ascending:true})
     .limit(1)
     .maybeSingle();
   if(ce)throw ce;

   if(!conteudo){
    resultados.push({user_id:u.user_id,shopee:sd,ofertas:pd,conteudo:gd,fila:"vazia"});
    continue;
   }

   // Reserva somente o item escolhido para esta rodada.
   const {data:reserved,error:re}=await db.from("contents")
     .update({status:"publicando",updated_at:new Date().toISOString()})
     .eq("id",conteudo.id)
     .eq("user_id",u.user_id)
     .eq("status","pronto")
     .select("id,titulo,status")
     .maybeSingle();
   if(re)throw re;
   if(!reserved){
    resultados.push({user_id:u.user_id,fila:"concorrencia",content_id:conteudo.id});
    continue;
   }

   const q=await fetch(base+"/publish-content",{
    method:"POST",
    headers:h,
    body:JSON.stringify({user_id:u.user_id,content_id:conteudo.id,modo:"automatico"})
   });
   const qd=await q.json().catch(()=>({ok:false,error:"Resposta inválida"}));

   let story:any={skipped:true};
   if(qd?.ok){
    const st=await fetch(base+"/storrito-story",{
     method:"POST",
     headers:h,
     body:JSON.stringify({user_id:u.user_id,content_id:conteudo.id})
    });
    story=await st.json().catch(()=>({ok:false,error:"Resposta inválida"}));
   }else{
    await db.from("contents").update({status:"pronto",updated_at:new Date().toISOString()})
      .eq("id",conteudo.id).eq("user_id",u.user_id);
   }

   resultados.push({
    user_id:u.user_id,
    shopee:sd,
    ofertas:pd,
    conteudo:gd,
    fila:qd?.ok?"publicado":"erro",
    content_id:conteudo.id,
    publicacao:qd,
    story,
    proxima_publicacao:qd?.ok?new Date(now+intervalo*60*1000).toISOString():null
   });
  }

  return out({ok:true,usuarios_processados:resultados.length,resultados});
 }catch(e){
  console.error("ROBOT-WORKER ERRO:",e);
  return out({ok:false,error:e?.message||"Erro interno."},500);
 }
});