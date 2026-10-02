import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML = "https://api.mercadolibre.com";
const SITE_ID = "MLB";
const MAX = 20;
const REQUEST_TIMEOUT_MS = 8000;

// Categorias usadas somente como fonte de ranking "Mais vendidos".
// Não são termos de busca. A função tenta a primeira disponível e continua
// apenas se ainda não tiver conseguido 20 itens válidos.
const CATEGORY_GROUPS = [
  { id: "MLB1430", nome: "Moda" },
  { id: "MLB1574", nome: "Casa" },
  { id: "MLB3937", nome: "Acessórios" }
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

    async function getJson(url: string, useAuth = false) {
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

    async function resolveHighlightEntry(entry: any) {
      const id = String(entry?.id || "");
      const type = String(entry?.type || "");

      if (!id) return null;

      // ITEM: o ID retornado pelo /highlights já é a publicação.
      if (type === "ITEM") {
        // /items é leitura de publicação e não precisa da autorização
        // da conta do afiliado. Isso evita o bloqueio que já ocorreu
        // quando endpoints públicos foram chamados com Bearer OAuth.
        let item = await getJson(
          ML + "/items/" + encodeURIComponent(id),
          false
        );

        // Fallback autenticado somente se a leitura pública falhar.
        if (!item.ok) {
          item = await getJson(
            ML + "/items/" + encodeURIComponent(id),
            true
          );
        }

        if (item.ok && item.data?.id) {
          return {
            itemId: String(item.data.id),
            sourceId: id,
            sourceType: type,
            item: item.data
          };
        }

        return {
          error: true,
          sourceId: id,
          sourceType: type,
          status: item.status,
          message: item.error || "Não foi possível consultar o item."
        };
      }

      // PRODUCT: produtos-pai podem vir sem buy_box_winner.
      // Nesse caso, precisamos percorrer os children_ids até encontrar
      // um produto-filho ativo com uma publicação vencedora.
      if (type === "PRODUCT") {
        // Produtos de catálogo são dados de leitura. Primeiro consultamos
        // sem Bearer para evitar o PolicyAgent/403 que já ocorreu na busca.
        let product = await getJson(
          ML + "/products/" + encodeURIComponent(id),
          false
        );

        // Se a API exigir autenticação, tentamos novamente com OAuth.
        if (!product.ok) {
          product = await getJson(
            ML + "/products/" + encodeURIComponent(id),
            true
          );
        }

        if (!product.ok || !product.data) {
          return {
            error: true,
            sourceId: id,
            sourceType: type,
            status: product.status,
            message: product.error
          };
        }

        const data = product.data;

        if (typeof data?.buy_box_winner?.item_id === "string") {
          return {
            itemId: String(data.buy_box_winner.item_id),
            sourceId: id,
            sourceType: type,
            product: data
          };
        }

        const children = Array.isArray(data?.children_ids)
          ? data.children_ids.slice(0, 12)
          : [];

        for (const childId of children) {
          let child = await getJson(
            ML + "/products/" + encodeURIComponent(String(childId)),
            false
          );

          if (!child.ok) {
            child = await getJson(
              ML + "/products/" + encodeURIComponent(String(childId)),
              true
            );
          }

          if (
            child.ok &&
            child.data &&
            typeof child.data?.buy_box_winner?.item_id === "string"
          ) {
            return {
              itemId: String(child.data.buy_box_winner.item_id),
              sourceId: id,
              sourceType: type,
              product: child.data,
              parentProduct: data
            };
          }
        }

        // Alguns produtos retornados pelo ranking são páginas de catálogo
        // sem buy_box_winner e sem children_ids. A documentação atual do ML
        // orienta usar /products/search para localizar um produto ativo.
        // Tentamos pelo nome do produto e, se encontrarmos outro produto
        // ativo com buy_box_winner, usamos esse vencedor.
        const productName = String(data?.name || data?.family_name || "").trim();
        if (productName.length >= 3) {
          const searchUrl =
            ML + "/products/search?status=active&site_id=" + SITE_ID +
            "&limit=10&q=" + encodeURIComponent(productName);

          // /products/search é um recurso de leitura. Tentamos sem OAuth
          // primeiro para evitar o PolicyAgent/403 que já ocorreu quando
          // endpoints públicos foram chamados com o Bearer do afiliado.
          let search = await getJson(searchUrl, false);
          if (!search.ok) {
            search = await getJson(searchUrl, true);
          }

          const results = Array.isArray(search.data?.results)
            ? search.data.results.slice(0, 10)
            : [];

          for (const found of results) {
            const foundId = String(found?.id || "");
            if (!foundId || foundId === id) continue;

            let candidate = await getJson(
              ML + "/products/" + encodeURIComponent(foundId),
              false
            );

            if (!candidate.ok) {
              candidate = await getJson(
                ML + "/products/" + encodeURIComponent(foundId),
                true
              );
            }

            if (
              candidate.ok &&
              candidate.data &&
              candidate.data.status === "active" &&
              typeof candidate.data?.buy_box_winner?.item_id === "string"
            ) {
              return {
                itemId: String(candidate.data.buy_box_winner.item_id),
                sourceId: id,
                sourceType: type,
                product: candidate.data,
                parentProduct: data
              };
            }
          }
        }

        return {
          error: true,
          sourceId: id,
          sourceType: type,
          status: product.status,
          message: children.length
            ? "Produto sem buy_box_winner nos produtos-filhos e sem produto ativo substituto."
            : "Produto sem buy_box_winner; tentamos localizar um produto ativo equivalente."
        };
      }

      if (type === "USER_PRODUCT") {
        let up = await getJson(
          ML + "/user-products/" + encodeURIComponent(id),
          false
        );

        if (!up.ok) {
          up = await getJson(
            ML + "/user-products/" + encodeURIComponent(id),
            true
          );
        }

        if (!up.ok || !up.data) {
          return {
            error: true,
            sourceId: id,
            sourceType: type,
            status: up.status,
            message: up.error
          };
        }

        const directItemId = up.data?.item_id || up.data?.item?.id || up.data?.buy_box_winner?.item_id;
        if (typeof directItemId === "string" && directItemId.startsWith("MLB")) return { itemId: directItemId, sourceId: id, sourceType: type, userProduct: up.data };

        const sellerId = up.data?.user_id;
        if (!sellerId) {
          return {
            error: true,
            sourceId: id,
            sourceType: type,
            status: up.status,
            message: "User Product sem user_id do vendedor."
          };
        }

        // A documentação do Mercado Livre orienta obter os itens
        // associados ao User Product por /users/{SELLER_ID}/items/search.
        const items = await getJson(
          ML + "/users/" + encodeURIComponent(String(sellerId)) +
          "/items/search?user_product_id=" + encodeURIComponent(id) +
          "&limit=10",
          true
        );

        if (items.ok && Array.isArray(items.data?.results)) {
          const itemId = items.data.results.find(
            (value: any) =>
              typeof value === "string" && value.startsWith("MLB")
          );

          if (itemId) {
            return {
              itemId: String(itemId),
              sourceId: id,
              sourceType: type,
              userProduct: up.data
            };
          }
        }

        return {
          error: true,
          sourceId: id,
          sourceType: type,
          status: items.status,
          message: items.error || "User Product sem item associado."
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
    const resolutionErrors: any[] = [];
    const highlightEntries: any[] = [];
    const seenSource = new Set<string>();

    // O /highlights exige uma categoria com ranking próprio; categorias
    // raiz como Moda/Casa/Acessórios podem ter subcategorias. Por isso,
    // descobrimos folhas da árvore e consultamos o ranking de cada folha.
    async function discoverLeafCategories(root: { id: string; nome: string }) {
      const leaves: any[] = [];
      const queue: Array<{ id: string; nome: string; depth: number }> = [
        { id: root.id, nome: root.nome, depth: 0 }
      ];
      const seen = new Set<string>();

      while (queue.length && leaves.length < 18) {
        const current = queue.shift()!;
        if (seen.has(current.id)) continue;
        seen.add(current.id);

        const result = await getJson(
          ML + "/categories/" + encodeURIComponent(current.id),
          false
        );

        if (!result.ok || !result.data) continue;

        const children = Array.isArray(result.data?.children_categories)
          ? result.data.children_categories
          : [];

        if (!children.length) {
          leaves.push({
            id: current.id,
            nome: current.nome,
            grupo: root.nome
          });
          continue;
        }

        // Limitamos a profundidade para evitar uma explosão de chamadas.
        if (current.depth >= 2) continue;

        for (const child of children.slice(0, 12)) {
          if (child?.id) {
            queue.push({
              id: String(child.id),
              nome: String(child.name || current.nome),
              depth: current.depth + 1
            });
          }
        }
      }

      // Se a raiz já possuir ranking, ela também pode ser usada.
      if (!leaves.length) {
        leaves.push({ id: root.id, nome: root.nome, grupo: root.nome });
      }

      return leaves;
    }

    const highlightCategories: any[] = [];
    for (const root of CATEGORY_GROUPS) {
      const leaves = await discoverLeafCategories(root);
      highlightCategories.push(...leaves);
    }

    // Coletamos os rankings das folhas encontradas. O foco agora é:
    // Moda + Casa + Acessórios, priorizando mais vendidos e depois maior
    // desconto/promoção.
    for (const category of highlightCategories) {
      const result = await getJson(
        ML + "/highlights/" + SITE_ID + "/category/" +
        encodeURIComponent(category.id),
        true
      );

      const content = Array.isArray(result.data?.content)
        ? result.data.content
        : [];

      diagnostics.push({
        categoria: category.nome,
        grupo: category.grupo,
        categoria_id: category.id,
        status: result.status,
        encontrados: content.length,
        erro: result.ok ? null : result.error
      });

      if (!result.ok || !content.length) continue;

      for (const entry of content) {
        const entryType = String(entry?.type || "");

        // Para afiliados, usamos somente PRODUCT do catálogo oficial.
        // ITEM pode retornar 403 por restrições de acesso à publicação de
        // terceiros e USER_PRODUCT é específico do vendedor. Ignoramos
        // ambos no ranking e seguimos para outros produtos/categorias.
        if (entryType !== "PRODUCT") continue;

        const key = entryType + ":" + String(entry?.id || "");
        if (!entry?.id || seenSource.has(key)) continue;
        seenSource.add(key);

        highlightEntries.push({
          ...entry,
          categoria_id: category.id,
          categoria_nome: category.nome,
          categoria_grupo: category.grupo
        });
      }

      // Depois de consultar várias folhas, já temos candidatos suficientes
      // para o filtro de 20 ofertas. Ainda deixamos margem para o filtro
      // de desconto eliminar produtos sem promoção.
      if (highlightEntries.length >= 120) break;
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

    // Resolvemos somente produtos de catálogo e continuamos enquanto ainda
    // faltarem itens válidos. Isso evita que ITEM/USER_PRODUCT bloqueados
    // impeçam a coleta das ofertas de catálogo.
    const resolved: any[] = [];
    const targetResolved = Math.min(limit + 5, MAX);
    const RESOLUTION_BATCH_SIZE = 10;

    for (
      let offset = 0;
      offset < highlightEntries.length && resolved.length < targetResolved;
      offset += RESOLUTION_BATCH_SIZE
    ) {
      const resolutionBatch = highlightEntries.slice(
        offset,
        offset + RESOLUTION_BATCH_SIZE
      );

      const resolutionResults = await runWithConcurrency(
        resolutionBatch,
        (entry) => resolveHighlightEntry(entry),
        3
      );

      for (let i = 0; i < resolutionResults.length; i++) {
        const resolvedEntry = resolutionResults[i];

        if (
          resolvedEntry &&
          !resolvedEntry.error &&
          resolvedEntry.itemId
        ) {
          resolved.push({
            ...resolvedEntry,
            highlight: resolutionBatch[i]
          });
        } else if (resolvedEntry?.error) {
          resolutionErrors.push({
            tipo: resolvedEntry.sourceType,
            id: resolvedEntry.sourceId,
            status: resolvedEntry.status ?? null,
            erro: resolvedEntry.message || "Falha ao resolver publicação."
          });
        }

        if (resolved.length >= targetResolved) break;
      }
    }

    if (!resolved.length) {
      return json({
        ok: false,
        produtos_encontrados: 0,
        novas: 0,
        atualizadas: 0,
        limite: limit,
        ofertas: [],
        diagnostico: {
          categorias_consultadas: diagnostics,
          erros_resolucao: resolutionErrors.slice(0, 25)
        },
        resolvidos: 0,
        error: resolutionErrors.length
          ? "O ranking foi encontrado, mas as publicações públicas não puderam ser convertidas. " +
            resolutionErrors.slice(0, 3).map((x) =>
              `${x.tipo || "resultado"} ${x.id || ""}: ${x.status || "sem status"} - ${x.erro || "erro"}`
            ).join(" | ")
          : "O ranking foi encontrado, mas nenhuma publicação pública pôde ser convertida em item do Mercado Livre."
      });
    }

    const itemIds = Array.from(new Set(
      resolved.filter((r) => !r.product).map((r) => String(r.itemId)).filter((id) => id.startsWith("MLB"))
    )).slice(0, 20);

    const itemMap = new Map<string, any>();

    if (itemIds.length) {
      let bulk = await getJson(
        ML + "/items/bulk?ids=" + itemIds.map(encodeURIComponent).join(","),
        false
      );
      if (!bulk.ok) {
        bulk = await getJson(
          ML + "/items/bulk?ids=" + itemIds.map(encodeURIComponent).join(","),
          true
        );
      }
      if (bulk.ok && Array.isArray(bulk.data)) {
        for (const row of bulk.data) {
          const item = row?.body || row;
          if (item?.id) itemMap.set(String(item.id), item);
        }
      }
      if (!itemMap.size) {
        const fallbackItems = await runWithConcurrency(
          itemIds.slice(0, 10),
          async (id) => {
            let result = await getJson(ML + "/items/" + encodeURIComponent(id), false);
            if (!result.ok) result = await getJson(ML + "/items/" + encodeURIComponent(id), true);
            return result.ok ? result.data : null;
          },
          4
        );
        for (const item of fallbackItems) if (item?.id) itemMap.set(String(item.id), item);
      }
    }

    const salePriceMap = new Map<string, any>();
    if (itemIds.length) {
      const salePrices = await runWithConcurrency(
        itemIds.slice(0, MAX),
        async (id) => ({
          id,
          result: await getJson(
            ML + "/items/" + encodeURIComponent(id) + "/sale_price?context=channel_marketplace",
            true
          )
        }),
        2
      );
      for (const entry of salePrices) {
        if (entry.result?.ok && entry.result?.data) salePriceMap.set(entry.id, entry.result.data);
      }
    }

    const candidates: any[] = [];

    for (const r of resolved) {
      // PRODUCT: usa diretamente os dados do catálogo e do buy_box_winner.
      // Não faz /items nem /sale_price, evitando 403 em publicações de terceiros.
      if (r.product?.buy_box_winner) {
        const product = r.product;
        const winner = product.buy_box_winner;
        const current = Number(winner.price);
        if (!Number.isFinite(current) || current <= 0) continue;

        const originalNumber = Number(winner.original_price);
        const original = Number.isFinite(originalNumber) && originalNumber > current ? originalNumber : null;
        const discount = original ? Math.round(((original - current) / original) * 100) : 0;
        const promotionId = Array.isArray(winner.deal_ids) && winner.deal_ids.length
          ? String(winner.deal_ids[0])
          : null;
        const freeShipping =
          winner?.shipping?.free_shipping === true ||
          winner?.shipping?.tags?.includes("mandatory_free_shipping");
        const position = Number(r.highlight?.position) || 999;

        if (somenteDescontos && discount <= 0 && !promotionId) continue;

        candidates.push({
          external_id: String(winner.item_id || product.id),
          product_external_id: String(product.id),
          title: product.name || product.family_name || r.highlight?.categoria_nome || "Produto Mercado Livre",
          current,
          original,
          discount,
          image:
            product.pictures?.[0]?.secure_url ||
            product.pictures?.[0]?.url ||
            product.pictures?.[0]?.thumbnail ||
            null,
          permalink: product.permalink || null,
          promotion_id: promotionId,
          promotion_type: promotionId ? "deal" : (winner.listing_type_id || null),
          free_shipping: freeShipping,
          position,
          categoria_id: r.highlight?.categoria_id || winner.category_id || null,
          categoria_nome: r.highlight?.categoria_nome || null,
          categoria_grupo: r.highlight?.categoria_grupo || null,
          score:
            discount * 100 +
            (promotionId ? 25 : 0) +
            (freeShipping ? 10 : 0) +
            Math.max(0, 21 - position),
          oferta_tipo: discount > 0 || promotionId ? "promocao" : "mais_vendido"
        });
        continue;
      }

      // Fallback para ITEM não pertencente ao catálogo.
      const item = itemMap.get(String(r.itemId));
      if (!item) continue;

      const salePrice = salePriceMap.get(String(item.id));
      const current = Number(salePrice?.amount ?? item.price ?? item.base_price);
      if (!Number.isFinite(current) || current <= 0) continue;

      const originalCandidates = [
        salePrice?.regular_amount,
        item.original_price,
        item.sale_price?.regular_amount,
        item.base_price
      ];
      let original: number | null = null;
      for (const value of originalCandidates) {
        const n = Number(value);
        if (Number.isFinite(n) && n > current) {
          original = n;
          break;
        }
      }

      const discount = original ? Math.round(((original - current) / original) * 100) : 0;
      const promotionId =
        salePrice?.metadata?.promotion_id ||
        (Array.isArray(item?.deal_ids) && item.deal_ids.length ? String(item.deal_ids[0]) : null);
      const promotionType =
        salePrice?.metadata?.promotion_type ||
        item?.sale_price?.metadata?.promotion_type ||
        item.listing_type_id ||
        null;

      if (somenteDescontos && discount <= 0 && !promotionId) continue;

      const freeShipping =
        item?.shipping?.free_shipping === true ||
        item?.shipping?.tags?.includes("mandatory_free_shipping");
      const position = Number(r.highlight?.position) || 999;

      candidates.push({
        external_id: String(item.id),
        product_external_id: String(item.catalog_product_id || item.user_product_id || item.id),
        title: item.title || r.highlight?.categoria_nome || "Produto Mercado Livre",
        current,
        original,
        discount,
        image: item.thumbnail || item.pictures?.[0]?.secure_url || item.pictures?.[0]?.url || null,
        permalink: item.permalink || null,
        promotion_id: promotionId,
        promotion_type: promotionType,
        free_shipping: freeShipping,
        position,
        categoria_id: r.highlight?.categoria_id || item.category_id || null,
        categoria_nome: r.highlight?.categoria_nome || null,
        categoria_grupo: r.highlight?.categoria_grupo || null,
        score:
          discount * 100 +
          (promotionId ? 25 : 0) +
          (freeShipping ? 10 : 0) +
          Math.max(0, 21 - position),
        oferta_tipo: discount > 0 || promotionId ? "promocao" : "mais_vendido"
      });
    }

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
          categoria_grupo: o.categoria_grupo,
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
        categoria_grupo: o.categoria_grupo,
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
        produtos_catalogo_processados: resolved.filter((r) => Boolean(r.product?.buy_box_winner)).length,
        candidatos_com_preco: candidates.length,
        em_promocao: candidates.filter((x) => x.discount > 0 || x.promotion_id).length,
        sem_preco: Math.max(0, resolved.length - itemMap.size),
        erros_resolucao: resolutionErrors.slice(0, 25),
        regra_fontes: "somente PRODUCT do catálogo oficial"
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