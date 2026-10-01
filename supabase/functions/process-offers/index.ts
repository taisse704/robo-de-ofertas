import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML = "https://api.mercadolibre.com";
const TERMS = ["celular", "notebook", "air fryer", "smart tv"];
const MAX = 30;
const CATALOG_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 10000;

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
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

    const { data: platform, error: platformError } = await db
      .from("platforms")
      .select("id,nome")
      .eq("nome", "Mercado Livre")
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();

    if (platformError || !platform) return json({ ok: false, error: "Plataforma Mercado Livre não cadastrada." }, 400);

    const { data: accounts, error: accountError } = await db
      .from("affiliate_accounts")
      .select("id,status,configuracao,updated_at")
      .eq("user_id", userId)
      .eq("platform_id", platform.id)
      .eq("status", "conectada")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (accountError || !accounts?.length) return json({ ok: false, error: "Mercado Livre não está conectado." }, 400);

    const cfg = accounts[0].configuracao && typeof accounts[0].configuracao === "object" ? accounts[0].configuracao : {};
    const accessToken = typeof cfg.access_token === "string" ? cfg.access_token : "";

    if (!accessToken) return json({ ok: false, error: "Token do Mercado Livre não encontrado." }, 400);

    const authHeaders = {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json",
    };

    async function getJson(url: string) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, { headers: authHeaders, signal: controller.signal });
        const raw = await response.text();
        let data: any = null;
        try { data = JSON.parse(raw); } catch {}

        return {
          ok: response.ok,
          status: response.status,
          data,
          error: typeof data?.message === "string" ? data.message :
            typeof data?.error === "string" ? data.error : raw.slice(0, 300),
        };
      } catch (e) {
        return {
          ok: false,
          status: 0,
          data: null,
          error: e instanceof Error ? e.message : "Falha de rede.",
        };
      } finally {
        clearTimeout(timer);
      }
    }

    function makeOffer(product: any, winner: any, item: any, term: string) {
      const current = Number(winner?.price ?? item?.price);
      if (!winner?.item_id || !Number.isFinite(current) || current <= 0) return null;

      let original: number | null = null;
      for (const value of [winner?.original_price, item?.original_price, item?.base_price]) {
        const n = Number(value);
        if (Number.isFinite(n) && n > current) {
          original = n;
          break;
        }
      }

      const discount = original ? Math.round(((original - current) / original) * 100) : 0;
      if (somenteDescontos && discount <= 0) return null;

      const image = item?.thumbnail ||
        item?.pictures?.[0]?.url ||
        item?.pictures?.[0]?.secure_url ||
        product?.pictures?.[0]?.url ||
        null;

      const permalink = item?.permalink || product?.permalink || null;
      const title = item?.title || product?.name || "Produto Mercado Livre";
      const freeShipping = winner?.shipping?.free_shipping === true || item?.shipping?.free_shipping === true;
      const promotionId = winner?.deal_ids?.[0] || null;

      return {
        external_id: String(winner.item_id),
        product_external_id: String(product.id),
        title,
        current,
        original,
        discount,
        image,
        permalink,
        promotion_id: promotionId,
        promotion_type: winner?.listing_type_id || null,
        free_shipping: freeShipping,
        seller_id: winner?.seller_id ?? item?.seller_id ?? null,
        score: discount * 10 + (freeShipping ? 5 : 0) + (promotionId ? 5 : 0),
        term,
      };
    }

    const candidates: any[] = [];
    const diagnostics: any[] = [];
    const processedProducts = new Set<string>();

    for (const term of TERMS) {
      const catalogUrl =
        ML + "/products/search?status=active&site_id=MLB&limit=" +
        CATALOG_LIMIT + "&q=" + encodeURIComponent(term);

      const catalog = await getJson(catalogUrl);

      const diagnostic: any = {
        term,
        catalog_status: catalog.status,
        catalog_results: Array.isArray(catalog.data?.results) ? catalog.data.results.length : 0,
        no_winner: 0,
        winner_without_price: 0,
        rejected_by_make_offer: 0,
        term_candidates: 0,
        detail_errors: 0,
        detail_statuses: [],
        item_statuses: [],
        item_detail_errors: 0,
      };

      if (!catalog.ok || !Array.isArray(catalog.data?.results)) {
        diagnostic.catalog_error = catalog.error;
        diagnostics.push(diagnostic);
        continue;
      }

      for (const product of catalog.data.results) {
        if (!product?.id) continue;

        const productId = String(product.id);
        if (processedProducts.has(productId)) continue;
        processedProducts.add(productId);

        const detail = await getJson(ML + "/products/" + encodeURIComponent(productId));

        diagnostic.detail_statuses.push(detail.status);
        if (!detail.ok || !detail.data) {
          diagnostic.detail_errors++;
          continue;
        }

        const detailProduct = detail.data;
        const winner = detailProduct?.buy_box_winner;

        if (!winner) {
          diagnostic.no_winner++;
          continue;
        }

        let item: any = null;

        if (winner?.item_id) {
          const itemDetail = await getJson(ML + "/items/" + encodeURIComponent(String(winner.item_id)));
          if (itemDetail.ok && itemDetail.data) {
            item = itemDetail.data;
          } else {
            diagnostic.item_detail_errors++;
            diagnostic.item_statuses.push(itemDetail.status);
          }
        }

        const winnerPrice = Number(winner?.price ?? item?.price);
        if (!Number.isFinite(winnerPrice) || winnerPrice <= 0) {
          diagnostic.winner_without_price++;
          continue;
        }

        const offer = makeOffer(detailProduct, winner, item, term);
        if (!offer) {
          diagnostic.rejected_by_make_offer++;
          continue;
        }

        candidates.push(offer);
        diagnostic.term_candidates++;
      }

      diagnostics.push(diagnostic);
    }

    const unique: any[] = [];
    const seen = new Set<string>();

    for (const item of candidates.sort((a, b) =>
      b.score - a.score || b.discount - a.discount || a.current - b.current
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
          fonte: "mercadolivre-catalog-buy-box",
          termo: o.term,
          catalog_product_id: o.product_external_id,
          item_id: o.external_id,
          seller_id: o.seller_id,
          free_shipping: o.free_shipping,
          promotion_id: o.promotion_id,
        },
        promocao_id_externo: o.promotion_id,
        oferta_tipo: "oferta",
        melhor_preco: o.score > 0,
        score_oferta: o.score,
        atualizada_em: now,
        coletada_em: now,
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
        const { error } = await db.from("offers").update(values).eq("id", offerId).eq("user_id", userId);
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
        free_shipping: o.free_shipping,
        seller_id: o.seller_id,
        score: o.score,
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
      diagnostico: diagnostics,
      fonte: "mercadolivre-catalog-buy-box",
    });
  } catch (e) {
    console.error("PROCESS-OFFERS ERRO:", e);
    return json({
      ok: false,
      error: e instanceof Error ? e.message : "Erro interno.",
    }, 500);
  }
});