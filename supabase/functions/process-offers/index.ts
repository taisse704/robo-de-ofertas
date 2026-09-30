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

    const { data: platform, error: pe } = await db
      .from("platforms")
      .select("id,nome")
      .eq("nome", "Mercado Livre")
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();

    if (pe || !platform) return json({ ok: false, error: "Plataforma Mercado Livre não cadastrada." }, 400);

    const { data: accounts, error: ae } = await db
      .from("affiliate_accounts")
      .select("id,status,configuracao,updated_at")
      .eq("user_id", userId)
      .eq("platform_id", platform.id)
      .eq("status", "conectada")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (ae || !accounts?.length) return json({ ok: false, error: "Mercado Livre não está conectado." }, 400);

    const cfg = accounts[0].configuracao && typeof accounts[0].configuracao === "object"
      ? accounts[0].configuracao
      : {};

    const accessToken = typeof cfg.access_token === "string" ? cfg.access_token : "";
    if (!accessToken) return json({ ok: false, error: "Token do Mercado Livre não encontrado." }, 400);

    const authHeaders = {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json"
    };

    async function getJson(url: string, useAuth = true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          headers: useAuth ? authHeaders : { Accept: "application/json" },
          signal: controller.signal
        });
        const raw = await response.text();
        let data: any = null;
        try {
          data = JSON.parse(raw);
        } catch {}
        return {
          ok: response.ok,
          status: response.status,
          data,
          error: typeof data?.message === "string" ? data.message : typeof data?.error === "string" ? data.error : raw.slice(0, 300)
        };
      } finally {
        clearTimeout(timer);
      }
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
        image: item.thumbnail || item.pictures?.[0]?.url || item.pictures?.[0]?.secure_url || null,
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

    // Busca diretamente nas publicações do Mercado Livre.
    // Evita depender do buy_box_winner do catálogo, que pode existir
    // somente em determinados produtos e não representa uma publicação.
    for (const term of TERMS) {
      // A busca geral de publicações é pública. Primeiro tentamos sem token,
      // evitando que uma política específica do token bloqueie a pesquisa.
      // Se a API exigir autenticação, repetimos a mesma consulta com o token.
      let search = await getJson(
        ML + "/sites/MLB/search?limit=" + SEARCH_LIMIT +
        "&q=" + encodeURIComponent(term) +
        "&sort=relevance",
        false
      );

      if (!search.ok) {
        search = await getJson(
          ML + "/sites/MLB/search?limit=" + SEARCH_LIMIT +
          "&q=" + encodeURIComponent(term) +
          "&sort=relevance"
        );
      }

      const diagnostic: any = {
        term,
        search_status: search.status,
        search_results: Array.isArray(search.data?.results) ? search.data.results.length : 0,
        search_error: search.ok ? null : search.error
      };

      let termCandidates = 0;
      let rejected = 0;

      if (search.ok && Array.isArray(search.data?.results)) {
        for (const item of search.data.results) {
          const offer = makeOffer(item, term);
          if (offer) {
            candidates.push(offer);
            termCandidates++;
          } else {
            rejected++;
          }
        }
      }

      diagnostic.rejected = rejected;
      diagnostic.term_candidates = termCandidates;

      // Mantém uma consulta leve ao catálogo somente para diagnóstico.
      // Não faz chamadas individuais /products/{id}, evitando a trava 429.
      if (termCandidates === 0) {
        const catalog = await getJson(
          ML + "/products/search?status=active&site_id=MLB&limit=5&q=" +
          encodeURIComponent(term)
        );

        diagnostic.catalog_status = catalog.status;
        diagnostic.catalog_results = Array.isArray(catalog.data?.results)
          ? catalog.data.results.length
          : 0;
        diagnostic.catalog_error = catalog.ok ? null : catalog.error;
      }

      diagnostics.push(diagnostic);
    }

    const unique: any[] = [];
    const seen = new Set<string>();

    for (const item of candidates.sort(
      (a, b) =>
        b.score - a.score ||
        b.discount - a.discount ||
        a.current - b.current
    )) {
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
        dados_origem: {
          fonte: "mercadolivre-search",
          termo: o.term,
          catalog_product_id: o.product_external_id,
          item_id: o.external_id
        },
        promocao_id_externo: o.promotion_id,
        oferta_tipo: "oferta",
        melhor_preco: o.score > 0,
        score_oferta: o.score,
        atualizada_em: now,
        coletada_em: now
      };

      const { data: existing, error: findError } = await db
        .from("offers")
        .select("id")
        .eq("user_id", userId)
        .eq("platform_id", platform.id)
        .eq("product_external_id", o.external_id)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      let offerId = existing?.id || null;

      if (offerId) {
        const { error } = await db
          .from("offers")
          .update(values)
          .eq("id", offerId)
          .eq("user_id", userId);

        if (error) throw error;
        atualizadas++;
      } else {
        const { data: inserted, error } = await db
          .from("offers")
          .insert({ ...values, encontrada_em: now })
          .select("id")
          .single();

        if (error) throw error;
        offerId = inserted.id;
        novas++;
      }

      ofertas.push({
        id: offerId,
        external_id: o.external_id,
        product_external_id: o.product_external_id,
        title: o.title,
        current: o.current,
        original: o.original,
        discount: o.discount,
        image: o.image,
        permalink: o.permalink,
        promotion_id: o.promotion_id,
        promotion_type: o.promotion_type,
        score: o.score
      });

      if (ofertas.length >= limit) break;
    }

    return json({
      ok: true,
      produtos_encontrados: ofertas.length,
      novas,
      atualizadas,
      limite: limit,
      ofertas,
      diagnostico: diagnostics
    });
  } catch (e) {
    console.error("PROCESS-OFFERS ERRO:", e);
    return json({
      ok: false,
      error: e instanceof Error ? e.message : "Erro interno."
    }, 500);
  }
});
