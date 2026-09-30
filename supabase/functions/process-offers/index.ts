import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML = "https://api.mercadolibre.com";
const TERMS = ["celular","notebook","air fryer","smart tv"];
const MAX = 30;
const MAX_PRODUCTS_PER_TERM = 5;
const MAX_CATALOG_DETAILS = 12;
const CHILD_LIMIT = 8;

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

    const account = accounts[0];
    const cfg = account.configuracao && typeof account.configuracao === "object"
      ? account.configuracao
      : {};
    const accessToken = typeof cfg.access_token === "string" ? cfg.access_token : "";

    if (!accessToken) {
      return json({ ok: false, error: "Token do Mercado Livre não encontrado." }, 400);
    }

    const headers = {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json"
    };

    const diagnostics: any[] = [];
    const candidates: any[] = [];
    let catalogDetails = 0;
    const seenCatalog = new Set<string>();
    const seenItems = new Set<string>();

    async function getJson(url: string) {
      const r = await fetch(url, { headers });
      const text = await r.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch {}
      return { r, data };
    }

    async function inspectProduct(productId: string, term: string, depth = 0): Promise<void> {
      if (!productId || depth > 2 || candidates.length >= limit * 3) return;
      if (seenCatalog.has(productId)) return;
      seenCatalog.add(productId);

      const { r, data } = await getJson(
        ML + "/products/" + encodeURIComponent(productId)
      );

      diagnostics.push({
        source: "products/detail",
        product_id: productId,
        term,
        depth,
        status: r.status
      });

      if (!r.ok || !data) return;

      const winner = data.buy_box_winner || null;

      // Publicação vencedora, quando o catálogo fornecer diretamente.
      if (winner?.item_id) {
        await addItemCandidate(String(winner.item_id), data, winner, term);
      }

      // Lista as publicações reais que competem por este produto de catálogo.
      // O product_id é catálogo; o item_id é o anúncio comprável.
      try {
        const listingsResult = await getJson(
          ML + "/products/" + encodeURIComponent(productId) + "/items"
        );
        diagnostics.push({
          source: "products/items",
          product_id: productId,
          term,
          status: listingsResult.r.status,
          results: Array.isArray(listingsResult.data?.results)
            ? listingsResult.data.results.length
            : Array.isArray(listingsResult.data)
              ? listingsResult.data.length
              : 0
        });

        if (listingsResult.r.ok) {
          const listings = Array.isArray(listingsResult.data?.results)
            ? listingsResult.data.results
            : Array.isArray(listingsResult.data)
              ? listingsResult.data
              : [];

          for (const listing of listings) {
            if (candidates.length >= limit * 3) break;
            const listingItemId = listing?.item_id || listing?.id;
            if (listingItemId) {
              await addItemCandidate(String(listingItemId), data, listing, term);
            }
          }
        }
      } catch (e) {
        diagnostics.push({
          source: "products/items",
          product_id: productId,
          term,
          error: e instanceof Error ? e.message : "erro"
        });
      }

      // Produto pai: procurar produtos filhos específicos.
      const children = Array.isArray(data.children_ids)
        ? data.children_ids.filter(Boolean).slice(0, CHILD_LIMIT)
        : [];

      for (const childId of children) {
        if (candidates.length >= limit * 3) break;
        await inspectProduct(String(childId), term, depth + 1);
      }

      // Alguns catálogos expõem produtos específicos dentro de pickers.
      const pickerProducts: string[] = [];
      if (Array.isArray(data.pickers)) {
        for (const picker of data.pickers) {
          if (!Array.isArray(picker?.products)) continue;
          for (const child of picker.products) {
            if (child?.product_id) pickerProducts.push(String(child.product_id));
          }
        }
      }

      for (const childId of [...new Set(pickerProducts)].slice(0, CHILD_LIMIT)) {
        if (candidates.length >= limit * 3) break;
        await inspectProduct(childId, term, depth + 1);
      }
    }

    async function addItemCandidate(
      itemId: string,
      product: any,
      winner: any,
      term: string
    ) {
      if (!itemId || seenItems.has(itemId)) return;
      seenItems.add(itemId);

      let item: any = null;
      try {
        const result = await getJson(ML + "/items/" + encodeURIComponent(itemId));
        diagnostics.push({
          source: "items/detail",
          item_id: itemId,
          term,
          status: result.r.status
        });
        if (result.r.ok) item = result.data;
      } catch {}

      let current = Number(
        winner?.price ??
        item?.price ??
        NaN
      );

      let original = Number(
        winner?.original_price ??
        item?.original_price ??
        NaN
      );

      const range = product?.buy_box_winner_price_range;
      const rangeMin = Number(range?.min?.price ?? NaN);
      const rangeMax = Number(range?.max?.price ?? NaN);

      if (!Number.isFinite(current) && Number.isFinite(rangeMin)) current = rangeMin;
      if ((!Number.isFinite(original) || original <= current) &&
          Number.isFinite(rangeMax) && rangeMax > current) {
        original = rangeMax;
      }

      let permalink =
        item?.permalink ||
        winner?.permalink ||
        product?.permalink ||
        null;

      let image =
        item?.thumbnail ||
        item?.pictures?.[0]?.secure_url ||
        item?.pictures?.[0]?.url ||
        product?.pictures?.[0]?.url ||
        null;

      let title =
        item?.title ||
        winner?.title ||
        product?.name ||
        "Produto Mercado Livre";

      let freeShipping = !!item?.shipping?.free_shipping;

      // O item é a unidade comprável. Só candidatos com item_id entram.
      if (!permalink || !Number.isFinite(current)) {
        try {
          const priceResult = await getJson(
            ML +
            "/items/" +
            encodeURIComponent(itemId) +
            "/sale_price?context=channel_marketplace"
          );

          diagnostics.push({
            source: "items/sale_price",
            item_id: itemId,
            term,
            status: priceResult.r.status
          });

          if (priceResult.r.ok) {
            const sale = priceResult.data;
            if (Number.isFinite(Number(sale?.amount))) current = Number(sale.amount);
            if (Number.isFinite(Number(sale?.regular_amount)) &&
                Number(sale.regular_amount) > current) {
              original = Number(sale.regular_amount);
            }
          }
        } catch {}
      }

      if (!Number.isFinite(current) || current <= 0) return;

      const discount =
        Number.isFinite(original) &&
        original > current
          ? Math.round(((original - current) / original) * 100)
          : 0;

      if (somenteDescontos && discount <= 0) return;

      candidates.push({
        external_id: itemId,
        product_external_id: String(product.id),
        title,
        current,
        original: Number.isFinite(original) ? original : null,
        discount,
        image,
        permalink,
        promotion_id: null,
        promotion_type: null,
        free_shipping: freeShipping,
        score: discount * 10 + (freeShipping ? 5 : 0),
        term
      });
    }

    // Busca oficial do catálogo. /sites/MLB/search não é usado.
    for (const term of TERMS) {
      if (candidates.length >= limit * 3) break;

      const url =
        ML +
        "/products/search?status=active&site_id=MLB&limit=10&q=" +
        encodeURIComponent(term);

      const result = await getJson(url);

      diagnostics.push({
        source: "products/search",
        term,
        status: result.r.status,
        results: Array.isArray(result.data?.results)
          ? result.data.results.length
          : 0
      });

      if (!result.r.ok) continue;

      const results = Array.isArray(result.data?.results)
        ? result.data.results.slice(0, MAX_PRODUCTS_PER_TERM)
        : [];

      for (const p of results.slice(0, MAX_PRODUCTS_PER_TERM)) {
        if (!p?.id) continue;
        await inspectProduct(String(p.id), term);
        if (candidates.length >= limit * 3) break;
      }
    }

    // Atualiza preços usando o item real, nunca o catalog_product_id.
    const enriched: any[] = [];

    for (const item of candidates) {
      if (enriched.length >= limit) break;

      let current = item.current;
      let original = item.original;
      let promotionId: string | null = null;
      let promotionType: string | null = null;
      let freeShipping = item.free_shipping;

      try {
        const result = await getJson(
          ML +
          "/items/" +
          encodeURIComponent(item.external_id) +
          "/sale_price?context=channel_marketplace"
        );

        if (result.r.ok) {
          const sale = result.data;
          if (Number.isFinite(Number(sale?.amount))) {
            current = Number(sale.amount);
          }
          if (
            Number.isFinite(Number(sale?.regular_amount)) &&
            Number(sale.regular_amount) > current
          ) {
            original = Number(sale.regular_amount);
          }
          promotionId = sale?.metadata?.promotion_id || null;
          promotionType = sale?.metadata?.promotion_type || null;
        }
      } catch {}

      const discount =
        Number.isFinite(Number(original)) &&
        Number(original) > Number(current) &&
        Number(current) > 0
          ? Math.round(((Number(original) - Number(current)) / Number(original)) * 100)
          : 0;

      if (somenteDescontos && discount <= 0 && !promotionId) continue;

      enriched.push({
        ...item,
        current,
        original,
        discount,
        promotion_id: promotionId,
        promotion_type: promotionType,
        free_shipping: freeShipping,
        score: discount * 10 + (promotionId ? 25 : 0) + (freeShipping ? 5 : 0)
      });
    }

    // Remove duplicados por anúncio e ordena pelas melhores oportunidades.
    const unique: any[] = [];
    const selectedIds = new Set<string>();

    for (const item of enriched.sort(
      (a, b) =>
        b.score - a.score ||
        b.discount - a.discount ||
        Number(a.current || 0) - Number(b.current || 0)
    )) {
      if (selectedIds.has(item.external_id)) continue;
      selectedIds.add(item.external_id);
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
        classificacao:
          o.discount >= 20
            ? "excelente"
            : o.discount >= 10
              ? "interessante"
              : "verificar",
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
    }

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
        termos: TERMS,
        diagnostics
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
