import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const GRAPH = "https://graph.instagram.com";

const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function errorText(value: any) {
  return value?.error?.message || value?.message || String(value || "Erro desconhecido.");
}

async function graphJson(path: string, init: RequestInit = {}) {
  const r = await fetch(`${GRAPH}${path}`, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.error) {
    throw new Error(errorText(data));
  }
  return data;
}

async function publishInstagram(args: {
  instagramId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
  affiliateUrl: string;
}) {
  if (!args.imageUrl) throw new Error("O conteúdo não possui uma imagem pública para o Instagram.");

  const caption = args.caption || "";
  const createBody = new URLSearchParams({
    image_url: args.imageUrl,
    caption,
    access_token: args.accessToken,
  });

  const container = await graphJson(`/${encodeURIComponent(args.instagramId)}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: createBody,
  });

  const creationId = container?.id;
  if (!creationId) throw new Error("O Instagram não retornou o ID do conteúdo.");

  let lastStatus = "";
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const status = await graphJson(
      `/${encodeURIComponent(creationId)}?fields=status_code,status&access_token=${encodeURIComponent(args.accessToken)}`,
    );
    lastStatus = status?.status_code || status?.status || "";
    if (lastStatus === "FINISHED") break;
    if (["ERROR", "EXPIRED"].includes(lastStatus)) {
      throw new Error(`Instagram rejeitou o conteúdo durante o processamento (${lastStatus}).`);
    }
    if (i === 29) throw new Error(`Instagram não concluiu o processamento do conteúdo (${lastStatus || "status desconhecido"}).`);
  }

  const published = await graphJson(`/${encodeURIComponent(args.instagramId)}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: creationId,
      access_token: args.accessToken,
    }),
  });

  const mediaId = published?.id;
  if (!mediaId) throw new Error("O Instagram não retornou o ID da publicação.");

  // O link de afiliado fica no primeiro comentário quando a API permitir comentários.
  if (args.affiliateUrl) {
    try {
      await graphJson(`/${encodeURIComponent(mediaId)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          message: `🔗 Clique no link abaixo para comprar 👇\n${args.affiliateUrl}`,
          access_token: args.accessToken,
        }),
      });
    } catch (commentError) {
      console.error("INSTAGRAM PRIMEIRO COMENTARIO:", commentError);
    }
  }

  return { mediaId, creationId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return response("ok");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const authorization = req.headers.get("Authorization") || "";
    const body = await req.json().catch(() => ({}));

    if (!supabaseUrl || !serviceRole) return response({ ok: false, error: "Configuração do Supabase incompleta." }, 500);
    if (!authorization.startsWith("Bearer ")) return response({ ok: false, error: "Autorização obrigatória." }, 401);

    const db = createClient(supabaseUrl, serviceRole);
    const bearer = authorization.slice(7);
    let userId = "";

    if (bearer === serviceRole) {
      userId = String(body?.user_id || "");
    } else {
      const { data, error } = await db.auth.getUser(bearer);
      if (error || !data?.user) return response({ ok: false, error: "Sessão inválida." }, 401);
      userId = data.user.id;
    }

    if (!userId) return response({ ok: false, error: "Usuário não identificado." }, 400);

    const contentId = String(body?.content_id || "");
    if (!contentId) return response({ ok: false, error: "content_id obrigatório." }, 400);

    const { data: content, error: contentError } = await db
      .from("contents")
      .select("id,user_id,offer_id,titulo,legenda,thumbnail_url,imagem_1080_url,video_url,video_status,status")
      .eq("id", contentId)
      .eq("user_id", userId)
      .maybeSingle();

    if (contentError) throw contentError;
    if (!content) return response({ ok: false, error: "Conteúdo não encontrado." }, 404);

    if (!["pronto", "aguardando_revisao", "aprovado", "publicando"].includes(content.status)) {
      return response({ ok: false, error: `Conteúdo com status "${content.status}" não pode ser publicado agora.` }, 409);
    }

    // Conteúdos marcados como vídeo só podem ser publicados quando o arquivo estiver realmente pronto.
    if (content.video_status === "aguardando_geracao" || (content.video_status && content.video_status !== "pendente" && !content.video_url)) {
      return response({ ok: false, error: "O vídeo ainda está sendo gerado. Aguarde o vídeo ficar pronto antes de publicar." }, 409);
    }
    if (content.video_status && content.video_status !== "pendente" && !content.video_url) {
      return response({ ok: false, error: "O conteúdo é um vídeo, mas o arquivo ainda não está disponível." }, 409);
    }

    const { data: offer, error: offerError } = await db
      .from("offers")
      .select("id,affiliate_url,url_produto,imagem_url")
      .eq("id", content.offer_id)
      .maybeSingle();

    if (offerError) throw offerError;
    const affiliateUrl = offer?.affiliate_url || offer?.url_produto || "";

    const { data: channels, error: channelError } = await db
      .from("publication_channels")
      .select("id,tipo,nome,ativo,identificador")
      .eq("user_id", userId)
      .eq("ativo", true)
      .eq("tipo", "instagram");

    if (channelError) throw channelError;
    if (!channels?.length) return response({ ok: false, error: "Nenhum canal Instagram ativo foi encontrado." }, 409);

    const results = [];

    for (const channel of channels) {
      const { data: account, error: accountError } = await db
        .from("channel_accounts")
        .select("id,canal,status,configuracao")
        .eq("user_id", userId)
        .eq("canal", "instagram")
        .eq("status", "conectada")
        .maybeSingle();

      if (accountError) throw accountError;
      if (!account) throw new Error("A conta do Instagram não está conectada.");

      const config = account.configuracao || {};
      const accessToken = config.access_token || "";
      if (!accessToken) throw new Error("Token do Instagram não encontrado. Reconecte o Instagram.");

      const me = await graphJson(`/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`);
      const instagramId = String(me?.id || config.instagram_user_id || channel.identificador || "");
      if (!instagramId) throw new Error("ID da conta do Instagram não encontrado.");

      const imageUrl = content.imagem_1080_url || content.thumbnail_url || offer?.imagem_url || "";
      if (!imageUrl) throw new Error("O conteúdo não possui imagem.");

      let publication;
      const { data: existing, error: existingError } = await db
        .from("offer_publications")
        .select("id,status")
        .eq("user_id", userId)
        .eq("content_id", content.id)
        .eq("channel_id", channel.id)
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      if (existing) {
        publication = existing;
        await db.from("offer_publications").update({
          status: "publicando",
          erro: null,
          tentativas: (existing as any).tentativas ? (existing as any).tentativas + 1 : 1,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
      } else {
        const { data: created, error: createError } = await db.from("offer_publications").insert({
          user_id: userId,
          offer_id: content.offer_id,
          channel_id: channel.id,
          content_id: content.id,
          status: "publicando",
          titulo: content.titulo,
          texto: content.legenda,
          imagem_url: imageUrl,
          video_url: content.video_url,
          dados: { canal: "instagram", modo: "manual", instagram_user_id: instagramId },
        }).select("id,status").single();
        if (createError) throw createError;
        publication = created;
      }

      try {
        const published = await publishInstagram({
          instagramId,
          accessToken,
          imageUrl,
          caption: content.legenda || content.titulo || "",
          affiliateUrl,
        });

        const { error: doneError } = await db.from("offer_publications").update({
          status: "publicada",
          external_post_id: published.mediaId,
          published_at: new Date().toISOString(),
          erro: null,
          dados: { canal: "instagram", modo: "manual", instagram_user_id: instagramId, creation_id: published.creationId },
          updated_at: new Date().toISOString(),
        }).eq("id", publication.id);

        if (doneError) throw doneError;

        results.push({ channel: channel.tipo, ok: true, publication_id: publication.id, external_post_id: published.mediaId });
      } catch (publishError) {
        const message = errorText(publishError);
        await db.from("offer_publications").update({
          status: "erro",
          erro: message,
          updated_at: new Date().toISOString(),
        }).eq("id", publication.id);
        results.push({ channel: channel.tipo, ok: false, publication_id: publication.id, error: message });
      }
    }

    const succeeded = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok).length;

    if (succeeded > 0) {
      await db.from("contents").update({
        status: "publicado",
        updated_at: new Date().toISOString(),
      }).eq("id", content.id).eq("user_id", userId);
    } else {
      await db.from("contents").update({
        status: "pronto",
        updated_at: new Date().toISOString(),
      }).eq("id", content.id).eq("user_id", userId);
    }

    return response({
      ok: succeeded > 0,
      publicadas: succeeded,
      erros: failed,
      resultados: results,
      message: succeeded > 0 ? "Publicado no Instagram." : "O Instagram recusou a publicação.",
    }, succeeded > 0 ? 200 : 502);
  } catch (error) {
    console.error("PUBLISH-CONTENT ERRO:", error);
    return response({ ok: false, error: errorText(error) }, 500);
  }
});
