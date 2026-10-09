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

   // Antes de chamar Shopee/Mercado Livre/geração, respeita o intervalo de publicação.
   // Isso evita repetir dezenas de chamadas externas quando o robô ainda está aguardando
   // o próximo horário de publicação.
   const {data:lastEarly,error:lastEarlyError}=await db.from("offer_publications")
     .select("published_at")
     .eq("user_id",u.user_id)
     .eq("status","publicada")
     .not("published_at","is",null)
     .order("published_at",{ascending:false})
     .limit(1)
     .maybeSingle();
   if(lastEarlyError)throw lastEarlyError;

   const earlyLastAt=lastEarly?.published_at?new Date(lastEarly.published_at).getTime():0;
   const earlyNextAt=earlyLastAt+intervalo*60*1000;
    if(earlyLastAt && Date.now()<earlyNextAt){
     resultados.push({user_id:u.user_id,fila:"aguardando_intervalo",proxima_publicacao:new Date(earlyNextAt).toISOString()});
     continue;
    }

    // Limita rodadas sem publicação concluída; sem isso, o cron cria novos
    // conteúdos a cada chamada quando os vídeos ficam pendentes.
    const {data:lastCycle,error:lastCycleError}=await db.from("robot_jobs")
      .select("id,status,created_at")
      .eq("user_id",u.user_id)
      .eq("tipo","worker_cycle")
      .order("created_at",{ascending:false})
      .limit(1)
      .maybeSingle();
    if(lastCycleError)throw lastCycleError;
    const lastCycleAt=lastCycle?.created_at?new Date(lastCycle.created_at).getTime():0;
    const cycleAge=lastCycleAt?Date.now()-lastCycleAt:Number.POSITIVE_INFINITY;
    const cycleStillRunning=lastCycle?.status==="executando" && cycleAge<15*60*1000;
    const cycleWithinInterval=Boolean(lastCycle) && lastCycle.status!=="executando" && cycleAge<intervalo*60*1000;
    if(cycleStillRunning || cycleWithinInterval){
     const cooldown=lastCycle?.status==="executando"?15*60*1000:intervalo*60*1000;
     resultados.push({user_id:u.user_id,fila:"aguardando_intervalo_automacao",proxima_execucao:new Date(lastCycleAt+cooldown).toISOString()});
     continue;
    }

    const cycleStartedAt=new Date().toISOString();
    const {data:cycle,error:cycleInsertError}=await db.from("robot_jobs").insert({
     user_id:u.user_id,
     tipo:"worker_cycle",
     store_provider:"all",
     status:"executando",
     prioridade:0,
     payload:{intervalo_minutos:intervalo},
     executar_em:cycleStartedAt,
     iniciado_em:cycleStartedAt
    }).select("id").single();
    if(cycleInsertError)throw cycleInsertError;

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
   const now=Date.now();
   // Prioridade da fila: maior comissão estimada em R$ primeiro.
   // Em empate, maior desconto; depois, o conteúdo mais antigo.
   const {data:conteudosProntos,error:ce}=await db.from("contents")
     .select("id,titulo,status,created_at,offer_id,tipo,video_url,video_source,video_status,offers(comissao_estimada,comissao_percentual,desconto_percentual,preco_atual)")
     .eq("user_id",u.user_id)
     .eq("status","pronto")
     .limit(50);
   if(ce)throw ce;

   const conteudosComVideoPronto=(conteudosProntos||[]).filter((c:any)=>c?.tipo!=="video_oferta" || (c?.video_url && ["pronto","original_disponivel"].includes(String(c?.video_status||""))));

   const conteudo=conteudosComVideoPronto.sort((a,b)=>{
    const oa=Array.isArray(a.offers)?a.offers[0]:a.offers;
    const ob=Array.isArray(b.offers)?b.offers[0]:b.offers;
    const ca=oa?.comissao_estimada != null ? Number(oa.comissao_estimada) : Number(oa?.preco_atual||0)*Number(oa?.comissao_percentual||0);
    const cb=ob?.comissao_estimada != null ? Number(ob.comissao_estimada) : Number(ob?.preco_atual||0)*Number(ob?.comissao_percentual||0);
    if(cb!==ca)return cb-ca;
    const da=Number(oa?.desconto_percentual||0),dbv=Number(ob?.desconto_percentual||0);
    if(dbv!==da)return dbv-da;
    return new Date(a.created_at||0).getTime()-new Date(b.created_at||0).getTime();
   })[0];

   if(!conteudo){
    await db.from("robot_jobs").update({
     status:"concluido",
     finalizado_em:new Date().toISOString(),
     resultado:{fila:"vazia",shopee:sd,ofertas:pd,conteudo:gd}
    }).eq("id",cycle.id).eq("user_id",u.user_id);
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
    await db.from("robot_jobs").update({
     status:"concluido",
     finalizado_em:new Date().toISOString(),
     resultado:{fila:"concorrencia",content_id:conteudo.id}
    }).eq("id",cycle.id).eq("user_id",u.user_id);
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
   if(qd?.ok && Number(qd?.publicadas||0)>0){
    const storritoConfigured=Boolean(
     Deno.env.get("STORRITO_API_BASE_URL") && Deno.env.get("STORRITO_API_TOKEN")
    );
    if(storritoConfigured){
     const st=await fetch(base+"/storrito-story",{
      method:"POST",
      headers:h,
      body:JSON.stringify({user_id:u.user_id,content_id:conteudo.id})
     });
     story=await st.json().catch(()=>({ok:false,error:"Resposta inválida"}));
    }else{
     // Evita gravar uma falha a cada publicação quando Stories ainda não está configurado.
     story={skipped:true,reason:"Storrito não configurado; Stories ignorados nesta rodada."};
    }
   }else{
    await db.from("contents").update({status:"pronto",updated_at:new Date().toISOString()})
      .eq("id",conteudo.id).eq("user_id",u.user_id);
   }

   await db.from("robot_jobs").update({
    status:qd?.ok?"concluido":"erro",
    finalizado_em:new Date().toISOString(),
    erro:qd?.ok?null:String(qd?.error||"Nenhuma rede conseguiu publicar."),
    resultado:{fila:qd?.ok?"publicado":"erro",content_id:conteudo.id,publicacao:qd,story}
   }).eq("id",cycle.id).eq("user_id",u.user_id);

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