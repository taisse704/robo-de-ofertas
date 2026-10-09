import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};

const out = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const auth = req.headers.get("Authorization") || "";
    const body = await req.json().catch(() => ({}));
    if (!url || !serviceKey) return out({ ok: false, error: "Configuração do Supabase incompleta." }, 500);
    if (!auth.startsWith("Bearer ")) return out({ ok: false, error: "Autorização obrigatória." }, 401);

    const db = createClient(url, serviceKey);
    const bearer = auth.slice(7);
    let userId = "";

    if (bearer === serviceKey) {
      userId = String(body?.user_id || "");
    } else {
      const { data, error } = await db.auth.getUser(bearer);
      if (error || !data?.user) return out({ ok: false, error: "Sessão inválida." }, 401);
      userId = data.user.id;
    }

    const contentId = String(body?.content_id || "");
    const mode = String(body?.modo || "").toLowerCase();

    if (!userId || !contentId) return out({ ok: false, error: "content_id obrigatório." }, 400);
    if (!["video", "post"].includes(mode)) return out({ ok: false, error: "modo deve ser video ou post." }, 400);

    const { data: content, error: ce } = await db
      .from("contents")
      .select("id,user_id,offer_id,titulo,legenda,cta,thumbnail_url,status,tipo,video_url,video_source,video_status")
      .eq("id", contentId)
      .eq("user_id", userId)
      .maybeSingle();

    if (ce) throw ce;
    if (!content) return out({ ok: false, error: "Conteúdo não encontrado." }, 404);

    const { data: offer, error: oe } = await db
      .from("offers")
      .select("id,video_url,video_source,imagem_url,preco_atual,preco_anterior,desconto_percentual,store_provider")
      .eq("id", content.offer_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (oe) throw oe;

    if (mode === "post") {
      await db.from("video_jobs")
        .delete()
        .eq("content_id", contentId)
        .in("status", ["pendente", "processando"]);

      const { data: updated, error } = await db.from("contents")
        .update({
          tipo: "oferta_rapida",
          video_url: null,
          video_source: null,
          video_status: "nao_solicitado",
          video_storage_path: null,
          status: "pronto",
          updated_at: new Date().toISOString()
        })
        .eq("id", contentId)
        .eq("user_id", userId)
        .select()
        .single();

      if (error) throw error;
      return out({ ok: true, modo: "post", content: updated });
    }

    const originalVideo = typeof offer?.video_url === "string" && offer.video_url.trim()
      ? offer.video_url.trim()
      : (typeof content.video_url === "string" && content.video_url.trim() ? content.video_url.trim() : null);

    // Não há renderizador de vídeo ativo no projeto. Sem vídeo original,
    // nunca criamos um job pendente que não possa ser processado.
    if (!originalVideo) {
      const image = String(offer?.imagem_url || content.thumbnail_url || "").trim();
      if (!image) {
        return out({
          ok: false,
          error: "Este produto ainda está sem imagem e não possui vídeo original. A tarefa não foi colocada na fila; a busca precisa recuperar a imagem primeiro."
        }, 409);
      }
      const { data: post, error: postError } = await db.from("contents")
        .update({
          tipo: "oferta_rapida",
          thumbnail_url: image,
          video_url: null,
          video_source: null,
          video_status: "nao_solicitado",
          video_storage_path: null,
          status: "pronto",
          updated_at: new Date().toISOString()
        })
        .eq("id", contentId)
        .eq("user_id", userId)
        .select()
        .single();
      if (postError) throw postError;
      return out({
        ok: true,
        modo: "post",
        fallback: true,
        error: "Não há vídeo original nem renderizador de vídeo ativo; o conteúdo foi mantido como post com imagem."
      });
    }

    const videoSource = offer?.video_source || content.video_source || "original";
    const videoStatus = "original_disponivel";

    const { data: updated, error: ue } = await db.from("contents")
      .update({
        tipo: "video_oferta",
        video_url: originalVideo,
        video_source: videoSource,
        video_status: videoStatus,
        status: "pronto",
        updated_at: new Date().toISOString()
      })
      .eq("id", contentId)
      .eq("user_id", userId)
      .select()
      .single();

    if (ue) throw ue;

    if (originalVideo) {
      await db.from("video_jobs").upsert({
        user_id: userId,
        offer_id: content.offer_id,
        content_id: contentId,
        status: "concluido",
        source_type: "original",
        source_video_url: originalVideo,
        output_url: originalVideo,
        dados: { origem: "set-content-mode" },
        updated_at: new Date().toISOString()
      }, { onConflict: "content_id" });
    }

    return out({ ok: true, modo: "video", video_status: videoStatus, content: updated });
  } catch (e) {
    console.error("SET-CONTENT-MODE ERRO:", e);
    return out({ ok: false, error: e?.message || "Erro interno." }, 500);
  }
});
