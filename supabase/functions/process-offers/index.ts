import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML = "https://api.mercadolibre.com";
const TERMS = ["celular", "notebook", "air fryer", "smart tv"];
const MAX = 30;
const SEARCH_LIMIT = 10;
const DETAIL_LIMIT = 40;
const CHILD_LIMIT = 80;
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
    if (!auth?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Autorização obrigatória." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ ok: false, error: "Configuração do Supabase incompleta." }, 500);
    }

    const db = createClient(supabaseUrl, serviceRoleKey);
    const token = auth.slice(7);

    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData?.user) {
      return json({ ok: false, error: "Sessão inválida." }, 401);
    }

    const userId = userData.user.id;
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), MAX);
    const somenteDescontos = body?.somente_descontos === true;

    const { data: platform, error: pe } = await db
      .from("platforms")
      .select("id,nome")
      .eq("nome", "Mercado Livre")
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();

    if (pe || !platform) {
      return json({ ok: false, error: "Plataforma Mercado Livre não cadastrada." }, 400);
    }

    const { data: accounts, error: ae } = await db
      .from("affiliate_accounts")
      .select("id,status,configuracao,updated_at")
      .eq("user_id", userId)
      .eq("platform_id", platform.id)
      .eq("status", "conectada")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (ae || !accounts?.length) {
      return json({ ok: false, error: "Mercado Livre não está conectado." }, 400);
    }

    const cfg = accounts[0].configuracao && typeof accounts[0].configuracao === "object"
      ? accounts[0].configuracao
      : {};
    const accessToken = typeof cfg.access_token === "string" ? cfg.access_token : "";

    if (!accessToken) {
      return json({ ok: false, error: "Token do Mercado Livre não encontrado." }, 400);
    }

    const headers = {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json"
    };

    async function getJson(url: string) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const r = await fetch(url, { headers, signal: controller.signal });
        const text = await r.text();
        let data: any = null;
        try { data = JSON.parse(text); } catch {}
        return { ok: r.ok, status: r.status, data };
      } finally {
        clearTimeout(timer);
      }
    }

    function addCandidate(list: any[], product: any, winner: any, term: string) {
      if (!winner?.item_id || !Number.isFinite(Number(winner.price))) return;

      const current = Number(winner.price);
      const originalRaw = Number(winner.original_price);
      const original = Number.isFinite(originalRaw) && originalRaw > current
        ? originalRaw
        : null;

      const discount = original
        ? Math.round(((original - current) / original) * 100)
        : 0;

      if (somenteDescontos && discount <= 0 && !(winner.deal_ids?.length)) return;

      list.push({
        external_id: String(winner.item_id),
        product_external_id: String(product.id),
        title: product.name || "Produto Mercado Livre",
        current,
        original,
        discount,
        image: product.pictures?.[0]?.url || product.pictures?.[0]?.secure_url || null,
        permalink: product.permalink || null,
        promotion_id: Array.isArray(winner.deal_ids) && winner.deal_ids.length
          ? String(winner.deal_ids[0])
          : null,
        promotion_type: null,
        free_shipping: !!winner.shipping?.free_shipping,
        score: discount * 10 +
          (Array.isArray(winner.deal_ids) && winner.deal_ids.length ? 25 : 0) +
          (winner.shipping?.free_shipping ? 5 : 0),
        term
      });
    }

    // 1) Pesquisa no catálogo em paralelo: apenas 4 chamadas.
    const searches = await Promise.all(
      TERMS.map(async (term) => ({
        term,
        result: await getJson(
          ML + "/products/search?status=active&site_id=MLB&limit=10&q=" +
          encodeURIComponent(term)
        )
      }))
    );

    const candidates: any[] = [];
    const details: { id: string; term: string }[] = [];

    // 2) Usa o buy_box_winner quando a busca já o fornece.
    // Quando o resultado é um produto-pai, guardamos o ID para consultar
    // o detalhe em paralelo. Isso evita chamadas sequenciais e timeout.
    for (const search of searches) {
      if (!search.result.ok) continue;

      const products = Array.isArray(search.result.data?.results)
        ? search.result.data.results.slice(0, SEARCH_LIMIT)
        : [];

      for (const product of products) {
        if (!product?.id) continue;

        if (product.buy_box_winner?.item_id) {
          addCandidate(candidates, product, product.buy_box_winner, search.term);
        } else {
          details.push({ id: String(product.id), term: search.term });
        }
      }
    }

    // 3) Consulta os produtos-pai em paralelo.
    const parentDetails = await Promise.all(
      details.slice(0, DETAIL_LIMIT).map(async ({ id, term }) => ({
        id,
        term,
        result: await getJson(ML + "/products/" + encodeURIComponent(id))
      }))
    );

    const children: { id: string; term: string }[] = [];

    for (const entry of parentDetails) {
      const product = entry.result.ok ? entry.result.data : null;
      if (!product) continue;

      if (product.buy_box_winner?.item_id) {
        addCandidate(candidates, product, product.buy_box_winner, entry.term);
        continue;
      }

      if (Array.isArray(product.children_ids)) {
        for (const childId of product.children_ids.slice(0, 2)) {
          children.push({ id: String(childId), term: entry.term });
          if (children.length >= CHILD_LIMIT) break;
        }
      }
      if (children.length >= CHILD_LIMIT) break;
    }

    // 3b) Consulta os filhos em paralelo. É neles que normalmente existe
    // uma página de produto específica e comprável com buy_box_winner.
    const childDetails = await Promise.all(
      children.map(async ({ id, term }) => ({
        id,
        term,
        result: await getJson(ML + "/products/" + encodeURIComponent(id))
      }))
    );

    for (const entry of childDetails) {
      if (!entry.result.ok || !entry.result.data) continue;
      const product = entry.result.data;
      if (product.buy_box_winner?.item_id) {
        addCandidate(candidates, product, product.buy_box_winner, entry.term);
      }
    }

    // 4) Deduplica e seleciona as melhores ofertas.
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

    // 5) Grava somente o necessário no banco. Não grava diagnósticos gigantes.
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
        classificacao:
          o.discount >= 20 ? "interessante" :
          o.discount >= 10 ? "interessante" : "verificar",
        permitido_afiliado: true,
        permitido_divulgacao: true,
        imagem_url: o.image,
        dados_origem: {
          fonte: "mercadolivre-products-search",
          termo: o.term,
          catalog_product_id: o.product_external_id,
          item_id: o.external_id
        },
        promocao_id_externo: o.promotion_id,
        oferta_tipo: o.promotion_id ? "promocao" : "oferta",
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

    // Log mínimo, sem armazenar respostas enormes do Mercado Livre.
    await db.from("logs").insert({
      user_id: userId,
      tipo: "process-offers",
      nivel: "info",
      mensagem: "Busca Mercado Livre concluída.",
      dados: {
        produtos_encontrados: ofertas.length,
        novas,
        atualizadas,
        limite: limit,
        termos: TERMS
      }
    });

    return json({
      ok: true,
      produtos_encontrados: ofertas.length,
      novas,
      atualizadas,
      limite: limit,
      ofertas
    });
  } catch (e) {
    console.error("PROCESS-OFFERS ERRO:", e);
    return json({
      ok: false,
      error: e instanceof Error ? e.message : "Erro interno."
    }, 500);
  }
});
