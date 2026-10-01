import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML = "https://api.mercadolibre.com";
const NICHES = [
  "tecnologia e eletrônicos",
  "casa e decoração",
  "beleza e cuidados pessoais",
  "moda e acessórios",
  "eletrodomésticos",
  "ferramentas e construção",
  "esporte e lazer",
  "bebê e infantil",
  "pet shop",
  "automotivo",
];
const MAX_PRODUCTS = 20;
const PRODUCTS_PER_NICHE = 2;
const REQUEST_TIMEOUT_MS = 12000;

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

    const limit = Math.min(Math.max(Number(body?.limit) || MAX_PRODUCTS, 1), MAX_PRODUCTS);
    const somenteDescontos = body?.somente_descontos !== false;

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

    const authHeaders = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

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
          error: typeof data?.message === "string" ? data.message : typeof data?.error === "string" ? data.error : raw.slice(0, 300),
        };
      } catch (e) {
        return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : "Falha de rede." };
      } finally {
        clearTimeout(timer);
      }
    }

    function getPromotionPrice(prices: any) {
      const list = Array.isArray(prices?.prices) ? prices.prices : [];
      const active = list.filter((p: any) => {
        if (p?.type !== "promotion") return false;
        const c = p?.conditions || {};
        const now = Date.now();
        const start = c.start_time ? Date.parse(c.start_time) : null;
        const end = c.end_time ? Date.parse(c.end_time) : null;
        return (!start || Number.isNaN(start) || now >= start) && (!end || Number.isNaN(end) || now <= end);
      });
      return active
        .filter((p: any) => Number(p?.amount) > 0 && Number(p?.regular_amount) > Number(p.amount))
        .sort((a: any, b: any) => Number(b.regular_amount) - Number(b.amount) - (Number(a.regular_amount) - Number(a.amount)))[0] || null;
    }

    function buildOffer(item: any, priceInfo: any, niche: string) {
      const current = Number(priceInfo?.amount);
      const original = Number(priceInfo?.regular_amount);
      if (!item?.id || !Number.isFinite(current) || current <= 0 || !Number.isFinite(original) || original <= current) return null;
      const discount = Math.round(((original - current) / original) * 100);
      if (discount <= 0) return null;
      const sold = Number(item?.sold_quantity) || 0;
      const freeShipping = item?.shipping?.free_shipping === true;
      const score = discount * 10 + Math.min(sold, 100000) / 100 + (freeShipping ? 5 : 0);
      return {
        external_id: String(item.id),
        product_external_id: String(item.catalog_product_id || item.user_product_id || item.id),
        title: item.title || "Produto Mercado Livre",
        current,
        original,
        discount,
        sold,
        image: item.thumbnail || item.pictures?.[0]?.secure_url || item.pictures?.[0]?.url || null,
        permalink: item.permalink || null,
        seller_id: item.seller_id || null,
        free_shipping: freeShipping,
        score,
        niche,
      };
    }

    const candidates: any[] = [];
    const diagnostics: any[] = [];
    const seenProducts = new Set<string>();
    let analyzed = 0;

    for (const niche of NICHES) {
      if (analyzed >= limit) break;

      const searchLimit = Math.min(PRODUCTS_PER_NICHE, limit - analyzed);
      const searchUrl = `${ML}/products/search?status=active&site_id=MLB&limit=${searchLimit}&q=${encodeURIComponent(niche)}`;
      const search = await getJson(searchUrl);
      const products = Array.isArray(search.data?.results) ? search.data.results : [];
      const diagnostic: any = {
        nicho: niche,
        busca_http: search.status || "—",
        resultados: products.length,
        candidatos: 0,
        rejeitados: 0,
        itens_consultados: 0,
        promocoes_encontradas: 0,
        motivos_rejeicao: {},
      };

      if (!search.ok) {
        diagnostic.erro = search.error || "erro de busca";
        diagnostics.push(diagnostic);
        continue;
      }

      for (const product of products) {
        if (analyzed >= limit) break;
        if (!product?.id || seenProducts.has(String(product.id))) continue;
        seenProducts.add(String(product.id));
        analyzed++;

        const itemsRes = await getJson(`${ML}/products/${encodeURIComponent(String(product.id))}/items?limit=5`);
        const items = Array.isArray(itemsRes.data?.results) ? itemsRes.data.results : Array.isArray(itemsRes.data?.items) ? itemsRes.data.items : [];

        if (!itemsRes.ok || !items.length) {
          diagnostic.rejeitados++;
          diagnostic.motivos_rejeicao.SEM_ANUNCIO = (diagnostic.motivos_rejeicao.SEM_ANUNCIO || 0) + 1;
          continue;
        }

        let best: any = null;
        for (const itemRef of items) {
          const itemId = itemRef?.item_id || itemRef?.id;
          if (!itemId) continue;
          diagnostic.itens_consultados++;

          const itemRes = itemRef?.sold_quantity !== undefined && itemRef?.permalink ? { ok: true, status: 200, data: itemRef } : await getJson(`${ML}/items/${encodeURIComponent(String(itemId))}`);
          if (!itemRes.ok || !itemRes.data) continue;

          const pricesRes = await getJson(`${ML}/items/${encodeURIComponent(String(itemId))}/prices`);
          if (!pricesRes.ok) {
            diagnostic.motivos_rejeicao.ERRO_PRECO = (diagnostic.motivos_rejeicao.ERRO_PRECO || 0) + 1;
            continue;
          }

          const promoPrice = getPromotionPrice(pricesRes.data);
          if (!promoPrice) {
            diagnostic.motivos_rejeicao.SEM_PROMOCAO = (diagnostic.motivos_rejeicao.SEM_PROMOCAO || 0) + 1;
            continue;
          }
          diagnostic.promocoes_encontradas++;

          const offer = buildOffer(itemRes.data, promoPrice, niche);
          if (!offer) {
            diagnostic.motivos_rejeicao.DESCONTO_INVALIDO = (diagnostic.motivos_rejeicao.DESCONTO_INVALIDO || 0) + 1;
            continue;
          }
          if (!best || offer.score > best.score) best = offer;
        }

        if (best) {
          candidates.push(best);
          diagnostic.candidatos++;
        } else {
          diagnostic.rejeitados++;
        }
      }

      diagnostics.push(diagnostic);
    }

    candidates.sort((a, b) => b.score - a.score || b.sold - a.sold || b.discount - a.discount || a.current - b.current);
    const unique: any[] = [];
    const seenItems = new Set<string>();
    for (const offer of candidates) {
      if (seenItems.has(offer.external_id)) continue;
      seenItems.add(offer.external_id);
      unique.push(offer);
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
          fonte: "mercadolivre-catalog-items-prices",
          nicho: o.niche,
          item_id: o.external_id,
          seller_id: o.seller_id,
          sold_quantity: o.sold,
          free_shipping: o.free_shipping,
        },
        promocao_id_externo: null,
        oferta_tipo: "oferta",
        melhor_preco: true,
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
        const { data: inserted, error } = await db.from("offers").insert({ ...values, encontrada_em: now }).select("id").single();
        if (error) throw error;
        offerId = inserted.id;
        novas++;
      }

      ofertas.push({
        id: offerId,
        external_id: o.external_id,
        title: o.title,
        current: o.current,
        original: o.original,
        discount: o.discount,
        sold_quantity: o.sold,
        image: o.image,
        permalink: o.permalink,
        free_shipping: o.free_shipping,
        score: o.score,
        niche: o.niche,
      });
    }

    return json({
      ok: true,
      produtos_analisados: analyzed,
      produtos_encontrados: ofertas.length,
      novas,
      atualizadas,
      limite: limit,
      criterio: "até 20 produtos: nichos + vendas + promoção real",
      ofertas,
      diagnostico: diagnostics,
    });
  } catch (e) {
    console.error("PROCESS-OFFERS ERRO:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Erro interno." }, 500);
  }
});