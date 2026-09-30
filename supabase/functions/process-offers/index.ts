import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML = "https://api.mercadolibre.com";
const TERMS = [
  "smartwatch",
  "celular",
  "notebook",
  "iphone",
  "air fryer",
  "smart tv",
  "fone bluetooth",
  "caixa de som"
];
const MAX = 30;

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

    const authHeaders = {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json"
    };

    const candidates: any[] = [];
    const seen = new Set<string>();
    const diagnostics: any[] = [];

    // CORREÇÃO: usar o buscador oficial de produtos. /sites/MLB/search retorna 403 para este token.
    for (const term of TERMS) {
      if (candidates.length >= limit * 2) break;
      const url = ML + "/products/search?status=active&site_id=MLB&limit=10&q=" + encodeURIComponent(term);
      const r = await fetch(url, { headers: authHeaders });
      const rawText = await r.text();
      diagnostics.push({ source: "products/search", term, status: r.status });
      if (!r.ok) continue;
      let s: any; try { s = JSON.parse(rawText); } catch { continue; }
      const results = Array.isArray(s?.results) ? s.results : [];
      for (const p of results) {
        if (!p?.id || seen.has(String(p.id))) continue;
        seen.add(String(p.id));
        let detail: any = p;
        try { const dr = await fetch(ML + "/products/" + encodeURIComponent(String(p.id)), { headers: authHeaders }); if (dr.ok) detail = await dr.json(); } catch {}
        const winner = detail?.buy_box_winner || null;
        const range = detail?.buy_box_winner_price_range || null;
        const minPrice = Number(range?.min?.price ?? range?.min_price ?? range?.price ?? NaN);
        const maxPrice = Number(range?.max?.price ?? range?.max_price ?? range?.price ?? NaN);
        const itemId = winner?.item_id || null;
        let item: any = null;
        if (itemId) { try { const ir=await fetch(ML+"/items/"+encodeURIComponent(String(itemId)),{headers:authHeaders}); if(ir.ok)item=await ir.json(); } catch {} }
        let current=Number(winner?.price ?? winner?.amount ?? item?.price ?? (Number.isFinite(minPrice)?minPrice:NaN));
        let original=Number(winner?.regular_price ?? item?.original_price ?? NaN);
        if(!Number.isFinite(original)||original<=current) original=Number.isFinite(maxPrice)&&maxPrice>current?maxPrice:null;
        const discount=Number.isFinite(original)&&Number.isFinite(current)&&original>current&&current>0?Math.round(((original-current)/original)*100):0;
        if(somenteDescontos&&discount<=0) continue;
        const permalink=winner?.permalink||item?.permalink||detail?.permalink||null;
        const image=item?.thumbnail||item?.pictures?.[0]?.secure_url||detail?.pictures?.[0]?.url||null;
        if(!permalink&&!itemId) continue;
        candidates.push({external_id:String(itemId||p.id),product_external_id:String(p.id),title:winner?.title||item?.title||detail?.name||"Produto Mercado Livre",current:Number.isFinite(current)?current:null,original,discount,image,permalink,promotion_id:null,promotion_type:null,free_shipping:!!item?.shipping?.free_shipping,score:discount*10,term});
        if(candidates.length>=limit*2) break;
      }
    }

    // Complementa preço/promoção usando a conta conectada.
    // Isso também permite detectar promoções do vendedor quando disponíveis.
    const enriched: any[] = [];

    for (const item of candidates) {
      if (enriched.length >= limit) break;

      let current = item.current;
      let original = item.original;
      let promotionId: string | null = null;
      let promotionType: string | null = null;
      let freeShipping = item.free_shipping;

      try {
        const priceUrl =
          ML +
          "/items/" +
          encodeURIComponent(item.external_id) +
          "/sale_price?context=channel_marketplace";

        const pr = await fetch(priceUrl, { headers: authHeaders });
        const pt = await pr.text();

        if (pr.ok) {
          const sale = JSON.parse(pt);
          if (Number.isFinite(Number(sale?.amount))) current = Number(sale.amount);
          if (
            Number.isFinite(Number(sale?.regular_amount)) &&
            Number(sale.regular_amount) > current
          ) {
            original = Number(sale.regular_amount);
          }
          promotionId = sale?.metadata?.promotion_id || null;
          promotionType = sale?.metadata?.promotion_type || null;
        }
      } catch {
        // Mantém os dados públicos da busca.
      }

      try {
        const ir = await fetch(
          ML + "/items/" + encodeURIComponent(item.external_id),
          { headers: { Accept: "application/json" } }
        );
        if (ir.ok) {
          const detail = await ir.json();
          freeShipping = !!detail?.shipping?.free_shipping;
          item.image =
            detail?.thumbnail ||
            detail?.pictures?.[0]?.secure_url ||
            detail?.pictures?.[0]?.url ||
            item.image;
          item.permalink = detail?.permalink || item.permalink;
          item.title = detail?.title || item.title;
        }
      } catch {
        // Mantém os dados já encontrados.
      }

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

    enriched.sort(
      (a, b) =>
        b.score - a.score ||
        b.discount - a.discount ||
        Number(a.current || 0) - Number(b.current || 0)
    );

    const selected = enriched.slice(0, limit);

    let novas = 0;
    let atualizadas = 0;
    const ofertas: any[] = [];

    for (const o of selected) {
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
          termo: o.term
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

      // IMPORTANTE: o robô precisa receber o UUID da tabela offers,
      // e não o ID externo MLB..., porque affiliate-link e generate-content
      // consultam offers.id.
      ofertas.push({
        id: offerId,
        external_id: o.external_id,
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
    return json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Erro interno."
      },
      500
    );
  }
});
