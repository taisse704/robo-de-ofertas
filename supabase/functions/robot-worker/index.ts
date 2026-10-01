import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
Deno.serve(async(req)=>{
 const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const out=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,"Content-Type":"application/json"}});
 try{
  const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",auth=req.headers.get("Authorization")||"";
  if(!url||!key||auth!=="Bearer "+key)return out({ok:false,error:"Acesso interno obrigatório."},401);
  const db=createClient(url,key),{data:users,error}=await db.from("robot_settings").select("user_id").eq("ativo",true).eq("busca_automatica",true);if(error)throw error;
  const resultados=[];
  for(const u of users||[]){const h={"Authorization":"Bearer "+key,"apikey":key,"Content-Type":"application/json"},base=url+"/functions/v1";
   const sh=await fetch(base+"/shopee-offers",{method:"POST",headers:h,body:JSON.stringify({user_id:u.user_id,limit:20})}),sd=await sh.json().catch(()=>({ok:false,error:"Resposta inválida"}));
const p=await fetch(base+"/process-offers",{method:"POST",headers:h,body:JSON.stringify({user_id:u.user_id,limit:20,somente_descontos:false})}),pd=await p.json().catch(()=>({ok:false,error:"Resposta inválida"}));
   const g=await fetch(base+"/generate-content",{method:"POST",headers:h,body:JSON.stringify({user_id:u.user_id})}),gd=await g.json().catch(()=>({ok:false,error:"Resposta inválida"}));
   const q=await fetch(base+"/publish-content",{method:"POST",headers:h,body:JSON.stringify({user_id:u.user_id})}),qd=await q.json().catch(()=>({ok:false,error:"Resposta inválida"}));
   resultados.push({user_id:u.user_id,shopee:sd,ofertas:pd,conteudo:gd,publicacao:qd});
  }
  return out({ok:true,usuarios_processados:resultados.length,resultados});
 }catch(e){console.error("ROBOT-WORKER ERRO:",e);return out({ok:false,error:e?.message||"Erro interno."},500);}
});