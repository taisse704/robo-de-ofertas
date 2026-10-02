import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML = "https://api.mercadolibre.com";
const SITE_ID = "MLB";
const MAX = 20;
const REQUEST_TIMEOUT_MS = 8000;

// Categorias usadas somente como fonte de ranking "Mais vendidos".
// Não são termos de busca. A função tenta a primeira disponível e continua
// apenas se ainda não tiver conseguido 20 itens válidos.
const HIGHLIGHT_CATEGORIES = [
  { id: "MLB432825", nome: "Mais vendidos" },
  { id: "MLB270287", nome: "Geladeiras" },
  { id: "MLB1055", nome: "Celulares e Smartphones" },
  { id: "MLB1652", nome: "Notebooks" },
  { id: "MLB3525", nome: "Fones de Ouvido" },
  { id: "MLB108783", nome: "Tênis" },
  { id: "MLB180816", nome: "Ferramentas Elétricas" },
  { id: "MLB1246", nome: "Maquiagem" }
];

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
    const body = await req.json().catch(() => ({}));

    let userId = "";
    if (token === serviceRoleKey) {
      userId = String(body?.user_id || "");
    } else {
      const { data: userData, error: userError } = await db.auth.getUser(token);
      if (userError || !userData?.user) {
        return json({ ok: false, error: "Sessão inválida." }, 401);
      }
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

    let accessToken = typeof cfg.access_token === "string" ? cfg.access_token : "";
    if (!accessToken) {
      return json({ ok: false, error: "Token do Mercado Livre não encontrado." }, 400);
    }

    let authHeaders: Record<string, string> = {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json"
    };

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
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken
        })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.access_token) return false;

      accessToken = String(data.access_token);
      authHeaders = {
        Authorization: "Bearer " + accessToken,
        Accept: "application/json"
      };

      const newCfg = {
        ...cfg,
        access_token: accessToken,
        refresh_token: typeof data.refresh_token === "string"
          ? data.refresh_token
          : refreshToken,
        token_type: data.token_type || cfg.token_type || "Bearer",
        expires_in: data.expires_in ?? cfg.expires_in ?? null,
        token_obtido_em: new Date().toISOString()
      };

      await db
        .from("affiliate_accounts")
        .update({
          configuracao: newCfg,
          updated_at: new Date().toISOString()
        })
        .eq("id", account.id)
        .eq("user_id", userId);

      return true;
    }

    async function getJson(url: string, useAuth = true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        let response = await fetch(url, {
          headers: useAuth ? authHeaders : { Accept: "application/json" },
          signal: controller.signal
        });

        if (useAuth && response.status === 401) {
          const refreshed = await refreshAccessToken();
          if (refreshed) {
            response = await fetch(url, {
              headers: authHeaders,
              signal: controller.signal
            });
          }
        }

        const raw = await response.text();
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = null;
        }

        return {
          ok: response.ok,
          status: response.status,
          data,
          error: data?.message || data?.error || data?.cause?.[0]?.description ||
            (raw ? raw.slice(0, 500) : null),
          code: data?.code || null
        };
      } finally {
        clearTimeout(timer);
      }
    }

    function getItemIdFromUp(data: any): string | null {
      const possible = [
        data?.item_id,
        data?.itemId,
        data?.item?.id,
        Array.isArray(data?.items) ? data.items[0]?.id : null,
        Array.isArray(data?.items) ? data.items[0] : null,
        Array.isArray(data?.item_ids) ? data.item_ids[0] : null
      ];

      for (const value of possible) {
        if (typeof value === "string" && value.startsWith("MLB")) return value;
      }

      return null;
    }

    async function resolveHighlightEntry(entry: any) {
      const id = String(entry?.id || "");
      const type = String(entry?.type || "");

      if (!id) return null;

      if (type === "ITEM") {
        return { itemId: id, sourceId: id, sourceType: type };
      }

      if (type === "PRODUCT") {
        const product = await getJson(
          ML + "/products/" + encodeURIComponent(id),
          true
        );

        if (!product.ok || !product.data) {
          return {
            error: true,
            sourceId: id,
            sourceType: type,
            status: product.status,
            message: product.error
          };
        }

        const itemId = product.data?.buy_box_winner?.item_id;
        if (typeof itemId === "string" && itemId.startsWith("MLB")) {
          return {
            itemId,
            sourceId: id,
            sourceType: type,
            product: product.data
          };
        }

        return {
          error: true,
          sourceId: id,
          sourceType: type,
          status: product.status,
          message: "Produto sem buy_box_winner."
        };
      }

      if (type === "USER_PRODUCT") {
        const up = await getJson(
          ML + "/user-products/" + encodeURIComponent(id),
          true
        );

        if (!up.ok || !up.data) {
          return {
            error: true,
            sourceId: id,
            sourceType: type,
            status: up.status,
            message: up.error
          };
        }

        let itemId = getItemIdFromUp(up.data);

        if (!itemId && up.data?.user_id) {
          const sellerId = String(up.data.user_id);
          const items = await getJson(
            ML + "/users/" + encodeURIComponent(sellerId) +
            "/items/search?user_product_id=" + encodeURIComponent(id) +
            "&limit=1",
            true
          );

          if (items.ok && Array.isArray(items.data?.results)) {
            itemId = items.data.results.find(
              (v: any) => typeof v === "string" && v.startsWith("MLB")
            ) || null;
          }
        }

        if (itemId) {
          return {
            itemId,
            sourceId: id,
            sourceType: type,
            userProduct: up.data
          };
        }

        return {
          error: true,
          sourceId: id,
          sourceType: type,
          status: up.status,
          message: "User Product sem item associado."
        };
      }

      return {
        error: true,
        sourceId: id,
        sourceType: type,
        status: 400,
        message: "Tipo de destaque não reconhecido."
      };
    }

    async function runWithConcurrency<T>(
      values: any[],
      worker: (value: any) => Promise<T>,
      concurrency = 5
    ): Promise<T[]> {
      const output: T[] = new Array(values.length);
      let cursor = 0;

      async function runner() {
        while (true) {
          const index = cursor++;
          if (index >= values.length) return;
          output[index] = await worker(values[index]);
        }
      }

      await Promise.all(
        Array.from(
          { length: Math.min(concurrency, values.length) },
          () => runner()
        )
      );

      return output;
    }

    const diagnostics: any[] = [];
    const highlightEntries: any[] = [];
    const seenSource = new Set<string>();

    // Primeiro tentamos o ranking oficial "Mais vendidos". Se ele não
    // entregar 20 itens válidos, tentamos outras categorias de ranking.
    for (const category of HIGHLIGHT_CATEGORIES) {
      if (highlightEntries.length >= 40) break;

      const result = await getJson(
        ML + "/highlights/" + SITE_ID + "/category/" +
        encodeURIComponent(category.id),
        true
      );

      const content = Array.isArray(result.data?.content)
        ? result.data.content
        : [];

      const diagnostic = {
        categoria: category.nome,
        categoria_id: category.id,
        status: result.status,
        encontrados: content.length,
        erro: result.ok ? null : result.error
      };

      diagnostics.push(diagnostic);

      if (!result.ok || !content.length) continue;

      for (const entry of content) {
        const key = String(entry?.type || "") + ":" + String(entry?.id || "");
        if (!entry?.id || seenSource.has(key)) continue;
        seenSource.add(key);

        highlightEntries.push({
          ...entry,
          categoria_id: category.id,
          categoria_nome: category.nome
        });

        if (highlightEntries.length >= 40) break;
      }
    }

    if (!highlightEntries.length) {
      return json({
        ok: false,
        produtos_encontrados: 0,
        novas: 0,
        atualizadas: 0,
        limite: limit,
        ofertas: [],
        diagnostico: diagnostics,
        error: "O Mercado Livre não retornou nenhum ranking de Mais Vendidos disponível para consulta."
      });
    }

    // Resolve somente o necessário para chegar aos 20 itens, evitando
    // dezenas de chamadas e reduzindo o risco de HTTP 429.
    const resolved: any[] = [];
    const resolutionBatch = highlightEntries.slice(0, 30);

    const resolutionResults = await runWithConcurrency(
      resolutionBatch,
      (entry) => resolveHighlightEntry(entry),
      5
    );

    for (let i = 0; i < resolutionResults.length; i++) {
      const resolvedEntry = resolutionResults[i];
      if (resolvedEntry && !resolvedEntry.error && resolvedEntry.itemId) {
        resolved.push({
          ...resolvedEntry,
          highlight: resolutionBatch[i]
        });
      }
      if (resolved.length >= Math.min(limit + 5, MAX)) break;
    }

    if (!resolved.length) {
      return json({
        ok: false,
        produtos_encontrados: 0,
        novas: 0,
        atualizadas: 0,
        limite: limit,
        ofertas: [],
        diagnostico: diagnostics,
        resolvidos: 0,
        error: "O ranking foi encontrado, mas nenhuma publicação pôde ser convertida em item do Mercado Livre."
      });
    }

    const itemIds = Array.from(
      new Set(
        resolved
          .map((r) => String(r.itemId))
          .filter((id) => id.startsWith("MLB"))
      )
    ).slice(0, 20);

    // O endpoint bulk é usado para consultar os detalhes dos itens em lote.
    const bulk = await getJson(
      ML + "/items/bulk?ids=" + itemIds.map(encodeURIComponent).join(","),
      true
    );

    const itemMap = new Map<string, any>();

    if (bulk.ok && Array.isArray(bulk.data)) {
      for (const row of bulk.data) {
        const item = row?.body || row;
        if (item?.id) itemMap.set(String(item.id), item);
      }
    }

    // Se o bulk falhar, usamos apenas uma quantidade pequena de GETs
    // individuais para não transformar uma falha em uma enxurrada de requests.
    if (!itemMap.size) {
      const fallbackItems = await runWithConcurrency(
        itemIds.slice(0, 10),
        async (id) => {
          const result = await getJson(
            ML + "/items/" + encodeURIComponent(id),
            true
          );
          return result.ok ? result.data : null;
        },
        4
      );

      for (const item of fallbackItems) {
        if (item?.id) itemMap.set(String(item.id), item);
      }
    }

    const candidates: any[] = [];

    for (const r of resolved) {
      const item = itemMap.get(String(r.itemId));
      if (!item) continue;

      const current = Number(item.price ?? item.base_price);
      if (!Number.isFinite(current) || current <= 0) continue;

      const originalValues = [
        item.original_price,
        item.sale_price?.regular_amount,
        item.sale_price?.amount,
        item.base_price
      ];

      let original: number | null = null;
      for (const value of originalValues) {
        const n = Number(value);
        if (Number.isFinite(n) && n > current) {
          original = n;
          break;
        }
      }

      const discount = original
        ? Math.round(((original - current) / original) * 100)
        : 0;

      if (somenteDescontos && discount <= 0) continue;

      const freeShipping =
        item?.shipping?.free_shipping === true ||
        item?.shipping?.tags?.includes("mandatory_free_shipping");

      const promotionId =
        Array.isArray(item?.deal_ids) && item.deal_ids.length
          ? String(item.deal_ids[0])
          : null;

      const position = Number(r.highlight?.position) || 999;

      candidates.push({
        external_id: String(item.id),
        product_external_id: String(
          item.catalog_product_id ||
          item.user_product_id ||
          item.id
        ),
        title: item.title || r.highlight?.categoria_nome || "Produto Mercado Livre",
        current,
        original,
        discount,
        image:
          item.thumbnail ||
          item.pictures?.[0]?.secure_url ||
          item.pictures?.[0]?.url ||
          null,
        permalink: item.permalink || null,
        promotion_id: promotionId,
        promotion_type: item.listing_type_id || null,
        free_shipping: freeShipping,
        position,
        categoria_id: r.highlight?.categoria_id || item.category_id || null,
        categoria_nome: r.highlight?.categoria_nome || null,
        score:
          discount * 100 +
          (promotionId ? 25 : 0) +
          (freeShipping ? 10 : 0) +
          Math.max(0, 21 - position),
        oferta_tipo: discount > 0 || promotionId ? "promocao" : "mais_vendido"
      });
    }

    // Promoções vêm primeiro; dentro do mesmo nível, preservamos a força
    // do ranking de Mais Vendidos.
    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        b.discount - a.discount ||
        a.position - b.position
    );

    const unique: any[] = [];
    const seenProducts = new Set<string>();

    for (const item of candidates) {
      if (seenProducts.has(item.product_external_id)) continue;
      seenProducts.add(item.product_external_id);
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
        product_external_id: o.product_external_id,
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
          fonte: "mercadolivre-highlights",
          categoria_id: o.categoria_id,
          categoria_nome: o.categoria_nome,
          posicao_ranking: o.position,
          item_id: o.external_id
        },
        promocao_id_externo: o.promotion_id,
        oferta_tipo: o.oferta_tipo,
        melhor_preco: o.discount > 0 || Boolean(o.promotion_id),
        score_oferta: o.score,
        atualizada_em: now,
        coletada_em: now
      };

      const { data: existing, error: findError } = await db
        .from("offers")
        .select("id")
        .eq("user_id", userId)
        .eq("platform_id", platform.id)
        .eq("product_external_id", o.product_external_id)
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
        position: o.position,
        categoria_nome: o.categoria_nome,
        score: o.score,
        oferta_tipo: o.oferta_tipo
      });
    }

    return json({
      ok: true,
      produtos_encontrados: ofertas.length,
      novas,
      atualizadas,
      limite: limit,
      modo_busca: "mais_vendidos_com_promocoes",
      ofertas,
      diagnostico: {
        categorias_consultadas: diagnostics,
        destaques_recebidos: highlightEntries.length,
        destaques_resolvidos: resolved.length,
        itens_consultados: itemIds.length,
        itens_com_detalhes: itemMap.size,
        candidatos_com_preco: candidates.length,
        em_promocao: candidates.filter((x) => x.discount > 0 || x.promotion_id).length,
        sem_preco: Math.max(0, resolved.length - itemMap.size)
      }
    });
  } catch (e) {
    console.error("PROCESS-OFFERS ERRO:", e);
    return json({
      ok: false,
      error: e instanceof Error ? e.message : "Erro interno."
    }, 500);
  }
});