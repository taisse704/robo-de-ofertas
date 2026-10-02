import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const U=Deno.env.get("SUPABASE_URL")??"",S=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",A=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??"";
const db=createClient(U,S);
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-robot-secret","Access-Control-Allow-Methods":"POST,OPTIONS"};
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...C,"Content-Type":"application/json"}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:C});
 let expected="";
 try{
  if(!expected){
   const {data,error}=await db.rpc("get_robot_cron_secret");
   if(error)throw error;
   expected=String(data||"");
  }
  if(!expected||req.headers.get("x-robot-secret")!==expected)return j({ok:false,error:"Não autorizado."},401);
  const {data:users,error}=await db.from("robot_settings").select("user_id").eq("ativo",true).eq("busca_automatica",true).not("user_id","is",null);
  if(error)throw error;
  const out:any[]=[];
  for(const row of users||[]){
   const r=await fetch(`${U}/functions/v1/robot-worker`,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+S,"apikey":S},body:JSON.stringify({user_id:row.user_id})});
   out.push({user_id:row.user_id,ok:r.ok,result:await r.json().catch(()=>({}))});
  }
  return j({ok:true,usuarios_processados:out.length,resultados:out});
 }catch(e){console.error("ROBOT-CRON ERRO:",e);return j({ok:false,error:e instanceof Error?e.message:"Erro interno."},500);}
});