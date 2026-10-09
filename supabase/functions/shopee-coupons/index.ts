import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

async function authUser(req: Request, db: ReturnType<typeof createClient>, body: any) {
  const auth = req.headers.get("Authorization") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (key && auth === "Bearer " + key && body?.user_id) return String(body.user_id);
  if (!auth.startsWith("Bearer ")) return null;
  const { data } = await db.auth.getUser(auth.slice(7));
  return data?.user?.id || null;
}

function normalizeCoupon(input: any) {
  const codigo = typeof input.codigo === "string" ? input.codigo.trim() : "";
  if (!codigo) throw new Error("codigo do cupom é obrigatório.");
  const tipo = typeof input.tipo_desconto === "string" ? input.tipo_desconto.trim().toLowerCase() : "desconto";
  const valor = input.valor == null ? null : Number(input.valor);
  const percentual = input.percentual == null ? null : Number(input.percentual);
  const compraMinima = input.compra_minima == null ? null : Number(input.compra_minima);
  const inicio = input.validade_inicio || null;
  const fim = input.validade_fim || null;

  if (valor != null && (!Number.isFinite(valor) || valor < 0)) throw new Error("valor inválido.");
  if (percentual != null && (!Number.isFinite(percentual) || percentual < 0 || percentual > 100)) throw new Error("percentual inválido.");
  if (compraMinima != null && (!Number.isFinite(compraMinima) || compraMinima < 0)) throw new Error("compra_minima inválida.");
  if (inicio && Number.isNaN(Date.parse(inicio))) throw new Error("validade_inicio inválida.");
  if (fim && Number.isNaN(Date.parse(fim))) throw new Error("validade_fim inválida.");
  if (inicio && fim && new Date(inicio).getTime() > new Date(fim).getTime()) throw new Error("validade_inicio não pode ser posterior à validade_fim.");
  if (fim && new Date(fim).getTime() < Date.now()) throw new Error("O cupom informado já está expirado.");

  return {
    codigo,
    descricao: typeof input.descricao === "string" ? input.descricao.trim() || null : null,
    tipo_desconto: tipo,
    valor,
    percentual,
    compra_minima: compraMinima,
    validade_inicio: inicio,
    validade_fim: fim,
    produto_id: input.produto_id || null,
    offer_id: input.offer_id || null,
    ativo: input.ativo !== false,
    verificado: input.verificado === true,
    regras: input.regras && typeof input.regras === "object" ? input.regras : {},
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !key) return json({ ok: false, error: "Configuração do Supabase incompleta." }, 500);

    const db = createClient(url, key);
    const body = await req.json().catch(() => ({}));
    const userId = await authUser(req, db, body);
    if (!userId) return json({ ok: false, error: "Usuário não autenticado." }, 401);

    const action = String(body.action || "list").toLowerCase();

    const { data: platform, error: pe } = await db
      .from("platforms").select("id,nome").ilike("nome", "Shopee").maybeSingle();
    if (pe) throw pe;
    if (!platform?.id) return json({ ok: false, error: "Plataforma Shopee não cadastrada." }, 404);

    if (action === "status") {
      return json({
        ok: true,
        provider: "shopee",
        official_api_configured: !!(Deno.env.get("SHOPEE_APP_ID") && Deno.env.get("SHOPEE_APP_SECRET")),
        coupon_api_available: false,
        automatic_discovery: false,
        message: "A Open API pública atual da Shopee não expõe operação de listagem de cupons. O módulo está preparado para receber cupons oficiais sem scraping.",
      });
    }

    if (action === "list") {
      const now = new Date().toISOString();
      const { data, error } = await db.from("coupons")
        .select("*")
        .eq("user_id", userId)
        .eq("platform_id", platform.id)
        .eq("ativo", true)
        .eq("verificado", true)
        .or(`validade_inicio.is.null,validade_inicio.lte.${now}`)
        .or(`validade_fim.is.null,validade_fim.gte.${now}`)
        .order("created_at", { ascending: false })
        .limit(Math.min(Math.max(Number(body.limit) || 50, 1), 100));
      if (error) throw error;
      return json({ ok: true, provider: "shopee", automatic_discovery: false, coupons: data || [] });
    }

    if (action === "upsert") {
      const coupon = normalizeCoupon(body.coupon || {});
      if (coupon.verificado !== true) {
        return json({ ok: false, error: "Somente cupons marcados como verificados podem entrar no fluxo automático." }, 422);
      }

      if (coupon.offer_id) {
        const { data: offer } = await db.from("offers")
          .select("id,user_id,platform_id,store_provider")
          .eq("id", coupon.offer_id).eq("user_id", userId).maybeSingle();
        if (!offer || offer.platform_id !== platform.id || String(offer.store_provider || "").toLowerCase() !== "shopee") {
          return json({ ok: false, error: "A oferta informada não pertence à Shopee deste usuário." }, 422);
        }
      }

      const { data: existing } = await db.from("coupons")
        .select("id")
        .eq("user_id", userId)
        .eq("platform_id", platform.id)
        .ilike("codigo", coupon.codigo)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const payload = {
        user_id: userId,
        platform_id: platform.id,
        ...coupon,
        updated_at: new Date().toISOString(),
      };

      let saved;
      if (existing?.id) {
        const { data, error } = await db.from("coupons")
          .update(payload).eq("id", existing.id).eq("user_id", userId).select().single();
        if (error) throw error;
        saved = data;
      } else {
        const { data, error } = await db.from("coupons").insert(payload).select().single();
        if (error) throw error;
      saved = data;
      }

      if (coupon.offer_id) {
        const update: any = {
          cupom_codigo: coupon.codigo,
          cupom_desconto_percentual: coupon.percentual,
          cupom_desconto_valor: coupon.valor,
          promocao_titulo: coupon.descricao,
          promocao_id_externo: coupon.regras?.id_externo || coupon.regras?.coupon_id || null,
          atualizada_em: new Date().toISOString(),
        };
        const { error: oe } = await db.from("offers").update(update)
          .eq("id", coupon.offer_id).eq("user_id", userId);
        if (oe) throw oe;
      }

      return json({ ok: true, provider: "shopee", coupon: saved });
    }

    if (action === "apply") {
      const offerId = String(body.offer_id || "");
      const couponId = String(body.coupon_id || "");
      if (!offerId || !couponId) return json({ ok: false, error: "Informe offer_id e coupon_id." }, 400);

      const now = new Date().toISOString();
      const { data: coupon } = await db.from("coupons").select("*")
        .eq("id", couponId).eq("user_id", userId).eq("platform_id", platform.id)
        .eq("ativo", true).eq("verificado", true)
        .or(`validade_inicio.is.null,validade_inicio.lte.${now}`)
        .or(`validade_fim.is.null,validade_fim.gte.${now}`)
        .maybeSingle();
      if (!coupon) return json({ ok: false, error: "Cupom não encontrado, expirado ou não verificado." }, 404);

      const { data: offer } = await db.from("offers").select("id,user_id,platform_id,store_provider")
        .eq("id", offerId).eq("user_id", userId).maybeSingle();
      if (!offer || offer.platform_id !== platform.id || String(offer.store_provider || "").toLowerCase() !== "shopee") {
        return json({ ok: false, error: "Oferta Shopee inválida." }, 422);
      }

      const { error: ce } = await db.from("coupons").update({ offer_id: offerId, updated_at: new Date().toISOString() })
        .eq("id", couponId).eq("user_id", userId);
      if (ce) throw ce;

      const { error: oe } = await db.from("offers").update({
        cupom_codigo: coupon.codigo,
        cupom_desconto_percentual: coupon.percentual,
        cupom_desconto_valor: coupon.valor,
        promocao_titulo: coupon.descricao,
        promocao_id_externo: coupon.regras?.id_externo || coupon.regras?.coupon_id || null,
        atualizada_em: new Date().toISOString(),
      }).eq("id", offerId).eq("user_id", userId);
      if (oe) throw oe;

      return json({ ok: true, applied: true, offer_id: offerId, coupon_id: couponId });
    }

    return json({ ok: false, error: "Ação inválida. Use status, list, upsert ou apply." }, 400);
  } catch (e) {
    console.error("SHOPEE-COUPONS ERRO:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Erro interno." }, 500);
  }
});