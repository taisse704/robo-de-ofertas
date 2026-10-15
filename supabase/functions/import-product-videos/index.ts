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

function isTrustedVideoUrl(raw: unknown, provider: string): raw is string {
  if (typeof raw !== "string" || raw.length > 4096) return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password) return false;
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|json|js|html|htm|css|txt|xml)(?:$|[?#])/i.test(u.pathname)) return false;
    const trustedDomains = provider === "mercadolivre"
      ? ["mercadolivre.com.br", "mercadolibre.com", "mlstatic.com"]
      : provider === "shopee"
        ? ["shopee.com.br", "shopee.com", "susercontent.com", "shopeemobile.com"]
        : [];
    if (!trustedDomains.some(domain => host === domain || host.endsWith("." + domain))) return false;
    if (/\.(mp4|m4v|mov|webm|m3u8|mpd)(?:$|[?#])/i.test(u.href) || /video|videos|vod|playback|media-stream|stream-media/i.test(host + u.pathname)) return true;
    // URLs assinadas de CDN podem não ter extensão; a URL de produto nunca é tratada como vídeo.
    return ["mlstatic.com", "susercontent.com", "shopeemobile.com"]
      .some(domain => host === domain || host.endsWith("." + domain));
  } catch { return false; }
}

function directVideoUrl(...sources: any[]): string | null {
  const candidates: any[] = [];
  const visit = (v: any, depth = 0) => {
    if (v == null || depth > 5) return;
    if (typeof v === "string") {
      const s = v.trim().replaceAll("\\/", "/").replaceAll("\\u0026", "&").replaceAll("&amp;", "&");
      if (/^https?:\/\//i.test(s)) candidates.push(s);
      else if (s.startsWith("{") || s.startsWith("[")) {
        try { visit(JSON.parse(s), depth + 1); } catch { /* texto da página não é JSON puro */ }
      }
    } else if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
    } else if (typeof v === "object") {
      for (const [key, value] of Object.entries(v)) {
        if (/video|media|source|url|src|location|format|stream|play/i.test(key)) visit(value, depth + 1);
      }
    }
  };
  for (const source of sources) visit(source);
  for (const raw of candidates) {
    const value = raw.replace(/[\\\"'<>\\)\\],]+$/g, "");
    if (/\.(mp4|m4v|mov|webm|m3u8)(?:[?#].*)?$/i.test(value)) return value.replace(/^http:\/\//i, "https://");
  }
  return null;
}


function explicitVideoUrl(value: any, depth = 0): string | null {
  if (value == null || depth > 6) return null;
  if (typeof value === "string") {
    const s = value.trim().replaceAll("\\/", "/").replaceAll("\\u0026", "&").replaceAll("&amp;", "&");
    if (!/^https?:\/\//i.test(s)) return null;
    try {
      const u = new URL(s);
      if (/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|json|js|html|htm|css|txt|xml)(?:[?#].*)?$/i.test(u.pathname)) return null;
      return u.href.replace(/^http:\/\//i, "https://");
    } catch { return null; }
  }
  if (Array.isArray(value)) {
    for (const item of value) { const found = explicitVideoUrl(item, depth + 1); if (found) return found; }
    return null;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (/video|playurl|play_url|stream|source|src|secure_url|file_url|location|format|url_list|main_url|backup_url|default_format|video_info_list|videoInfoList|video_list|videoList|play_url_list/i.test(key)) {
        const found = explicitVideoUrl(child, depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

async function fetchJson(url: string, headers: Record<string,string> = {}) {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(7000) });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (error) { throw new Error(`Falha de rede ao consultar fonte do vídeo: ${error instanceof Error ? error.message : String(error)}`); }
}

async function importMercadoLivreVideo(externalId: string, accessToken?: string, listingId?: string) {
  if (!/^MLB\d+$/i.test(externalId) && !/^MLB\d+$/i.test(String(listingId || ""))) return null;
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  // A busca de ofertas guarda o ID do anúncio real em dados_origem.item_id.
  // Prioriza esse ID: externalId pode ser um ID de catálogo /p/MLB... e não uma publicação.
  const preferredId = /^MLB\d+$/i.test(String(listingId || "")) ? String(listingId) : externalId;
  let item = await fetchJson(`https://api.mercadolibre.com/items/${encodeURIComponent(preferredId)}`, headers);
  if (!item.ok && accessToken) item = await fetchJson(`https://api.mercadolibre.com/items/${encodeURIComponent(externalId)}`);
  let itemData = item.ok ? item.data : null;
  if (!itemData) {
    let product = await fetchJson(`https://api.mercadolibre.com/products/${encodeURIComponent(externalId)}`, headers);
    if (!product.ok && accessToken) product = await fetchJson(`https://api.mercadolibre.com/products/${encodeURIComponent(externalId)}`);
    if (product.ok && product.data) {
      const winner = product.data.buy_box_winner || {};
      const itemId = String(winner.item_id || product.data.item_id || product.data.items?.[0]?.item_id || "").trim();
      if (itemId) {
        item = await fetchJson(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`, headers);
        if (!item.ok && accessToken) item = await fetchJson(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`);
        if (item.ok) itemData = item.data;
      }
      if (!itemData) itemData = product.data;
    }
  }
  if (!itemData) throw new Error(`Mercado Livre não resolveu o ID de catálogo/publicação (HTTP ${item.status}).`);
  const videoFields = {
    video_url: itemData.video_url,
    videoUrl: itemData.videoUrl,
    video: itemData.video,
    videos: itemData.videos,
    media: itemData.media,
    buy_box_winner: itemData.buy_box_winner
  };
  const fromItem = directVideoUrl(videoFields);
  if (fromItem && isTrustedVideoUrl(fromItem, "mercadolivre")) return fromItem;
  // Aceita URL sem extensão apenas quando veio de campos explicitamente relacionados a vídeo.
  const explicitItemUrl = explicitVideoUrl(videoFields);
  if (explicitItemUrl && isTrustedVideoUrl(explicitItemUrl, "mercadolivre")) return explicitItemUrl;
  const videoId = String(itemData.video_id || itemData.buy_box_winner?.video_id || "").trim();
  if (!videoId || videoId === "null" || videoId === "undefined") return null;
  const video = await fetchJson(`https://api.mercadolibre.com/videos/${encodeURIComponent(videoId)}`, headers);
  if (!video.ok) throw new Error(`Mercado Livre respondeu HTTP ${video.status} ao consultar o arquivo de vídeo.`);
  const fromVideoApi = directVideoUrl(video.data) || explicitVideoUrl(video.data);
  return fromVideoApi && isTrustedVideoUrl(fromVideoApi, "mercadolivre") ? fromVideoApi : null;
}

async function importShopeeVideo(productUrl: string) {
  if (!/^https?:\/\//i.test(productUrl)) return null;
  let parsedUrl: URL;
  try { parsedUrl = new URL(productUrl); } catch { return null; }
  if (!/shopee\./i.test(parsedUrl.hostname)) return null;
  try {
    const res = await fetch(productUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": "https://shopee.com.br/"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`Shopee respondeu HTTP ${res.status} ao consultar a página do anúncio.`);
    const original = (await res.text()).slice(0, 8_000_000);
    const html = original
      .replace(/\\\\u002[fF]/g, "/")
      .replace(/\\\\u0026/g, "&")
      .replace(/\\\\x2[fF]/g, "/")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");
    const candidates: string[] = [];
    const explicitVideoCandidates: string[] = [];
    const add = (value: unknown) => {
      if (typeof value !== "string") return;
      const normalized = value.replace(/\\\//g, "/").replace(/\\\\u0026/g, "&").replace(/&amp;/g, "&");
      candidates.push(...(normalized.match(/https?:\/\/[^\s"'<>\\]+/gi) || []));
      if (/^https?:\/\//i.test(normalized)) candidates.push(normalized);
    };
    const urlPattern = /https?:\\?\/\\?\/[^\s"'<>]{8,}/gi;
    for (const match of html.match(urlPattern) || []) add(match);
    // Shopee pode embutir os vídeos em video_info_list/videoInfoList e em JSON aninhado.
    // Lemos valores JSON balanceando chaves, em vez de usar uma regex que falha em objetos aninhados.
    const keyPattern = /"[^"\\]*(?:video|playurl|play_url|media|vod|stream)[^"\\]*"\s*:\s*/gi;
    const readJsonValue = (source: string, start: number): string | null => {
      let i = start;
      while (/\s/.test(source[i] || "")) i++;
      const first = source[i];
      if (first === '"') {
        let escaped = false;
        for (let j = i + 1; j < source.length; j++) {
          if (escaped) { escaped = false; continue; }
          if (source[j] === "\\") { escaped = true; continue; }
          if (source[j] === '"') return source.slice(i, j + 1);
        }
        return null;
      }
      if (first === "{" || first === "[") {
        const stack: string[] = [];
        let quote = "";
        let escaped = false;
        for (let j = i; j < source.length; j++) {
          const ch = source[j];
          if (quote) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === quote) quote = "";
            continue;
          }
          if (ch === '"') { quote = ch; continue; }
          if (ch === "{" || ch === "[") stack.push(ch);
          else if (ch === "}" || ch === "]") {
            stack.pop();
            if (!stack.length) return source.slice(i, j + 1);
          }
        }
        return null;
      }
      const tail = source.slice(i);
      const end = tail.search(/[,}\]]\s*(?=["'\w])/);
      return tail.slice(0, end < 0 ? Math.min(tail.length, 5000) : end).trim();
    };
    for (const match of html.matchAll(keyPattern)) {
      const rawValue = readJsonValue(html, (match.index || 0) + match[0].length);
      if (!rawValue) continue;
      let parsed: unknown = rawValue;
      try { parsed = JSON.parse(rawValue); } catch { parsed = rawValue.replace(/^"|"$/g, "").replace(/\\"/g, '"'); }
      add(parsed);
      const explicit = explicitVideoUrl(parsed);
      if (explicit) explicitVideoCandidates.push(explicit);
    }
    const found = directVideoUrl(candidates) || explicitVideoCandidates[0] || null;
    return found && isTrustedVideoUrl(found, "shopee") ? found : null;  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Falha ao consultar página da Shopee.");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Configuração do Supabase incompleta." }, 500);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "Autenticação obrigatória." }, 401);
  const token = auth.slice(7);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return json({ ok: false, error: "Sessão inválida." }, 401);
  const userId = userData.user.id;
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body?.limit) || 12, 1), 12);
  const { data: offers, error } = await admin.from("offers")
    .select("id,titulo,store_provider,product_external_id,url_produto,store_product_url,video_url,video_source,video_status,dados_origem,created_at,atualizada_em")
    .eq("user_id", userId).is("video_url", null).in("video_status", ["nao_verificado", "falha_consulta_video", "video_original_nao_disponivel"])
    .in("store_provider", ["mercadolivre", "shopee"])
    .order("created_at", { ascending: true }).limit(500);
  if (error) return json({ ok: false, error: "Não foi possível consultar ofertas para importar vídeos." }, 500);
  console.log("import-product-videos: ofertas elegíveis", { userId, total: offers?.length || 0, limit });

  const { data: accounts } = await admin.from("affiliate_accounts")
    .select("configuracao, platforms(nome)").eq("user_id", userId).eq("status", "conectada").limit(10);
  let mlToken = "";
  for (const account of accounts || []) {
    const platformName = String((account as any)?.platforms?.nome || "").toLowerCase();
    const cfg = account?.configuracao || {};
    if (platformName.includes("mercado livre") && typeof cfg.access_token === "string" && cfg.access_token) { mlToken = cfg.access_token; break; }
  }

  let checked = 0, imported = 0, unavailable = 0, failed = 0;
  const details: any[] = [];
  const importedOfferIds: string[] = [];
  // Cada clique deve movimentar o fluxo: reavaliar até 12 ofertas sem URL de vídeo,
  // mesmo que tenham sido consultadas recentemente. Isso evita lotes vazios por carimbo de data.
  const priority = (status: string) => status === "nao_verificado" ? 0 : status === "falha_consulta_video" ? 1 : 2;
  const batch = (offers || [])
    .sort((a: any, b: any) => {
      const byPriority = priority(String(a.video_status || "nao_verificado")) - priority(String(b.video_status || "nao_verificado"));
      if (byPriority) return byPriority;
      const aChecked = Date.parse(String(a.dados_origem?.video_ultima_verificacao_em || "")) || 0;
      const bChecked = Date.parse(String(b.dados_origem?.video_ultima_verificacao_em || "")) || 0;
      if (aChecked !== bChecked) return aChecked - bChecked;
      return Date.parse(String(a.created_at || 0)) - Date.parse(String(b.created_at || 0));
    })
    .slice(0, limit);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= batch.length) return;
      const offer = batch[index];
      checked++;
      const provider = String(offer.store_provider || "");
      const externalId = String(offer.product_external_id || "");
      const productUrl = String(offer.store_product_url || offer.url_produto || "");
      const originData = offer.dados_origem && typeof offer.dados_origem === "object" ? offer.dados_origem : {};
      const listingId = String((originData as any).item_id || (originData as any).listing_id || "");
      let videoUrl: string | null = null;
      try {
        if (provider === "mercadolivre") videoUrl = await importMercadoLivreVideo(externalId, mlToken || undefined, listingId);
        if (provider === "shopee") videoUrl = await importShopeeVideo(productUrl);
        if (videoUrl && !isTrustedVideoUrl(videoUrl, provider)) {
          console.warn("URL rejeitada por não ser uma mídia de vídeo confiável", { offerId: offer.id, provider });
          videoUrl = null;
        }
        if (videoUrl) {
          const { error: updateError } = await admin.from("offers").update({
            video_url: videoUrl,
            video_source: provider === "shopee" ? "shopee_public_listing" : "mercadolivre_public_listing",
            video_status: "original_disponivel",
            dados_origem: { ...(offer.dados_origem && typeof offer.dados_origem === "object" ? offer.dados_origem : {}), video_importado_em: new Date().toISOString(), video_importacao_fonte: provider }
          }).eq("id", offer.id).eq("user_id", userId).is("video_url", null);
          if (updateError) { failed++; details.push({ id: offer.id, title: offer.titulo, provider, status: "erro_ao_salvar", motivo: updateError.message }); }
          else { imported++; importedOfferIds.push(String(offer.id)); details.push({ id: offer.id, title: offer.titulo, provider, status: "video_original_importado" }); }
        } else {
          const { error: markError } = await admin.from("offers").update({ video_status: "video_original_nao_disponivel", dados_origem: { ...(offer.dados_origem && typeof offer.dados_origem === "object" ? offer.dados_origem : {}), video_ultima_verificacao_em: new Date().toISOString(), video_ultima_verificacao_status: "sem_url_direta" } }).eq("id", offer.id).eq("user_id", userId).is("video_url", null);
          if (markError) { failed++; details.push({ id: offer.id, title: offer.titulo, provider, status: "erro_ao_marcar_consulta", motivo: markError.message }); }
          else { unavailable++; details.push({ id: offer.id, title: offer.titulo, provider, status: "video_original_nao_disponivel_na_fonte", motivo: "A página/API consultada não expôs uma URL direta identificável nesta tentativa." }); }
        }
      } catch (error) {
        failed++;
        await admin.from("offers").update({ video_status: "falha_consulta_video", dados_origem: { ...(offer.dados_origem && typeof offer.dados_origem === "object" ? offer.dados_origem : {}), video_ultima_verificacao_em: new Date().toISOString(), video_ultima_verificacao_status: "falha_consulta" } }).eq("id", offer.id).eq("user_id", userId).is("video_url", null);
        details.push({ id: offer.id, title: offer.titulo, provider, status: "falha_consulta", motivo: (error instanceof Error ? error.message : String(error)).slice(0, 240) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, batch.length) }, () => worker()));
  return json({
    ok: true, checked, imported, unavailable, failed, imported_offer_ids: importedOfferIds,
    message: imported
      ? `${imported} vídeo(s) original(is) importado(s); ${unavailable} anúncio(s) sem arquivo de vídeo acessível.`
      : checked && failed > 0
        ? `Verificados ${checked} anúncio(s); ${unavailable} sem link direto de vídeo encontrado na resposta acessível da página e ${failed} consulta(s)/gravação(ões) com falha. Isso não confirma que o anúncio não tenha vídeo; novas tentativas continuarão disponíveis.`
        : checked
          ? `Verificados ${checked} anúncio(s); nenhum link direto de vídeo foi encontrado no conteúdo acessível das páginas nesta rodada. Isso não confirma que os anúncios não tenham vídeo.`
          : "Não há anúncios novos para verificar. As ofertas já verificadas foram puladas.",
    details
  });
});
