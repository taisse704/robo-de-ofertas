import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};


function isVerifiedOriginalVideoUrl(raw: unknown, source: string, origin: any): boolean {
  if (typeof raw !== "string" || raw.length > 4096 || !["original", "shopee_public_listing", "mercadolivre_public_listing"].includes(source)) return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password) return false;
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|json|js|html|htm|css|txt|xml)(?:$|[?#])/i.test(u.pathname)) return false;
    if (/\.(m3u8|mpd)(?:$|[?#])/i.test(u.href)) return false;
    const provider = String(origin?.video_provider || origin?.store_provider || "").toLowerCase();
    const allowed = ["mlstatic.com", "susercontent.com", "shopeemobile.com"].some(d => host === d || host.endsWith("." + d)) ||
      ["mercadolivre.com.br", "mercadolibre.com", "shopee.com.br", "shopee.com"].some(d => host === d || host.endsWith("." + d));
    if (!allowed) return false;
    const hasVideoExtension = /\.(mp4|m4v|mov|webm)(?:$|[?#])/i.test(u.href);
    const captureMethod = String(origin?.video_capture_method || "");
    const capturedFromPlayer = ["video_element", "video_source", "structured_video_field", "inline_video_data", "video_resource"].includes(captureMethod) ||
      (captureMethod.startsWith("page_json_response:") && /video|media|play|stream|vod/i.test(captureMethod));
    return hasVideoExtension || capturedFromPlayer;
  } catch { return false; }
}

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
    // Busca candidatos além dos primeiros já usados, para não ficar sem vídeo
    // quando as ofertas de maior pontuação já têm conteúdo cadastrado.
    const candidateLimit = selectedOfferIds.length ? selectedOfferIds.length : 100;
    // Equilibra geração e publicação: no máximo 2 conteúdos novos por ciclo automático.
    const contentLimit = selectedOfferIds.length ? selectedOfferIds.length : 2;

    const { data: offers, error } = await offersQuery
      // Prioriza as ofertas recém-encontradas da Shopee para que entrem no fluxo
      // de conteúdo antes das ofertas antigas; depois usa o ranking comercial.
      .order("nova", { ascending: false, nullsFirst: false })
      .order("score_oferta", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(candidateLimit);

    if (error) throw error;
    if (!offers?.length) {
      return out({ ok: true, count: 0, message: "Nenhuma oferta pronta para gerar conteúdo." });
    }

    let count = 0;
    const conteudos = [];

    for (const offer of offers) {
      if (count >= contentLimit) break;
      const isMercadoLivre = String(offer.store_provider || "").toLowerCase() === "mercadolivre";
      const affiliateUrl = String(offer.affiliate_url || "").trim();

      // Mercado Livre só pode entrar no conteúdo depois que o link oficial
      // de afiliado foi realmente gerado e salvo.
      if (isMercadoLivre && !affiliateUrl) continue;

      const { data: exists } = await db
        .from("contents")
        .select("id,tipo,status,video_url,video_source,video_status,dados_geracao")
        .eq("user_id", userId)
        .eq("offer_id", offer.id)
        .in("status", ["rascunho", "aguardando_revisao", "pronto", "publicando", "publicado"])
        .limit(1)
        .maybeSingle();

      const browserOriginalUrl = typeof offer.video_url === "string" ? offer.video_url.trim() : "";
      const browserOriginalReady = !!browserOriginalUrl &&
        String(offer.video_source || "").toLowerCase() === "original" &&
        String(offer.video_status || "").toLowerCase() === "original_disponivel";

      if (exists) {
        // If the browser extension imported the actual listing video after the post was queued,
        // update the existing record rather than skipping it or creating a duplicate.
        // Do not overwrite a published record or one currently being published.
        const promotionOrigin = offer.dados_origem && typeof offer.dados_origem === "object" ? offer.dados_origem : {};
        const promotionQualityVerified = isVerifiedOriginalVideoUrl(browserOriginalUrl, String(offer.video_source || "").toLowerCase(), promotionOrigin);
        if (browserOriginalReady && promotionQualityVerified &&
            !["publicado","publicada","publicando"].includes(String(exists.status || "").toLowerCase()) &&
            exists.tipo !== "video_oferta") {
          const { error: promoteError } = await db.from("contents").update({
            tipo: "video_oferta",
            video_url: browserOriginalUrl,
            video_source: "original",
            video_status: "original_disponivel",
            thumbnail_url: offer.imagem_url || null,
            formato: "9:16",
            dados_geracao: {
              ...(exists.dados_geracao && typeof exists.dados_geracao === "object" ? exists.dados_geracao : {}),
              fonte: "generate-content-sync-original",
              gerar_video: true,
              video_source: "original",
              video_fallback_para_post: false,
              video_fallback_motivo: null,
              video_quality_policy: { required: true, source_must_be_trusted: true, reject_image_and_manifest_urls: true, note: "Vídeo original capturado do player/anúncio; a plataforma de destino valida o arquivo ao publicar." }
            },
            updated_at: new Date().toISOString()
          }).eq("id", exists.id).eq("user_id", userId);
          if (promoteError) throw promoteError;

          const { error: jobError } = await db.from("video_jobs").insert({
            user_id: userId, offer_id: offer.id, content_id: exists.id,
            status: "concluido", source_type: "original",
            source_video_url: browserOriginalUrl, output_url: browserOriginalUrl,
            dados: { formato: "9:16", quality_validation_required: true, minimum_width: 720, minimum_height: 1280, audio_required: true, titulo: offer.titulo, imagem_url: offer.imagem_url, provider: offer.store_provider }
          });
          if (jobError && jobError.code !== "23505") throw jobError;
        }
        continue;
      }

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
        legenda += "💰 De R$ " + money(old) + " por *R$ " + money(price) + (pixConfirmed ? " no Pix*" : "*");
      } else {
        legenda += "💰 Por *R$ " + money(price) + (pixConfirmed ? " no Pix*" : "*");
      }
      if (discount > 0) legenda += "\n🏷️ *" + discount + "% OFF*";
      if (coupon) legenda += "\n🎟️ Use o cupom: *" + coupon + "*";
      if (pixConfirmed) legenda += "\n💳 Selecione *Pix* para garantir o preço";
      if (seller) legenda += "\n\n🏪 Vendido por " + seller + " no Mercado Livre";
      legenda += "\n\n🛒 Compre aqui 👇\n" + link;

      const originalVideo = typeof offer.video_url === "string" && offer.video_url.trim()
        ? offer.video_url.trim()
        : null;
      const sourceVideo = String(offer.video_source || "").trim().toLowerCase();
      const fontesVideoConfiaveis = new Set(["original", "shopee_public_listing", "mercadolivre_public_listing"]);
      const originVideoMeta = offer.dados_origem && typeof offer.dados_origem === "object"
        ? offer.dados_origem
        : {};
      const qualityCheck = originVideoMeta.video_quality_check && typeof originVideoMeta.video_quality_check === "object"
        ? originVideoMeta.video_quality_check
        : {};
      const qualityVerified = isVerifiedOriginalVideoUrl(originalVideo, sourceVideo, originVideoMeta);
      const videoOriginalConfirmado = !!originalVideo &&
        String(offer.video_status || "").toLowerCase() === "original_disponivel" &&
        fontesVideoConfiaveis.has(sourceVideo) &&
        qualityVerified;

      // Não basta existir uma URL: a oferta precisa ter sido validada como mídia original.
      // Isso impede que uma URL desconhecida ou um vídeo gerado seja rotulado como original.
      const modoVideoSolicitado = modoConteudo === "video" || modoConteudo === "automatico";
      // O modo automático não pode deixar a fila vazia quando a loja não expõe
      // um vídeo original. Publica como post de imagem nesse caso; nunca inventa
      // nem rotula uma imagem como vídeo.
      const videoFallbackParaPost = modoVideoSolicitado && !videoOriginalConfirmado;
      const usarVideo = modoVideoSolicitado && videoOriginalConfirmado;

      const videoSource = usarVideo ? sourceVideo : null;
      const videoStatus = usarVideo ? "original_disponivel" : "nao_solicitado";

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
            video_source: videoSource,
            video_fallback_para_post: videoFallbackParaPost,
            video_fallback_motivo: videoFallbackParaPost ? (!originalVideo ? "Não há vídeo original disponível." : "A URL do vídeo original não passou pela validação de origem e formato; será mantido como post de imagem.") : null,
            video_quality_policy: { required: true, source_must_be_trusted: true, reject_image_and_manifest_urls: true }
          },
          status
        })
        .select()
        .single();

      if (ce) throw ce;

      if (usarVideo && content) {
        // Registra somente a URL do vídeo original; não cria jobs de renderização por imagem.
        const { error: jobError } = await db.from("video_jobs").insert({
          user_id: userId,
          offer_id: offer.id,
          content_id: content.id,
          status: "concluido",
          source_type: "original",
          source_video_url: originalVideo,
          output_url: originalVideo,
          dados: {
            formato: "9:16",
            quality_validation_required: true,
            minimum_width: 720,
            minimum_height: 1280,
            titulo: title,
            preco: price,
            desconto: discount,
            imagem_url: offer.imagem_url,
            provider: offer.store_provider
          }
        });

        if (jobError && jobError.code !== "23505") throw jobError;
      }

      // Ao cadastrar o conteúdo na fila, a oferta deixa de aparecer como
      // "nova" e passa para "cadastrada". A oferta continua salva e divulgável.
      const { error: offerUpdateError } = await db
        .from("offers")
        .update({ nova: false, atualizada_em: new Date().toISOString() })
        .eq("id", offer.id)
        .eq("user_id", userId);
      if (offerUpdateError) throw offerUpdateError;

      conteudos.push(content);
      count++;
    }

    return out({ ok: true, count, conteudos });
  } catch (e) {
    console.error("GENERATE-CONTENT ERRO:", e);
    return out({ ok: false, error: e?.message || "Erro interno." }, 500);
  }
});