import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML = "https://api.mercadolibre.com";
const SITE_ID = "MLB";
const MAX = 20;

const getImageUrl = (...sources: any[]): string | null => {
  for (const source of sources) {
    if (typeof source === "string") {
      const value = source.trim();
      if (/^https?:\/\//i.test(value)) {
        return value.replace(/^http:\/\//i, "https://");
      }
      // Algumas respostas do catálogo entregam o identificador da foto em vez da URL.
      if (/^[\w-]{8,}$/.test(value) && /ML[A-Z]/i.test(value)) {
        return "https://http2.mlstatic.com/D_NQ_NP_" + value + "-O.webp";
      }
    }
    if (source && typeof source === "object") {
      const nested = [
        source.secure_url, source.url, source.thumbnail, source.thumbnail_url,
        source.picture, source.picture_url
      ].find((value: any) => typeof value === "string" && /^https?:\/\//i.test(value.trim()));
      if (nested) return String(nested).trim().replace(/^http:\/\//i, "https://");
      const pictureId = String(source.id || source.picture_id || "").trim();
      if (/^[\w-]{8,}$/.test(pictureId) && /ML[A-Z]/i.test(pictureId)) {
        return "https://http2.mlstatic.com/D_NQ_NP_" + pictureId + "-O.webp";
      }
    }
  }
  return null;
};

const REQUEST_TIMEOUT_MS = 8000;

// Categorias usadas somente como fonte de ranking "Mais vendidos".
// Não são termos de busca. A função tenta a primeira disponível e continua
// apenas se ainda não tiver conseguido 20 itens válidos.
const CATEGORY_EXCLUDE = new Set([
  "Imóveis",
  "Serviços",
  "Ingressos",
  "Indústria e Comércio",
  "Veículos",
  "Autos, Motos e Outros",
  "Mais Categorias"
]);

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

    // O token do afiliado pode receber 403 em recursos de catálogo.
    // Para catálogo público, usamos o token da própria aplicação (client credentials)
    // como segunda tentativa, sem trocar o token salvo da conta do usuário.
    let applicationAccessToken = "";

    async function getApplicationAccessToken() {
      if (applicationAccessToken) return applicationAccessToken;

      const clientId =
        Deno.env.get("MERCADOLIVRE_CLIENT_ID") ||
        Deno.env.get("MERCADOLIVRE_APP_ID") ||
        "";
      const clientSecret =
        Deno.env.get("MERCADOLIVRE_CLIENT_SECRET") ||
        Deno.env.get("MERCADOLIVRE_APP_SECRET") ||
        "";

      if (!clientId || !clientSecret) return "";

      const response = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret
        })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.access_token) {
        console.error("ML APPLICATION TOKEN ERROR:", response.status, data?.error || data?.message || "falha");
        return "";
      }

      applicationAccessToken = String(data.access_token);
      return applicationAccessToken;
    }

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


    let reauthenticationUrl: string | null = null;
    let authenticationIncident: any = null;

    async function createReauthenticationUrl() {
      if (reauthenticationUrl) return reauthenticationUrl;
      const clientId = Deno.env.get("MERCADOLIVRE_CLIENT_ID") || Deno.env.get("MERCADOLIVRE_APP_ID") || "";
      if (!clientId) return null;
      const redirectUri = `${supabaseUrl}/functions/v1/mercadolivre-oauth`;
      const bytes = new Uint8Array(48); crypto.getRandomValues(bytes);
      const state = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      const verifierBytes = new Uint8Array(48); crypto.getRandomValues(verifierBytes);
      const codeVerifier = Array.from(verifierBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
      let binary = ""; for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
      const codeChallenge = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const stateInsert = await db.from("oauth_states").insert({ user_id:userId, provider:"mercadolivre", state, code_verifier:codeVerifier, redirect_uri:redirectUri, expires_at:expiresAt });
      if (stateInsert.error) { console.error("ML REAUTH STATE ERROR:", stateInsert.error); return null; }
      const authUrl = new URL("https://auth.mercadolivre.com.br/authorization");
      authUrl.searchParams.set("response_type","code"); authUrl.searchParams.set("client_id",clientId); authUrl.searchParams.set("redirect_uri",redirectUri);
      authUrl.searchParams.set("state",state); authUrl.searchParams.set("code_challenge",codeChallenge); authUrl.searchParams.set("code_challenge_method","S256");
      reauthenticationUrl = authUrl.toString();
      await db.from("affiliate_accounts").update({ configuracao:{...cfg,reautenticacao_necessaria:true,reautenticacao_url:reauthenticationUrl,reautenticacao_em:new Date().toISOString()}, updated_at:new Date().toISOString() }).eq("id",account.id).eq("user_id",userId);
      return reauthenticationUrl;
    }

    async function ensureTokenFresh() {
      const obtainedAt = Date.parse(String(cfg.token_obtido_em || ""));
      const expiresIn = Number(cfg.expires_in || 0);
      const refreshMarginMs = 5 * 60 * 1000;
      if (Number.isFinite(obtainedAt) && expiresIn > 0 && Date.now() < obtainedAt + expiresIn * 1000 - refreshMarginMs) return true;
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        authenticationIncident = { tipo:"refresh_automatico", motivo:"token_expirado_ou_proximo_da_expiracao", em:new Date().toISOString() };
        return true;
      }
      authenticationIncident = { tipo:"refresh_falhou", motivo:"access_token_expirado_ou_invalido", em:new Date().toISOString() };
      await createReauthenticationUrl();
      return false;
    }

    const tokenReady = await ensureTokenFresh();
    if (!tokenReady) {
      return json({ ok:false, produtos_encontrados:0, novas:0, atualizadas:0, limite:limit, reautenticacao_necessaria:true, url_reautenticacao:reauthenticationUrl, incidente_autenticacao:authenticationIncident, error:"A autorização do Mercado Livre precisa ser renovada. Abra o link de reautorização para reconectar a conta." }, 401);
    }

    async function getJson(
      url: string,
      useAuth = false,
      customHeaders?: Record<string, string>
    ) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        let response = await fetch(url, {
          headers: customHeaders || (useAuth ? authHeaders : { Accept: "application/json" }),
          signal: controller.signal
        });

        if (useAuth && response.status === 401) {
          const refreshed = await refreshAccessToken();
          if (refreshed) {
            authenticationIncident = { tipo:"refresh_apos_401", motivo:"API_Mercado_Livre_recusou_o_access_token", em:new Date().toISOString() };
            response = await fetch(url, { headers:authHeaders, signal:controller.signal });
          } else {
            const reauth = await createReauthenticationUrl();
            authenticationIncident = { tipo:"401_reautorizacao", motivo:"API_Mercado_Livre_recusou_o_access_token_e_refresh_falhou", em:new Date().toISOString() };
            return { ok:false, status:401, data:null, error:"authorization value not present", code:"AUTH_REAUTH_REQUIRED", reauth_url:reauth };
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

    function normalizeText(value: unknown) {
      return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    }

    function titleSimilarity(a: unknown, b: unknown) {
      const aa = new Set(normalizeText(a).split(" ").filter((x) => x.length >= 3));
      const bb = new Set(normalizeText(b).split(" ").filter((x) => x.length >= 3));
      if (!aa.size || !bb.size) return 0;
      let common = 0;
      for (const token of aa) if (bb.has(token)) common++;
      return common / Math.max(aa.size, bb.size);
    }

    async function getCatalogJson(url: string) {
      // Catálogo é consultado primeiro sem autenticação do usuário.
      // Isso evita depender de escopos do token de afiliado para dados públicos.
      let result = await getJson(url, false);
      if (!result.ok && result.status !== 401 && result.status !== 403) return result;
      return await getJson(url, true);
    }

    async function resolveHighlightEntry(entry: any) {
      const id = String(entry?.id || "");
      const type = String(entry?.type || "");
      if (!id) return null;

      if (type === "ITEM") {
        const item = await getJson(
          ML + "/items/" + encodeURIComponent(id),
          true
        );

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
          message: item.error || "Publicação não disponível na API pública."
        };
      }

      if (type === "PRODUCT") {
        // PRODUCT é uma página de catálogo. O item público correto é,
        // preferencialmente, o buy_box_winner do próprio produto.
        const product = await getCatalogJson(
          ML + "/products/" + encodeURIComponent(id)
        );

        if (!product.ok || !product.data) {
          return {
            error: true,
            sourceId: id,
            sourceType: type,
            status: product.status,
            message: product.error || "Produto de catálogo não disponível."
          };
        }

        const data = product.data;

        // Alguns PRODUCTs do ranking existem no catálogo, mas não expõem
        // buy_box_winner no detalhe. Nesses casos, consultamos explicitamente
        // as publicações relacionadas ao produto antes de desistir.
        if (!data?.buy_box_winner) {
          const publicItems = await getCatalogJson(
            ML + "/products/" + encodeURIComponent(id) + "/items?limit=20"
          );

          const rows = Array.isArray(publicItems?.data?.results)
            ? publicItems.data.results
            : Array.isArray(publicItems?.data)
              ? publicItems.data
              : [];

          const validRows = rows.filter((row: any) => {
            const itemId = String(row?.id || row?.item_id || row?.itemId || "");
            const status = String(row?.status || "").toLowerCase();
            const price = Number(row?.price);
            return itemId.startsWith("MLB") &&
              (status === "" || status === "active") &&
              Number.isFinite(price) && price > 0;
          });

          if (validRows.length) {
            validRows.sort((a: any, b: any) =>
              Number(a?.price || 0) - Number(b?.price || 0)
            );
            const row = validRows[0];
            const publicItemId = String(row.id || row.item_id || row.itemId || "");
            return {
              itemId: publicItemId,
              sourceId: id,
              sourceType: type,
              product: data,
              publicItem: row,
              fromProductItems: true
            };
          }
        }

        const winner = data?.buy_box_winner;
        if (typeof winner?.item_id === "string" && winner.item_id.startsWith("MLB")) {
          return {
            itemId: String(winner.item_id),
            sourceId: id,
            sourceType: type,
            product: data,
            publicItem: winner,
            fromBuyBox: true
          };
        }

        // Alguns rankings apontam para um produto pai ou para uma página
        // sem vendedor vencedor. Nesses casos, o próprio catálogo informa
        // os produtos filhos específicos e compráveis.
        const relatedIds = new Set<string>();
        for (const childId of Array.isArray(data?.children_ids) ? data.children_ids : []) {
          if (typeof childId === "string" && childId.startsWith("MLB")) relatedIds.add(childId);
        }

        // Pickers também podem apontar diretamente para filhos específicos.
        for (const picker of Array.isArray(data?.pickers) ? data.pickers : []) {
          for (const p of Array.isArray(picker?.products) ? picker.products : []) {
            const childId = String(p?.product_id || "");
            if (childId.startsWith("MLB")) relatedIds.add(childId);
          }
        }

        const related = Array.from(relatedIds).slice(0, 20);
        if (related.length) {
          const childResults = await runWithConcurrency(
            related,
            async (childId) => {
              const child = await getCatalogJson(
                ML + "/products/" + encodeURIComponent(childId)
              );
              if (!child.ok || !child.data) return null;
              const childWinner = child.data?.buy_box_winner;
              if (
                typeof childWinner?.item_id === "string" &&
                childWinner.item_id.startsWith("MLB")
              ) {
                return {
                  itemId: String(childWinner.item_id),
                  sourceId: id,
                  sourceType: type,
                  product: child.data,
                  publicItem: childWinner,
                  fromBuyBox: true,
                  fromChildProduct: true
                };
              }
              return null;
            },
            4
          );

          const childMatch = childResults.find(Boolean);
          if (childMatch) return childMatch;
        }

        // Se o ranking trouxe um PRODUCT que não possui vencedor no detalhe,
        // procuramos novamente o produto pelo Product ID no buscador oficial.
        // Isso pode encontrar a versão ativa/específica do catálogo.
        const productName = String(data?.name || data?.family_name || "").trim();
        if (productName) {
          const productSearchUrl =
            ML + "/products/search?status=active&site_id=" + SITE_ID +
            "&q=" + encodeURIComponent(productName) + "&limit=20";

          const productSearch = await getCatalogJson(productSearchUrl);
          if (productSearch.ok && Array.isArray(productSearch.data?.results)) {
            const results = productSearch.data.results as any[];
            const exact = results.find((p: any) => String(p?.id || "") === id);
            const ordered = exact
              ? [exact, ...results.filter((p: any) => String(p?.id || "") !== id)]
              : results;

            for (const match of ordered.slice(0, 10)) {
              const matchId = String(match?.id || "");
              if (!matchId.startsWith("MLB")) continue;

              const detail = matchId === id
                ? { ok: true, data }
                : await getCatalogJson(ML + "/products/" + encodeURIComponent(matchId));

              const matchWinner = detail.data?.buy_box_winner;
              if (
                detail.ok &&
                typeof matchWinner?.item_id === "string" &&
                matchWinner.item_id.startsWith("MLB")
              ) {
                return {
                  itemId: String(matchWinner.item_id),
                  sourceId: id,
                  sourceType: type,
                  product: detail.data,
                  publicItem: matchWinner,
                  fromBuyBox: true,
                  fromProductSearch: true
                };
              }
            }
          }
        }

        // Último fallback: busca pública de anúncios pelo nome, aceitando
        // somente títulos realmente próximos do produto do ranking.
        if (productName) {
          const params = new URLSearchParams({
            q: productName,
            limit: "50",
            sort: "relevance"
          });

          const publicSearch = await getJson(
            ML + "/sites/" + SITE_ID + "/search?" + params.toString(),
            false
          );

          if (publicSearch.ok && Array.isArray(publicSearch.data?.results)) {
            const results = publicSearch.data.results as any[];
            const catalogMatches = results.filter(
              (item: any) =>
                item?.id &&
                String(item.id).startsWith("MLB") &&
                String(item?.catalog_product_id || "") === id
            );

            const titleMatches = results.filter((item: any) => {
              if (!item?.id || !String(item.id).startsWith("MLB")) return false;
              return titleSimilarity(productName, item.title) >= 0.88;
            });

            const candidates = [...catalogMatches, ...titleMatches.filter(
              (item: any) => !catalogMatches.some((m: any) => m.id === item.id)
            )];

            candidates.sort((a: any, b: any) => {
              const aPrice = Number(a?.price);
              const bPrice = Number(b?.price);
              const aValid = Number.isFinite(aPrice) && aPrice > 0 ? 0 : 1;
              const bValid = Number.isFinite(bPrice) && bPrice > 0 ? 0 : 1;
              if (aValid !== bValid) return aValid - bValid;
              return aPrice - bPrice;
            });

            const selected = candidates[0];
            if (selected?.id) {
              return {
                itemId: String(selected.id),
                sourceId: id,
                sourceType: type,
                product: data,
                publicItem: selected,
                fromPublicSearch: true
              };
            }
          }
        }

        return {
          error: true,
          sourceId: id,
          sourceType: type,
          status: 200,
          message: "Produto encontrado, mas não foi possível localizar uma publicação pública correspondente."
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
            message: up.error || "User Product não disponível."
          };
        }

        const directItemId =
          up.data?.item_id ||
          up.data?.itemId ||
          up.data?.item?.id ||
          up.data?.buy_box_winner?.item_id;

        if (typeof directItemId === "string" && directItemId.startsWith("MLB")) {
          return {
            itemId: String(directItemId),
            sourceId: id,
            sourceType: type,
            userProduct: up.data
          };
        }

        const sellerId = up.data?.user_id;
        if (sellerId) {
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

      while (queue.length && leaves.length < 16) {
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
        if (current.depth >= 5) continue;

        for (const child of children.slice(0, 16)) {
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

    // Descobre dinamicamente as categorias de primeiro nível do MLB.
    // Mantemos exclusões apenas para evitar imóveis, veículos e serviços.
    const rootCategories: Array<{ id: string; nome: string }> = [];
    const rootsResult = await getJson(
      ML + "/sites/" + SITE_ID + "/categories",
      false
    );

    if (rootsResult.ok && Array.isArray(rootsResult.data)) {
      for (const root of rootsResult.data) {
        const id = String(root?.id || "");
        const nome = String(root?.name || "").trim();
        if (id && nome && !CATEGORY_EXCLUDE.has(nome)) {
          rootCategories.push({ id, nome });
        }
      }
    }

    const roots = rootCategories.length
      ? rootCategories
      : [
          { id: "MLB1430", nome: "Calçados, Roupas e Bolsas" },
          { id: "MLB1574", nome: "Casa, Móveis e Decoração" },
          { id: "MLB5726", nome: "Eletrodomésticos" }
        ];

    const highlightCategories: any[] = [];
    for (const root of roots) {
      const leaves = await discoverLeafCategories(root);
      highlightCategories.push(...leaves);
    }

    // Alterna o ponto de início da varredura em janelas de 5 minutos.
    // Isso evita consultar sempre as mesmas primeiras categorias e ajuda a
    // descobrir ofertas novas sem perder a ordenação por ranking depois.
    const categoryRotation = highlightCategories.length
      ? Math.floor(Date.now() / (5 * 60 * 1000)) % highlightCategories.length
      : 0;
    const categoriesToScan = [
      ...highlightCategories.slice(categoryRotation),
      ...highlightCategories.slice(0, categoryRotation)
    ];

    // Coletamos rankings em ordem rotativa; a classificação final continua
    // priorizando posição no ranking, depois desconto/promoção.
    for (const category of categoriesToScan) {
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

      let entriesFromCategory = 0;
      for (const entry of content) {
        const entryType = String(entry?.type || "");

        // O ranking mistura ITEM, PRODUCT e USER_PRODUCT.
        // Para afiliados, usamos apenas PRODUCT com dados de catálogo.
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
        entriesFromCategory++;
        // Lemos todos os destaques disponíveis por categoria. A seleção final
        // continua limitada a 2 por categoria e 5 por grupo, então ampliar a
        // amostra ajuda a encontrar produtos realmente novos sem perder diversidade.
        if (entriesFromCategory >= 20) break;
      }

      // Não encerrar a coleta apenas porque os primeiros 120 destaques
      // vieram de produtos já cadastrados. Ampliamos a amostra para permitir
      // que o filtro de histórico encontre produtos realmente novos.
      // O limite de ofertas novas continua sendo controlado por "limit".
      if (highlightEntries.length >= 360) break;
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
    const { data: existingOffers, error: existingOffersError } = await db
      .from("offers")
      .select("id,product_external_id,titulo,dados_origem,nova,atualizada_em,created_at,imagem_url")
      .eq("user_id", userId)
      .eq("platform_id", platform.id);

    if (existingOffersError) throw existingOffersError;

    const existingByProductId = new Map(
      (existingOffers || []).map((item: any) => [String(item?.product_external_id || ""), item])
    );
    const existingProductIds = new Set(
      (existingOffers || [])
        .map((item: any) => String(item?.product_external_id || ""))
        .filter(Boolean)
    );
    const historyRows: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: batch, error: historyError } = await db
        .from("offer_product_history")
        .select("external_product_id,external_item_id,product_title")
        .eq("user_id", userId)
        .eq("provider", "mercadolivre")
        .range(offset, offset + 999);
      if (historyError) throw historyError;
      if (!batch?.length) break;
      historyRows.push(...batch);
      if (batch.length < 1000) break;
    }
    const historicalProductIds = new Set(historyRows.map((x: any) => String(x.external_product_id || "")));
    const historicalItemIds = new Set(historyRows.map((x: any) => String(x.external_item_id || "")).filter(Boolean));

    const existingItemIds = new Set(
      (existingOffers || [])
        .map((item: any) => String(item?.dados_origem?.item_id || ""))
        .filter((id: string) => id.startsWith("MLB"))
    );


    // Alterna a prioridade entre produtos ainda não vistos e cadastrados:
    // não deixa os primeiros 120 já conhecidos consumirem toda a resolução,
    // mas continua reservando parte da busca para atualizar preços existentes.
    const unseenHighlights = highlightEntries.filter((entry: any) => {
      const id = String(entry?.id || "");
      return id && !existingProductIds.has(id) && !historicalProductIds.has(id);
    });
    const knownHighlights = highlightEntries.filter((entry: any) => {
      const id = String(entry?.id || "");
      return id && (existingProductIds.has(id) || historicalProductIds.has(id));
    });
    const orderedHighlightEntries: any[] = [];
    let unseenIndex = 0;
    let knownIndex = 0;
    while (unseenIndex < unseenHighlights.length || knownIndex < knownHighlights.length) {
      for (let n = 0; n < 2 && unseenIndex < unseenHighlights.length; n++) {
        orderedHighlightEntries.push(unseenHighlights[unseenIndex++]);
      }
      if (knownIndex < knownHighlights.length) {
        orderedHighlightEntries.push(knownHighlights[knownIndex++]);
      }
      if (unseenIndex >= unseenHighlights.length && knownIndex >= knownHighlights.length) break;
    }

    const resolved: any[] = [];
    const targetResolved = Math.min(Math.max(limit * 12, 60), 150);
    const RESOLUTION_BATCH_SIZE = 10;

    for (
      let offset = 0;
      offset < orderedHighlightEntries.length && resolved.length < targetResolved;
      offset += RESOLUTION_BATCH_SIZE
    ) {
      const resolutionBatch = orderedHighlightEntries.slice(
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

    // Consultamos detalhes opcionais dos anúncios vencedores também para
    // produtos de catálogo. Se a API negar acesso, a oferta continua usando
    // os dados públicos de catálogo já resolvidos.
    const itemIds = Array.from(new Set(
      resolved.map((r) => String(r.itemId || "")).filter((id) => id.startsWith("MLB"))
    )).slice(0, MAX);

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
      // Há no máximo 20 IDs por rodada; completar todos os detalhes faltantes
      // evita que os produtos sem imagem fiquem presos indefinidamente.
      const missingItemIds = itemIds.filter((id) => !itemMap.has(id));
      if (missingItemIds.length) {
        const fallbackItems = await runWithConcurrency(
          missingItemIds,
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
    const detailedItemIds = itemIds.filter((id) => itemMap.has(id)).slice(0, 10);
    if (detailedItemIds.length) {
      const salePrices = await runWithConcurrency(
        detailedItemIds,
        async (id) => ({
          id,
          result: await getJson(
            ML + "/items/" + encodeURIComponent(id) + "/sale_price?context=channel_marketplace",
            true
          )
        }),
        5
      );
      for (const entry of salePrices) {
        if (entry.result?.ok && entry.result?.data) salePriceMap.set(entry.id, entry.result.data);
      }
    }

    // Nome do vendedor só é usado quando a API fornece uma identificação
    // verificável. Falhas nessa consulta não interrompem a busca.
    const sellerIds = Array.from(new Set(
      itemIds.map((id) => {
        const item = itemMap.get(id);
        return String(item?.seller?.id || item?.seller_id || "");
      }).filter((id) => /^\d+$/.test(id))
    )).slice(0, 10);
    const sellerMap = new Map<string, string>();
    const sellerResults = await runWithConcurrency(
      sellerIds,
      async (sellerId) => {
        let result = await getJson(ML + "/users/" + encodeURIComponent(sellerId), false);
        if (!result.ok) result = await getJson(ML + "/users/" + encodeURIComponent(sellerId), true);
        const nickname = String(result.data?.nickname || result.data?.first_name || "").trim();
        return { sellerId, nickname: result.ok ? nickname : "" };
      },
      5
    );
    for (const seller of sellerResults) {
      if (seller.nickname) sellerMap.set(seller.sellerId, seller.nickname);
    }

    const candidates: any[] = [];

    for (const r of resolved) {
      // PRODUCT sem Buy Box: usa a publicação encontrada pela busca pública.
      // O preço/permalink vêm da própria resposta pública; não fazemos
      // /items/{id} em publicação de terceiro.
      if (r.publicItem && !r.product?.buy_box_winner) {
        const item = r.publicItem;
        const current = Number(item.price);
        if (!Number.isFinite(current) || current <= 0) continue;

        const originalNumber = Number(item.original_price);
        const original = Number.isFinite(originalNumber) && originalNumber > current
          ? originalNumber
          : null;
        const discount = original
          ? Math.round(((original - current) / original) * 100)
          : 0;
        const promotionId =
          (Array.isArray(item?.deal_ids) && item.deal_ids.length)
            ? String(item.deal_ids[0])
            : null;

        if (somenteDescontos && discount <= 0 && !promotionId) continue;

        const freeShipping = item?.shipping?.free_shipping === true ||
          item?.shipping?.tags?.includes("mandatory_free_shipping");
        const position = Number(r.highlight?.position) || 999;
        const productId = String(r.sourceId);

        candidates.push({
          external_id: String(item.id || item.item_id || item.itemId || ""),
          product_external_id: productId,
          title: item.title || r.product?.name || "Produto Mercado Livre",
          current,
          original,
          discount,
          image: getImageUrl(item.thumbnail, item.thumbnail_url, item.pictures?.[0], item.picture_id),
          permalink: item.permalink || null,
          promotion_id: promotionId,
          promotion_type: item.listing_type_id || null,
          free_shipping: freeShipping,
          position,
          categoria_id: r.highlight?.categoria_id || item.category_id || r.product?.category_id || null,
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

      // PRODUCT: usa diretamente os dados do catálogo e do buy_box_winner.
      // Não faz /items nem /sale_price, evitando 403 em publicações de terceiros.
      if (r.product?.buy_box_winner) {
        const product = r.product;
        const winner = product.buy_box_winner;
        const externalItemId = String(winner.item_id || winner.id || r.itemId || product.id);
        const itemDetails = itemMap.get(externalItemId) || {};
        const salePrice = salePriceMap.get(externalItemId) || {};
        const priceCandidates = [salePrice.amount, itemDetails.price, winner.price]
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0);
        const current = priceCandidates[0] || 0;
        if (!Number.isFinite(current) || current <= 0) continue;

        const originalCandidates = [
          salePrice.regular_amount,
          itemDetails.original_price,
          itemDetails.base_price,
          winner.original_price
        ];
        const originalNumber = originalCandidates.map((value) => Number(value))
          .find((value) => Number.isFinite(value) && value > current);
        const original = originalNumber || null;
        const discount = original ? Math.round(((original - current) / original) * 100) : 0;
        const promotionId = Array.isArray(itemDetails.deal_ids) && itemDetails.deal_ids.length
          ? String(itemDetails.deal_ids[0])
          : (Array.isArray(winner.deal_ids) && winner.deal_ids.length ? String(winner.deal_ids[0]) : null);
        const freeShipping =
          itemDetails?.shipping?.free_shipping === true ||
          itemDetails?.shipping?.tags?.includes("mandatory_free_shipping") ||
          winner?.shipping?.free_shipping === true ||
          winner?.shipping?.tags?.includes("mandatory_free_shipping");
        const sellerId = String(itemDetails?.seller?.id || itemDetails?.seller_id || "");
        const sellerName = String(
          itemDetails?.seller?.nickname ||
          (sellerId ? sellerMap.get(sellerId) : "") ||
          ""
        ).trim();
        const couponCode = String(
          itemDetails?.coupon_code ||
          itemDetails?.coupon?.code ||
          salePrice?.metadata?.coupon_code ||
          ""
        ).trim();
        const paymentMethod = String(
          itemDetails?.payment_method ||
          salePrice?.metadata?.payment_method ||
          ""
        ).trim();
        const position = Number(r.highlight?.position) || 999;

        if (somenteDescontos && discount <= 0 && !promotionId) continue;

        candidates.push({
          external_id: externalItemId,
          product_external_id: String(product.id),
          title: itemDetails.title || product.name || product.family_name || r.highlight?.categoria_nome || "Produto Mercado Livre",
          current,
          original,
          discount,
          image: getImageUrl(
            itemDetails.thumbnail, itemDetails.thumbnail_url, itemDetails.pictures?.[0], itemDetails.picture_id,
            r.publicItem?.thumbnail, r.publicItem?.thumbnail_url, r.publicItem?.pictures?.[0], r.publicItem?.picture_id,
            winner.thumbnail, winner.thumbnail_url, winner.pictures?.[0], winner.picture_id,
            product.thumbnail, product.thumbnail_url, product.pictures?.[0], product.picture_id
          ),
          permalink: itemDetails.permalink || winner.permalink || product.permalink || null,
          seller_id: sellerId || null,
          seller_name: sellerName || null,
          coupon_code: couponCode || null,
          payment_method: paymentMethod || null,
          promotion_id: promotionId,
          promotion_type: salePrice?.metadata?.promotion_type || (promotionId ? "deal" : (winner.listing_type_id || null)),
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
        external_id: String(item.id || item.item_id || item.itemId || ""),
        product_external_id: String(item.catalog_product_id || item.user_product_id || item.id || item.item_id || item.itemId || ""),
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

    // Alguns produtos de catálogo não expõem imagem no detalhe do produto nem
    // no buy_box_winner. Recuperamos a imagem por busca pública, aceitando apenas
    // o mesmo item/catálogo ou um título muito próximo com preço compatível.
    let imagensEnriquecidas = 0;
    const existingForImageSearch = new Map(
      (existingOffers || []).map((item: any) => [
        String(item.product_external_id || ""),
        item
      ])
    );
    const imageSearchCandidates = candidates
      .filter((item: any) => !String(item.image || "").trim() && String(item.title || "").trim())
      .sort((a: any, b: any) => {
        const aExisting: any = existingForImageSearch.get(String(a.product_external_id || ""));
        const bExisting: any = existingForImageSearch.get(String(b.product_external_id || ""));
        if (Boolean(aExisting) !== Boolean(bExisting)) return aExisting ? -1 : 1;
        if (aExisting && bExisting) {
          const aTime = Date.parse(String(aExisting.atualizada_em || aExisting.created_at || "")) || 0;
          const bTime = Date.parse(String(bExisting.atualizada_em || bExisting.created_at || "")) || 0;
          if (aTime !== bTime) return aTime - bTime;
        }
        return a.position - b.position || b.discount - a.discount || a.current - b.current;
      })
      .slice(0, Math.min(limit, 20));
    const imageLookupDiagnostics: any[] = [];
    const imageSearchResults = await runWithConcurrency(
      imageSearchCandidates,
      async (candidate: any) => {
        const diagnostic: Record<string, unknown> = {
          product_id: String(candidate.product_external_id || ""),
          item_id: String(candidate.external_id || ""),
          direct_item_status: null,
          product_status: null,
          search_status: null,
          matched_by: null
        };
        let imageItem: any = null;

        // Prioriza o anúncio exato, sem depender de uma busca textual.
        const itemId = String(candidate.external_id || "");
        if (itemId.startsWith("MLB")) {
          let direct = await getJson(ML + "/items/" + encodeURIComponent(itemId), false);
          diagnostic.direct_item_status = direct.status;
          if (!direct.ok && (direct.status === 401 || direct.status === 403)) {
            direct = await getJson(ML + "/items/" + encodeURIComponent(itemId), true);
            diagnostic.direct_item_status = direct.status;
          }
          if (direct.ok && direct.data?.id) {
            const directImage = getImageUrl(
              direct.data.thumbnail, direct.data.thumbnail_url, direct.data.pictures?.[0],
              direct.data.picture_id, direct.data.secure_thumbnail
            );
            if (directImage) {
              imageItem = direct.data;
              diagnostic.matched_by = "item_id_exato";
            }
          }
        }

        // Segunda tentativa: consulta novamente o produto exato do catálogo.
        if (!imageItem) {
          const productId = String(candidate.product_external_id || "");
          if (productId.startsWith("MLB")) {
            const productResult = await getCatalogJson(ML + "/products/" + encodeURIComponent(productId));
            diagnostic.product_status = productResult.status;
            if (productResult.ok && productResult.data) {
              const product = productResult.data;
              const productImage = getImageUrl(
                product.thumbnail, product.thumbnail_url, product.main_picture,
                product.pictures?.[0], product.picture_id
              );
              if (productImage) {
                imageItem = {
                  thumbnail: productImage,
                  permalink: product.permalink,
                  title: product.name || product.family_name
                };
                diagnostic.matched_by = "produto_catalogo_exato";
              }
            }
          }
        }

        // Última tentativa: busca textual com correspondência exata ou forte.
        if (!imageItem) {
          const params = new URLSearchParams({
            q: String(candidate.title),
            limit: "50",
            sort: "relevance"
          });
          const result = await getJson(
            ML + "/sites/" + SITE_ID + "/search?" + params.toString(),
            false
          );
          diagnostic.search_status = result.status;
          if (result.ok && Array.isArray(result.data?.results)) {
            const rows = result.data.results as any[];
            const exact = rows.find((row: any) =>
              String(row?.id || "") === itemId ||
              String(row?.catalog_product_id || "") === String(candidate.product_external_id || "")
            );
            const close = exact || rows.find((row: any) => {
              const price = Number(row?.price || 0);
              return row?.id &&
                titleSimilarity(candidate.title, row.title) >= 0.82 &&
                price > 0 &&
                Number(candidate.current) > 0 &&
                Math.abs(price - Number(candidate.current)) / Number(candidate.current) <= 0.05;
            });
            if (close && getImageUrl(close.thumbnail, close.thumbnail_url, close.pictures?.[0], close.picture_id)) {
              imageItem = close;
              diagnostic.matched_by = exact ? "busca_id_exato" : "busca_titulo_preco";
            }
          }
        }

        const image = imageItem
          ? getImageUrl(
              imageItem.thumbnail, imageItem.thumbnail_url, imageItem.pictures?.[0],
              imageItem.picture_id, imageItem.secure_thumbnail
            )
          : null;
        diagnostic.image_found = Boolean(image);
        imageLookupDiagnostics.push(diagnostic);
        return { candidate, item: imageItem, image };
      },
      5
    );
    for (const entry of imageSearchResults) {
      if (!entry.image) continue;
      entry.candidate.image = entry.image;
      entry.candidate.permalink = entry.item?.permalink || entry.candidate.permalink;
      if (entry.item?.seller?.id) entry.candidate.seller_id = String(entry.item.seller.id);
      if (entry.item?.seller?.nickname) entry.candidate.seller_name = String(entry.item.seller.nickname);
      if (entry.item?.title && titleSimilarity(entry.candidate.title, entry.item.title) >= 0.92) {
        entry.candidate.title = String(entry.item.title);
      }
      imagensEnriquecidas++;
    }

    // Prioridade: posição no ranking de mais vendidos, depois promoção/desconto.
    // Comissão não está disponível de forma confiável neste endpoint; não inventamos valores.
    candidates.sort(
      (a, b) =>
        a.position - b.position ||
        b.discount - a.discount ||
        Number(Boolean(b.promotion_id)) - Number(Boolean(a.promotion_id)) ||
        Number(Boolean(b.free_shipping)) - Number(Boolean(a.free_shipping)) ||
        // Em caso de empate, prefere preços mais acessíveis sem sobrepor
        // a prioridade principal de vendas e descontos.
        a.current - b.current ||
        b.score - a.score
    );

    // Identidade exata é a regra principal. Título parecido não é suficiente:
    // anúncios diferentes podem ter nomes muito semelhantes no Mercado Livre.
    const unique: any[] = [];
    const seenProducts = new Set<string>();
    const seenItems = new Set<string>();
    const categoryCounts = new Map<string, number>();
    const groupCounts = new Map<string, number>();
    const MAX_PER_CATEGORY = 2;
    const MAX_PER_CATEGORY_GROUP = 5;
    const normalizeTitleKey = (value: unknown) => String(value || "").trim().toLowerCase();
    const existingTitleKeys = new Set(
      (existingOffers || [])
        .map((item: any) => normalizeTitleKey(item?.titulo))
        .filter(Boolean)
    );
    const seenTitleKeys = new Set<string>();
    let duplicadosIgnorados = 0;
    let titulosDuplicadosIgnorados = 0;
    let existentesIgnorados = 0;

    for (const item of candidates) {
      const productId = String(item.product_external_id || "");
      const itemId = String(item.external_id || "");

      if (!productId && !itemId) continue;
      if (productId && seenProducts.has(productId)) {
        duplicadosIgnorados++;
        continue;
      }
      if (itemId && seenItems.has(itemId)) {
        duplicadosIgnorados++;
        continue;
      }

      // O banco também exige título único por usuário/plataforma.
      // Ignoramos previamente o título repetido para uma oferta não abortar
      // toda a busca com erro PostgreSQL 23505.
      const titleKey = normalizeTitleKey(item.title);
      if (titleKey && (existingTitleKeys.has(titleKey) || seenTitleKeys.has(titleKey))) {
        titulosDuplicadosIgnorados++;
        existentesIgnorados++;
        continue;
      }

      // Não deixa uma oferta já cadastrada ocupar uma das vagas de novidades.
      // Assim a função continua percorrendo o ranking para encontrar produtos novos.
      if (
        (productId && (existingProductIds.has(productId) || historicalProductIds.has(productId))) ||
        (itemId && (existingItemIds.has(itemId) || historicalItemIds.has(itemId)))
      ) {
        existentesIgnorados++;
        continue;
      }

      // Diversidade: no máximo 2 produtos por categoria específica e 5
      // por grupo principal. Se uma categoria estiver saturada, seguimos
      // percorrendo o ranking para encontrar outras categorias populares.
      const categoryKey = String(item.categoria_id || item.categoria_nome || "sem_categoria");
      const groupKey = String(item.categoria_grupo || "sem_grupo");
      if ((categoryCounts.get(categoryKey) || 0) >= MAX_PER_CATEGORY) continue;
      if ((groupCounts.get(groupKey) || 0) >= MAX_PER_CATEGORY_GROUP) continue;

      if (productId) seenProducts.add(productId);
      if (itemId) seenItems.add(itemId);
      if (titleKey) seenTitleKeys.add(titleKey);
      categoryCounts.set(categoryKey, (categoryCounts.get(categoryKey) || 0) + 1);
      groupCounts.set(groupKey, (groupCounts.get(groupKey) || 0) + 1);
      unique.push(item);

      if (unique.length >= limit) break;
    }

    const { error: moveOldNewError } = await db
      .from("offers")
      .update({ nova: false })
      .eq("user_id", userId)
      .eq("platform_id", platform.id)
      .eq("nova", true);
    if (moveOldNewError) throw moveOldNewError;

    let atualizadas = 0;
    // No máximo 'limit' operações de oferta por busca: primeiro as novidades,
    // depois atualizações das já cadastradas com as vagas restantes.
    const limiteAtualizacoes = Math.max(0, limit - unique.length);
    const existingByProduct = new Map((existingOffers || []).map((x: any) => [String(x.product_external_id || ""), x]));
    const existingByItem = new Map((existingOffers || []).map((x: any) => [String(x?.dados_origem?.item_id || ""), x]).filter(([k]: any[]) => Boolean(k)));
    const matchedExisting = new Set<string>();
    const existingTitleOwners = new Map(
      (existingOffers || []).map((x: any) => [String(x?.titulo || "").trim().toLowerCase(), String(x.id)])
    );
    const updateCandidates = candidates.map((offer: any) => {
      const pid = String(offer.product_external_id || "");
      const iid = String(offer.external_id || "");
      const existing: any = existingByProduct.get(pid) || existingByItem.get(iid);
      return { offer, existing };
    }).filter((entry: any) => entry.existing).sort((a: any, b: any) => {
      const aTime = Date.parse(String(a.existing.atualizada_em || a.existing.created_at || "")) || 0;
      const bTime = Date.parse(String(b.existing.atualizada_em || b.existing.created_at || "")) || 0;
      return aTime - bTime;
    });

    for (const entry of updateCandidates) {
      if (atualizadas >= limiteAtualizacoes) break;
      const o = entry.offer;
      const existing: any = entry.existing;
      if (matchedExisting.has(String(existing.id))) continue;
      const now = new Date().toISOString();
      const canonicalProductUrl = String(o.permalink || "").trim() ||
        (String(o.product_external_id || "").startsWith("MLB") ? `https://www.mercadolivre.com.br/p/${o.product_external_id}` : "");
      const candidateTitleKey = String(o.title || "").trim().toLowerCase();
      const titleOwner = existingTitleOwners.get(candidateTitleKey);
      const safeTitle = titleOwner && titleOwner !== String(existing.id) ? existing.titulo : o.title;
      const originPatch: Record<string, unknown> = {
        ...(existing.dados_origem || {}),
        fonte: "mercadolivre-highlights",
        categoria_id: o.categoria_id,
        categoria_nome: o.categoria_nome,
        categoria_grupo: o.categoria_grupo,
        posicao_ranking: o.position,
        item_id: o.external_id
      };
      const previousSellerId = String(existing.dados_origem?.seller_id || "");
      if (o.seller_id) {
        if (previousSellerId && previousSellerId !== String(o.seller_id) && !o.seller_name) {
          delete originPatch.seller_name;
        }
        originPatch.seller_id = o.seller_id;
      }
      if (o.seller_name) originPatch.seller_name = o.seller_name;
      if (o.payment_method) {
        originPatch.payment_method = o.payment_method;
        originPatch.payment_method_verified_at = now;
      } else {
        // Não mantém uma condição Pix antiga como se ainda estivesse confirmada.
        delete originPatch.payment_method;
        delete originPatch.payment_methods;
        delete originPatch.payment_method_verified_at;
      }
      if (o.coupon_code) originPatch.coupon_code = o.coupon_code;
      const updatePayload: Record<string, unknown> = {
        titulo: safeTitle,
        url_produto: canonicalProductUrl,
        store_provider: "mercadolivre",
        store_product_url: canonicalProductUrl,
        preco_atual: o.current,
        preco_anterior: o.original,
        desconto_percentual: o.discount,
        moeda: "BRL",
        disponibilidade: true,
        imagem_url: o.image || String((existingByProductId.get(String(o.product_external_id || "")) as any)?.imagem_url || "").trim() || null,
        dados_origem: originPatch,
        promocao_id_externo: o.promotion_id,
        oferta_tipo: o.oferta_tipo,
        melhor_preco: o.discount > 0 || Boolean(o.promotion_id),
        score_oferta: o.score,
        atualizada_em: now,
        coletada_em: now,
        nova: false
      };
      if (o.coupon_code) updatePayload.cupom_codigo = o.coupon_code;
      const { error: updateError } = await db.from("offers").update(updatePayload)
        .eq("id", existing.id).eq("user_id", userId);
      if (updateError) throw updateError;
      matchedExisting.add(String(existing.id));
      atualizadas++;
    }

    const historyPayload = candidates
      .filter((o: any) => String(o.product_external_id || "").trim())
      .map((o: any) => ({
        user_id: userId,
        provider: "mercadolivre",
        external_product_id: String(o.product_external_id),
        external_item_id: String(o.external_id || ""),
        product_title: String(o.title || ""),
        last_seen_at: new Date().toISOString(),
        metadata: { source: "mercadolivre-highlights", promotion_id: o.promotion_id || null }
      }));
    let novas = 0;
    const ofertas: any[] = [];

    for (const o of unique) {
      const canonicalItemId = String(o.external_id || "");
      const canonicalProductId = String(o.product_external_id || "");
      if (!canonicalItemId.startsWith("MLB") && !canonicalProductId.startsWith("MLB")) continue;

      const now = new Date().toISOString();

      const canonicalProductUrl = String(o.permalink || "").trim() ||
        (canonicalProductId.startsWith("MLB")
          ? `https://www.mercadolivre.com.br/p/${canonicalProductId}`
          : "");

      const values: any = {
        user_id: userId,
        platform_id: platform.id,
        product_id: null,
        product_external_id: o.product_external_id,
        titulo: o.title,
        url_produto: canonicalProductUrl,
        store_provider: "mercadolivre",
        store_product_url: canonicalProductUrl,
        preco_atual: o.current,
        preco_anterior: o.original,
        desconto_percentual: o.discount,
        moeda: "BRL",
        disponibilidade: true,
        classificacao: o.discount >= 10 ? "interessante" : "verificar",
        permitido_afiliado: false,
        permitido_divulgacao: false,
        imagem_url: o.image || String((existingByProductId.get(String(o.product_external_id || "")) as any)?.imagem_url || "").trim() || null,
        dados_origem: {
          fonte: "mercadolivre-highlights",
          categoria_id: o.categoria_id,
          categoria_nome: o.categoria_nome,
          categoria_grupo: o.categoria_grupo,
          posicao_ranking: o.position,
          item_id: o.external_id,
          ...(o.seller_id ? { seller_id: o.seller_id } : {}),
          ...(o.seller_name ? { seller_name: o.seller_name } : {}),
          ...(o.payment_method ? { payment_method: o.payment_method, payment_method_verified_at: now } : {}),
          ...(o.coupon_code ? { coupon_code: o.coupon_code } : {})
        },
        ...(o.coupon_code ? { cupom_codigo: o.coupon_code } : {}),
        promocao_id_externo: o.promotion_id,
        oferta_tipo: o.oferta_tipo,
        melhor_preco: o.discount > 0 || Boolean(o.promotion_id),
        score_oferta: o.score,
        atualizada_em: now,
        coletada_em: now,
        nova: false
      };

      const { data: inserted, error } = await db
        .from("offers")
        .insert({ ...values, encontrada_em: now, nova: true })
        .select("id")
        .single();
      if (error) throw error;
      const offerId = inserted.id;
      novas++;

      ofertas.push({
        id: offerId,
        external_id: o.external_id,
        product_external_id: o.product_external_id,
        title: o.title,
        current: o.current,
        original: o.original,
        discount: o.discount,
        image: o.image,
        permalink: canonicalProductUrl,
        promotion_id: o.promotion_id,
        promotion_type: o.promotion_type,
        position: o.position,
        categoria_nome: o.categoria_nome,
        categoria_grupo: o.categoria_grupo,
        score: o.score,
        oferta_tipo: o.oferta_tipo
      });
    }

    for (let i = 0; i < historyPayload.length; i += 500) {
      const { error: historyWriteError } = await db
        .from("offer_product_history")
        .upsert(historyPayload.slice(i, i + 500), { onConflict: "user_id,provider,external_product_id" });
      if (historyWriteError) throw historyWriteError;
    }

    return json({
      ok: true,
      // Total realmente processado nesta rodada (novas + atualizadas), limitado a 20.
      // A quantidade bruta varrida continua disponível em diagnostico.candidatos_com_preco.
      produtos_encontrados: novas + atualizadas,
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
        imagens_enriquecidas: imagensEnriquecidas,
        busca_imagem_consultados: imageLookupDiagnostics.length,
        busca_imagem_com_correspondencia: imageLookupDiagnostics.filter((x: any) => Boolean(x.matched_by)).length,
        busca_imagem_com_imagem: imageLookupDiagnostics.filter((x: any) => Boolean(x.image_found)).length,
        busca_imagem_diagnostico: imageLookupDiagnostics.slice(0, 20),
        produtos_catalogo_processados: resolved.filter((r) => Boolean(r.product?.buy_box_winner)).length,
        candidatos_com_preco: candidates.length,
        duplicados_ignorados: duplicadosIgnorados,
        titulos_duplicados_ignorados: titulosDuplicadosIgnorados,
        existentes_ignorados: existentesIgnorados,
        em_promocao: candidates.filter((x) => x.discount > 0 || x.promotion_id).length,
        sem_preco: Math.max(0, resolved.length - candidates.length),
        erros_resolucao: resolutionErrors.slice(0, 25),
        incidente_autenticacao: authenticationIncident,
        reautenticacao_necessaria: Boolean(reauthenticationUrl),
        url_reautenticacao: reauthenticationUrl,
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