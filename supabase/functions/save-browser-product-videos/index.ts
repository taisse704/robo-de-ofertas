import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const BASE_METHODS = new Set(["video_element", "video_source", "structured_video_field", "inline_video_data", "video_resource"]);
const IMAGE_OR_DOCUMENT_EXT = /\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|json|js|css|html|htm|txt|xml)(?:$|[?#])/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|m3u8|mpd)(?:$|[?#])/i;
const VIDEO_HINT = /video|videos|vod|playback|media-stream|stream-media|play_url|playable/i;
const isHostOrSubdomain = (host: string, domain: string) => host === domain || host.endsWith("." + domain);
function hostAllowed(host: string, provider: string) {
  const domains = provider === "mercadolivre"
    ? ["mercadolivre.com.br", "mercadolibre.com", "mlstatic.com"]
    : provider === "shopee" ? ["shopee.com.br", "shopee.com", "susercontent.com", "shopeemobile.com"] : [];
  return domains.some(domain => isHostOrSubdomain(host, domain));
}
function methodAllowed(method: string) {
  return BASE_METHODS.has(method) || (method.startsWith("page_json_response:") && VIDEO_HINT.test(method.slice("page_json_response:".length)));
}
function videoUrlAllowed(raw: unknown, provider: string, method: string): raw is string {
  if (typeof raw !== "string" || raw.length > 4096) return false;
  try {
    const u = new URL(raw), host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password || !hostAllowed(host, provider) || IMAGE_OR_DOCUMENT_EXT.test(u.pathname)) return false;
    if (VIDEO_EXT.test(u.href) || VIDEO_HINT.test(host + u.pathname)) return true;
    const cdn = ["mlstatic.com", "susercontent.com", "shopeemobile.com"].some(d => isHostOrSubdomain(host, d));
    const explicitField = ["video_element", "video_source", "structured_video_field"].includes(method) ||
      (method.startsWith("page_json_response:") && VIDEO_HINT.test(method.slice("page_json_response:".length)));
    return cdn && explicitField;
  } catch { return false; }
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "", serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Configuração do Supabase incompleta." }, 500);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "Autenticação obrigatória." }, 401);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await admin.auth.getUser(auth.slice(7));
  if (userError || !userData?.user) return json({ ok: false, error: "Sessão inválida." }, 401);
  const body = await req.json().catch(() => ({})), rawVideos = Array.isArray(body?.videos) ? body.videos.slice(0, 12) : [];
  if (!rawVideos.length) return json({ ok: true, imported: 0, imported_offer_ids: [], details: [], message: "O navegador não encontrou URLs de vídeo candidatas." });
  const ids = [...new Set(rawVideos.map((v: any) => String(v?.offer_id || "").trim()).filter(Boolean))];
  const { data: offers, error } = await admin.from("offers").select("id,user_id,titulo,store_provider,video_url,video_status,video_source,dados_origem").eq("user_id", userData.user.id).in("id", ids);
  if (error) return json({ ok: false, error: "Não foi possível validar as ofertas recebidas do navegador." }, 500);
  const byId = new Map((offers || []).map((o: any) => [String(o.id), o]));
  let imported = 0; const importedOfferIds: string[] = [], details: any[] = [];
  for (const candidate of rawVideos) {
    const offerId = String(candidate?.offer_id || "").trim(), offer: any = byId.get(offerId);
    const videoUrl = candidate?.video_url, method = String(candidate?.method || "");
    if (!offer || offer.user_id !== userData.user.id) { details.push({ id: offerId, status: "oferta_nao_autorizada" }); continue; }
    const provider = String(offer.store_provider || "").toLowerCase();
    if (!["shopee", "mercadolivre"].includes(provider)) { details.push({ id: offerId, title: offer.titulo, provider, status: "fonte_nao_permitida" }); continue; }
    if (!methodAllowed(method) || !videoUrlAllowed(videoUrl, provider, method)) {
      details.push({ id: offerId, title: offer.titulo, provider, status: "url_rejeitada", motivo: "URL fora dos domínios de mídia permitidos ou sem indicação suficiente de vídeo." }); continue;
    }
    const { data: updated, error: updateError } = await admin.from("offers").update({
      video_url: videoUrl, video_source: "original", video_status: "original_disponivel",
      dados_origem: { ...(offer.dados_origem && typeof offer.dados_origem === "object" ? offer.dados_origem : {}), video_importado_em: new Date().toISOString(), video_importacao_fonte: "captura_navegador", video_capture_method: method }
    }).eq("id", offerId).eq("user_id", userData.user.id).is("video_url", null).select("id").maybeSingle();
    if (updateError) details.push({ id: offerId, title: offer.titulo, provider, status: "erro_ao_salvar", motivo: updateError.message });
    else if (updated?.id) { imported++; importedOfferIds.push(offerId); details.push({ id: offerId, title: offer.titulo, provider, status: "video_original_importado" }); }
    else details.push({ id: offerId, title: offer.titulo, provider, status: "ja_possui_video" });
  }
  return json({ ok: true, checked: rawVideos.length, imported, imported_offer_ids: importedOfferIds, details, message: imported ? imported + " vídeo(s) original(is) identificado(s) no navegador e salvo(s) no Robô." : "O navegador não confirmou nenhum vídeo original nesta rodada; nenhum anúncio foi enviado à fila." });
});
