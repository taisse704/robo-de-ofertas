import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const out = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" }
    });

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const auth = req.headers.get("Authorization") || "";
    const body = await req.json().catch(() => ({}));

    if (!url || !key) return out({ ok: false, error: "Configuração do Supabase incompleta." }, 500);
    if (!auth.startsWith("Bearer ")) return out({ ok: false, error: "Autorização obrigatória." }, 401);

    const db = createClient(url, key);
    const bearer = auth.slice(7);
    let userId = "";

    if (bearer === key) {
      userId = String(body?.user_id || "");
    } else {
      const { data, error } = await db.auth.getUser(bearer);
      if (error || !data?.user) return out({ ok: false, error: "Sessão inválida." }, 401);
      userId = data.user.id;
    }

    if (!userId) return out({ ok: false, error: "user_id obrigatório." }, 400);

    const { data: settings } = await db
      .from("robot_settings")
      .select("configuracao,gerar_texto,gerar_imagem,gerar_video")
      .eq("user_id", userId)
      .maybeSingle();

    const cfg = settings?.configuracao || {};
    const approval = cfg.aprovacao_antes_publicar === true;
    const status = approval ? "aguardando_revisao" : "pronto";
    const modoConteudo = ["video","post","automatico"].includes(String(cfg.modo_conteudo || ""))
      ? String(cfg.modo_conteudo)
      : (settings?.gerar_video === true ? "video" : "post");

    const selectedOfferIds = Array.isArray(body?.offer_ids)
      ? body.offer_ids.map(String).filter(Boolean).slice(0, 50)
      : [];

    let offersQuery = db
      .from("offers")
      .select("*")
      .eq("user_id", userId)
      .eq("permitido_divulgacao", true);

    // Não cria conteúdo que não tenha mídia de origem utilizável.
    // Isso evita tarefas de vídeo que já nascem sem imagem/capa.
    offersQuery = offersQuery.or("imagem_url.not.is.null,video_url.not.is.null");
    if (selectedOfferIds.length) offersQuery = offersQuery.in("id", selectedOfferIds);

    // No modo automático, não podemos limitar a seleção aos 10 primeiros
    // antes de verificar se eles já possuem conteúdo. Se os 10 melhores já
    // tiverem sido publicados, o robô ficava sem selecionar as próximas
    // ofertas, mesmo havendo centenas de ofertas elegíveis.
    //
    // Para seleção manual (offer_ids), mantemos exatamente os IDs escolhidos.
    // Uma rodada automática cria no máximo 20 conteúdos para não inundar
    // a fila enquanto o processamento de vídeo estiver pendente.
    const candidateLimit = selectedOfferIds.length ? selectedOfferIds.length : 20;

    const { data: offers, error } = await offersQuery
      .order("score_oferta", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(candidateLimit);

    if (error) throw error;
    if (!offers?.length) {
      return out({ ok: true, count: 0, message: "Nenhuma oferta pronta para gerar conteúdo." });
    }

    let count = 0;
    let skippedVideoWithoutRenderer = 0;
    const conteudos = [];

    for (const offer of offers) {
      const isMercadoLivre = String(offer.store_provider || "").toLowerCase() === "mercadolivre";
      const affiliateUrl = String(offer.affiliate_url || "").trim();

      // Mercado Livre só pode entrar no conteúdo depois que o link oficial
      // de afiliado foi realmente gerado e salvo.
      if (isMercadoLivre && !affiliateUrl) continue;

      const { data: exists } = await db
        .from("contents")
        .select("id")
        .eq("user_id", userId)
        .eq("offer_id", offer.id)
        .in("status", ["rascunho", "aguardando_revisao", "pronto", "publicando", "publicado"])
        .limit(1)
        .maybeSingle();

      if (exists) continue;

      const price = Number(offer.preco_atual || 0);
      const old = Number(offer.preco_anterior || 0);
      const discount = Number(offer.desconto_percentual || 0);
      const title = String(offer.titulo || "Oferta especial").trim();
      const link = isMercadoLivre ? affiliateUrl : (affiliateUrl || offer.url_produto || "");
      const money = (value: number) => value.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      const headlineSource = title
        .replace(/\s+/g, " ")
        .split(/[|,;:]/)[0]
        .trim();
      const headlineBase = headlineSource.length > 54
        ? headlineSource.slice(0, 54).replace(/\s+\S*$/, "").trim()
        : headlineSource;
      const headline = (headlineBase || "OFERTA").toLocaleUpperCase("pt-BR") + " NO PRECINHO";
      const origin = offer.dados_origem && typeof offer.dados_origem === "object"
        ? offer.dados_origem
        : {};
      const coupon = String(offer.cupom_codigo || "").trim();
      const seller = String(
        origin.seller_name || origin.seller_nickname || origin.vendedor_nome || ""
      ).trim();
      const paymentInfo = String(
        origin.payment_method || origin.forma_pagamento || ""
      ).toLowerCase();
      const paymentMethods = Array.isArray(origin.payment_methods)
        ? origin.payment_methods.map((x: unknown) => String(x).toLowerCase())
        : [];
      const paymentVerifiedAt = Date.parse(String(origin.payment_method_verified_at || ""));
      const paymentInfoFresh = Number.isFinite(paymentVerifiedAt) &&
        paymentVerifiedAt <= Date.now() &&
        Date.now() - paymentVerifiedAt <= 24 * 60 * 60 * 1000;
      const pixConfirmed = paymentInfoFresh &&
        (paymentInfo.includes("pix") || paymentMethods.some((x: string) => x.includes("pix")));

      let legenda = "🔥 *" + headline + "* 🔥\n\n🛍️ " + title + "\n\n";
      if (old > price) {
        legenda += "💰 De ~R$ " + money(old) + "~ por *R$ " + money(price) + "*";
      } else {
        legenda += "💰 Por *R$ " + money(price) + "*";
      }
      if (discount > 0) legenda += "\n🏷️ *" + discount + "% OFF*";
      if (coupon) legenda += "\n🎟️ Use o cupom: *" + coupon + "*";
      if (pixConfirmed) legenda += "\n💳 Selecione *Pix* para garantir o preço";
      if (seller) legenda += "\n\n🏪 Vendido por " + seller + " no Mercado Livre";
      legenda += "\n\n🛒 Compre aqui 👇\n" + link;

      const originalVideo = typeof offer.video_url === "string" && offer.video_url.trim()
        ? offer.video_url.trim()
        : null;

      // Não existe um renderizador de vídeo ativo neste projeto. Sem vídeo
      // original, não criamos jobs que ficariam eternamente pendentes.
      if (modoConteudo === "video" && !originalVideo) {
        skippedVideoWithoutRenderer++;
        continue;
      }

      const usarVideo = modoConteudo === "video" || (modoConteudo === "automatico" && !!originalVideo);

      const videoSource = usarVideo
        ? (originalVideo ? (offer.video_source || "original") : "gerado")
        : null;

      const videoStatus = usarVideo
        ? (originalVideo ? "original_disponivel" : "aguardando_geracao")
        : "nao_solicitado";

      const { data: content, error: ce } = await db
        .from("contents")
        .insert({
          user_id: userId,
          offer_id: offer.id,
          tipo: usarVideo ? "video_oferta" : "oferta_rapida",
          formato: "9:16",
          titulo: title,
          legenda,
          cta: "Aproveite a oferta",
          video_url: originalVideo,
          video_source: videoSource,
          video_status: videoStatus,
          thumbnail_url: offer.imagem_url,
          dados_geracao: {
            fonte: "generate-content",
            affiliate_url: link,
            gerar_texto: settings?.gerar_texto !== false,
            gerar_imagem: settings?.gerar_imagem !== false,
            gerar_video: usarVideo,
            modo_conteudo: modoConteudo,
            video_source: videoSource
          },
          status
        })
        .select()
        .single();

      if (ce) throw ce;

      if (usarVideo && content) {
        const { error: jobError } = await db.from("video_jobs").insert({
          user_id: userId,
          offer_id: offer.id,
          content_id: content.id,
          status: originalVideo ? "concluido" : "pendente",
          source_type: originalVideo ? "original" : "gerar",
          source_video_url: originalVideo,
          output_url: originalVideo,
          dados: {
            formato: "9:16",
            largura: 1080,
            altura: 1920,
            duracao_segundos: 10,
            titulo: title,
            preco: price,
            desconto: discount,
            imagem_url: offer.imagem_url,
            provider: offer.store_provider
          }
        });

        if (jobError && jobError.code !== "23505") throw jobError;
      }

      conteudos.push(content);
      count++;
    }

    return out({
      ok: true,
      count,
      conteudos,
      skipped_video_without_renderer: skippedVideoWithoutRenderer,
      message: skippedVideoWithoutRenderer > 0 && count === 0
        ? "Nenhum vídeo foi criado: o projeto ainda não tem um renderizador de vídeo ativo e essas ofertas não possuem vídeo original."
        : undefined
    });
  } catch (e) {
    console.error("GENERATE-CONTENT ERRO:", e);
    return out({ ok: false, error: e?.message || "Erro interno." }, 500);
  }
});