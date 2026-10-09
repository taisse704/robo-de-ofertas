import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

const json = (data: unknown, status = 200, extra: Record<string,string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60", ...extra },
  });

function isValidHttpUrl(value: unknown) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ ok: false, error: "Use GET." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !key) return json({ ok: false, error: "Configuração do Supabase incompleta." }, 500);

    const db = createClient(url, key);
    const requestUrl = new URL(req.url);
    const action = String(requestUrl.searchParams.get("action") || "list").toLowerCase();
    const slug = String(requestUrl.searchParams.get("slug") || "cupons-shopee").trim();

    const { data: page, error: pageError } = await db
      .from("coupon_pages")
      .select("id,user_id,slug,titulo,subtitulo,ativo")
      .eq("slug", slug)
      .eq("ativo", true)
      .maybeSingle();

    if (pageError) throw pageError;
    if (!page) return json({ ok: false, error: "Página de cupons não encontrada." }, 404);

    if (action === "click") {
      const couponId = String(requestUrl.searchParams.get("coupon_id") || "").trim();
      const origem = String(requestUrl.searchParams.get("origem") || "pagina_cupons").slice(0, 80);
      const subId = String(requestUrl.searchParams.get("sub_id") || "").slice(0, 120);

      if (!couponId) return json({ ok: false, error: "Cupom não informado." }, 400);

      const now = new Date().toISOString();
      const { data: coupon, error: couponError } = await db
        .from("coupons")
        .select("id,user_id,platform_id,codigo,ativo,verificado,validade_inicio,validade_fim,url_afiliado,offer_id,descricao")
        .eq("id", couponId)
        .eq("user_id", page.user_id)
        .eq("ativo", true)
        .eq("verificado", true)
        .or(`validade_inicio.is.null,validade_inicio.lte.${now}`)
        .or(`validade_fim.is.null,validade_fim.gte.${now}`)
        .maybeSingle();

      if (couponError) throw couponError;
      if (!coupon) return json({ ok: false, error: "Este cupom não está mais disponível." }, 404);

      let destination = coupon.url_afiliado || "";

      if (!destination && coupon.offer_id) {
        const { data: offer } = await db
          .from("offers")
          .select("affiliate_url,url_produto")
          .eq("id", coupon.offer_id)
          .eq("user_id", page.user_id)
          .maybeSingle();
        destination = offer?.affiliate_url || offer?.url_produto || "";
      }

      if (!destination) {
        const { data: link } = await db
          .from("affiliate_links")
          .select("url_afiliado")
          .eq("user_id", page.user_id)
          .eq("offer_id", coupon.offer_id)
          .eq("status", "gerado")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        destination = link?.url_afiliado || "";
      }

      if (!isValidHttpUrl(destination)) {
        return json({ ok: false, error: "Este cupom ainda não possui um link de afiliado válido." }, 409);
      }

      const { error: clickError } = await db.from("coupon_clicks").insert({
        page_id: page.id,
        coupon_id: coupon.id,
        user_id: page.user_id,
        origem,
        sub_id: subId || null,
        referer: req.headers.get("referer") || null,
        user_agent: req.headers.get("user-agent") || null,
      });

      if (clickError) console.error("COUPON CLICK LOG:", clickError);

      return new Response(null, {
        status: 302,
        headers: {
          Location: destination,
          "Cache-Control": "no-store",
        },
      });
    }

    const now = new Date().toISOString();
    const { data: coupons, error: couponsError } = await db
      .from("coupons")
      .select("id,codigo,descricao,tipo_desconto,valor,percentual,compra_minima,validade_inicio,validade_fim,regras,offer_id,url_afiliado,prioridade")
      .eq("user_id", page.user_id)
      .eq("ativo", true)
      .eq("verificado", true)
      .or(`validade_inicio.is.null,validade_inicio.lte.${now}`)
      .or(`validade_fim.is.null,validade_fim.gte.${now}`)
      .order("prioridade", { ascending: false })
      .order("validade_fim", { ascending: true, nullsFirst: false })
      .limit(100);

    if (couponsError) throw couponsError;

    const offerIds = (coupons || []).map((c: any) => c.offer_id).filter(Boolean);
    const offersMap = new Map<string, any>();

    if (offerIds.length) {
      const { data: offers } = await db
        .from("offers")
        .select("id,titulo,imagem_url,affiliate_url,url_produto")
        .eq("user_id", page.user_id)
        .in("id", offerIds);
      for (const offer of offers || []) offersMap.set(offer.id, offer);
    }

    const safeCoupons = (coupons || []).map((coupon: any) => {
      const offer = coupon.offer_id ? offersMap.get(coupon.offer_id) : null;
      const destination = coupon.url_afiliado || offer?.affiliate_url || offer?.url_produto || null;
      return {
        id: coupon.id,
        codigo: coupon.codigo,
        descricao: coupon.descricao,
        tipo_desconto: coupon.tipo_desconto,
        valor: coupon.valor,
        percentual: coupon.percentual,
        compra_minima: coupon.compra_minima,
        validade_inicio: coupon.validade_inicio,
        validade_fim: coupon.validade_fim,
        regras: coupon.regras || {},
        offer_id: coupon.offer_id,
        produto_titulo: offer?.titulo || null,
        imagem_url: offer?.imagem_url || null,
        disponivel_para_clique: isValidHttpUrl(destination),
      };
    });

    return json({
      ok: true,
      page: {
        slug: page.slug,
        titulo: page.titulo,
        subtitulo: page.subtitulo,
      },
      coupons: safeCoupons,
      total: safeCoupons.length,
    });
  } catch (e) {
    console.error("COUPON-PAGE ERRO:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Erro interno." }, 500);
  }
});