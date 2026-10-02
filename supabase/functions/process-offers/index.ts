import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML = "https://api.mercadolibre.com";
const TERMS = ["celular", "notebook", "air fryer", "smart tv"];
const MAX = 30;
const SEARCH_LIMIT = 10;
const REQUEST_TIMEOUT_MS = 8000;

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS"
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" }
    });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ ok: false, error: "Autorização obrigatória." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Configuração do Supabase incompleta." }, 500);

    const db = createClient(supabaseUrl, serviceRoleKey);
    const token = auth.slice(7);
    const body = await req.json().catch(() => ({}));
    let userId = "";
    if (token === serviceRoleKey) {
      userId = String(body?.user_id || "");
    } else {
      const { data: userData, error: userError } = await db.auth.getUser(token);
      if (userError || !userData?.user) return json({ ok: false, error: "Sessão inválida." }, 401);
      userId = userData.user.id;
    }
    if (!userId) return json({ ok: false, error: "user_id obrigatório." }, 400);
    const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), MAX);
    const somenteDescontos = body?.somente_descontos === true;

    const { data: platform, error: pe } = await db.from("platforms").select("id,nome").eq("nome", "Mercado Livre").eq("ativo", true).limit(1).maybeSingle();
    if (pe || !platform) return json({ ok: false, error: "Plataforma Mercado Livre não cadastrada." }, 400);

    const { data: accounts, error: ae } = await db.from("affiliate_accounts").select("id,status,configuracao,updated_at").eq("user_id", userId).eq("platform_id", platform.id).eq("status", "conectada").order("updated_at", { ascending: false }).limit(1);
    if (ae || !accounts?.length) return json({ ok: false, error: "Mercado Livre não está conectado." }, 400);

    const cfg = accounts[0].configuracao && typeof accounts[0].configuracao === "object" ? accounts[0].configuracao : {};
    const accessToken = typeof cfg.access_token === "string" ? cfg.access_token : "";
    if (!accessToken) return json({ ok: false, error: "Token do Mercado Livre não encontrado." }, 400);

    const authHeaders = { Authorization: "Bearer " + accessToken, Accept: "application/json" };

    async function refreshAccessToken() {
      const clientId =
        Deno.env.get("MERCADOLIVRE_CLIENT_ID") ||
        Deno.env.get("MERCADOLIVRE_APP_ID") ||
        "";
      const clientSecret =
        Deno.env.get("MERCADOLIVRE_CLIENT_SECRET") ||
        Deno.env.get("MERCADOLIVRE_APP_SECRET") ||
        "";
      const refreshToken = typeof cfg.refresh_token === "string" ? cfg.refresh_token : "";

      if (!clientId || !clientSecret || !refreshToken) return false;

      const response = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.access_token) return false;

      accessToken = String(data.access_token);
      authHeaders.Authorization = "Bearer " + accessToken;

      const newCfg = {
        ...cfg,
        access_token: accessToken,
        refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : refreshToken,
        token_type: data.token_type || cfg.token_type || "Bearer",
        expires_in: data.expires_in ?? cfg.expires_in ?? null,
        token_obtido_em: new Date().toISOString(),
      };

      await db.from("affiliate_accounts")
        .update({ configuracao: newCfg, updated_at: new Date().toISOString() })
        .eq("id", accounts[0].id)
        .eq("user_id", userId);

      return true;
    }

    async function getJson(url: string, useAuth = true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        let r = await fetch(url, { headers: useAuth ? authHeaders : { Accept: "application/json" }, signal: controller.signal });

        if (useAuth && r.status === 401 && await refreshAccessToken()) {
          r = await fetch(url, { headers: authHeaders, signal: controller.signal });
        }
        const text = await r.text();
        let data: any = null;
        try { data = JSON.parse(text); } catch {}
        return {
          ok: r.ok,
          status: r.status,
          data,
          error: data?.message || data?.error || (text ? text.slice(0, 500) : null),
          code: data?.code || null,
          blocked_by: data?.blocked_by || null,
        };
      } finally { clearTimeout(timer); }
    }

    function makeOffer(item: any, term: string) {
      const current = Number(item?.price);
      if (!item?.id || !Number.isFinite(current) || current <= 0) return null;
      const originalRaw = Number(item?.original_price);
      const original = Number.isFinite(originalRaw) && originalRaw > current ? originalRaw : null;
      const discount = original ? Math.round(((original - current) / original) * 100) : 0;
      if (somenteDescontos && discount <= 0) return null;
      return {
        external_id: String(item.id),
        product_external_id: String(item.catalog_product_id || item.id),
        title: item.title || "Produto Mercado Livre",
        current,
        original,
        discount,
        image: item.thumbnail || item.pictures?.[0]?.url || null,
        permalink: item.permalink || null,
        promotion_id: null,
        promotion_type: null,
        free_shipping: !!item.shipping?.free_shipping,
        score: discount * 10 + (item.shipping?.free_shipping ? 5 : 0),
        term
      };
    }

    const candidates: any[] = [];
    const diagnostics: any[] = [];

    for (const term of TERMS) {
      const catalog = await getJson(ML + "/products/search?status=active&site_id=MLB&limit=" + SEARCH_LIMIT + "&q=" + encodeURIComponent(term), true);

      const diagnostic: any = {
        term,
        catalog_status: catalog.status,
        catalog_results: Array.isArray(catalog.data?.results) ? catalog.data.results.length : 0,
        catalog_error: catalog.ok ? null : catalog.error,
        catalog_code: catalog.code,
        catalog_blocked_by: catalog.blocked_by,
        candidates: 0,
        rejected_without_price: 0,
        rejected_discount_filter: 0,
        search_mode: "catalog-first"
      };

      let termCandidates = 0;

      if (catalog.ok && Array.isArray(catalog.data?.results)) {
        for (const product of catalog.data.results.slice(0, SEARCH_LIMIT)) {
          let detail = product;

          // A busca de catálogo pode retornar o produto sem o buy_box_winner.
          // A documentação do Mercado Livre orienta consultar /products/{product_id}
          // para identificar a publicação vencedora.
          if (!detail?.buy_box_winner && product?.id) {
            const productDetail = await getJson(ML + "/products/" + encodeURIComponent(String(product.id)), true);
            if (productDetail.ok && productDetail.data) {
              detail = productDetail.data;
              diagnostic.catalog_detail_status = productDetail.status;
              diagnostic.catalog_details_consulted = (diagnostic.catalog_details_consulted || 0) + 1;
            }
          }

          let winner = detail?.buy_box_winner;

          // Alguns resultados da busca são produtos-pai sem vencedor direto.
          // Nesses casos, os produtos-filhos podem ter a publicação vencedora.
          if (!winner?.item_id && Array.isArray(detail?.children_ids)) {
            for (const childId of detail.children_ids.slice(0, 5)) {
              const child = await getJson(ML + "/products/" + encodeURIComponent(String(childId)), true);
              diagnostic.catalog_children_consulted = (diagnostic.catalog_children_consulted || 0) + 1;
              diagnostic.catalog_child_last_status = child.status;
              if (child.ok && child.data?.buy_box_winner?.item_id) {
                detail = child.data;
                winner = detail.buy_box_winner;
                break;
              }
            }
          }

          if (winner?.item_id && Number.isFinite(Number(winner.price))) {
            const offer = makeOffer({
              id: winner.item_id,
              catalog_product_id: detail.id || product.id,
              title: detail.name || product.name,
              price: winner.price,
              original_price: winner.original_price,
              thumbnail: detail.pictures?.[0]?.url || detail.pictures?.[0]?.secure_url || product.pictures?.[0]?.url || product.pictures?.[0]?.secure_url,
              permalink: detail.permalink || product.permalink,
              shipping: winner.shipping
            }, term);
            if (offer) {
              candidates.push(offer);
              termCandidates++;
              diagnostic.candidates++;
            }
          }
        }
      }

      if (!catalog.ok || !Array.isArray(catalog.data?.results) || !catalog.data.results.length || termCandidates === 0) {
        const publicSearch = await getJson(ML + "/sites/MLB/search?limit=" + SEARCH_LIMIT + "&q=" + encodeURIComponent(term) + "&sort=relevance", false);
        diagnostic.public_status = publicSearch.status;
        diagnostic.public_results = Array.isArray(publicSearch.data?.results) ? publicSearch.data.results.length : 0;
        diagnostic.public_error = publicSearch.ok ? null : publicSearch.error;
        diagnostic.public_code = publicSearch.code;
        diagnostic.public_blocked_by = publicSearch.blocked_by;

        if (publicSearch.ok && Array.isArray(publicSearch.data?.results)) {
          for (const item of publicSearch.data.results) {
            const offer = makeOffer(item, term);
            if (offer) {
              candidates.push(offer);
              termCandidates++;
            }
          }
        }
      }
      diagnostics.push(diagnostic);
    }

    const unique: any[] = [];
    const seen = new Set<string>();
    for (const item of candidates.sort((a,b) => b.score - a.score || b.discount - a.discount || a.current - b.current)) {
      if (seen.has(item.external_id)) continue;
      seen.add(item.external_id);
      unique.push(item);
      if (unique.length >= limit) break;
    }

    let novas = 0;
    let atualizadas = 0;
    const ofertas: any[] = [];

    for (const o of unique) {
      const now = new Date().toISOString();
      const values: any = {
        user_id: userId,
        platform_id: platform.id,
        product_id: null,
        product_external_id: o.external_id,
        titulo: o.title,
        url_produto: o.permalink,
        store_provider: "mercadolivre",
        store_product_url: o.permalink,
        preco_atual: o.current,
        preco_anterior: o.original,
        desconto_percentual: o.discount,
        moeda: "BRL",
        disponibilidade: true,
        classificacao: o.discount >= 10 ? "interessante" : "verificar",
        permitido_afiliado: true,
        permitido_divulgacao: true,
        imagem_url: o.image,
        dados_origem: { fonte: "mercadolivre-search", termo: o.term, catalog_product_id: o.product_external_id, item_id: o.external_id },
        promocao_id_externo: o.promotion_id,
        oferta_tipo: "oferta",
        melhor_preco: o.score > 0,
        score_oferta: o.score,
        atualizada_em: now,
        coletada_em: now
      };

      const { data: existing, error: findError } = await db.from("offers").select("id").eq("user_id", userId).eq("platform_id", platform.id).eq("product_external_id", o.external_id).limit(1).maybeSingle();
      if (findError) throw findError;

      let offerId = existing?.id || null;
      if (offerId) {
        const { error } = await db.from("offers").update(values).eq("id", offerId).eq("user_id", userId);
        if (error) throw error;
        atualizadas++;
      } else {
        const { data: inserted, error } = await db.from("offers").insert({ ...values, encontrada_em: now }).select("id").single();
        if (error) throw error;
        offerId = inserted.id;
        novas++;
      }

      ofertas.push({ id: offerId, external_id: o.external_id, product_external_id: o.product_external_id, title: o.title, current: o.current, original: o.original, discount: o.discount, image: o.image, permalink: o.permalink, promotion_id: o.promotion_id, promotion_type: o.promotion_type, score: o.score });
      if (ofertas.length >= limit) break;
    }

    return json({ ok: true, produtos_encontrados: ofertas.length, novas, atualizadas, limite: limit, ofertas, diagnostico: diagnostics });
  } catch (e) {
    console.error("PROCESS-OFFERS ERRO:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Erro interno." }, 500);
  }
});