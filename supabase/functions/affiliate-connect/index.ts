import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return json({});
  }

  try {
    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return json({ ok: false, error: "Usuário não autenticado." }, 401);
    }

    const token = authorization.startsWith("Bearer ")
      ? authorization.substring(7).trim()
      : authorization.trim();

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const userResult = await supabase.auth.getUser();

    if (userResult.error || !userResult.data.user) {
      return json({ ok: false, error: "Sessão inválida ou expirada." }, 401);
    }

    const user = userResult.data.user;
    const body = await req.json().catch(() => ({}));

    const provider = String(body?.provider || "").toLowerCase();
    const action = String(body?.action || "status").toLowerCase();

    if (!provider) {
      return json({ ok: false, error: "Parâmetro provider é obrigatório." }, 400);
    }

    const nomePlataforma = provider === "mercadolivre" ? "Mercado Livre" : provider;

    const platformResult = await admin
      .from("platforms")
      .select("id,nome,tipo,ativo")
      .ilike("nome", nomePlataforma)
      .maybeSingle();

    if (platformResult.error || !platformResult.data) {
      return json({ ok: false, error: `Plataforma ${nomePlataforma} não encontrada.` }, 404);
    }

    const platform = platformResult.data;

    // AÇÃO: DESCONECTAR CONTA
    if (action === "disconnect") {
      const updateResult = await admin
        .from("affiliate_accounts")
        .update({
          status: "desconectada",
          ativo: false,
          configuracao: {},
          updated_at: new Date().toISOString()
        })
        .eq("user_id", user.id)
        .eq("platform_id", platform.id);

      if (updateResult.error) {
        return json({ ok: false, error: updateResult.error.message }, 500);
      }

      await admin.from("logs").insert({
        user_id: user.id,
        tipo: "affiliate-connect",
        nivel: "info",
        mensagem: `Conta ${nomePlataforma} desconectada com sucesso.`
      });

      return json({
        ok: true,
        message: `Conta ${nomePlataforma} desconectada com sucesso.`,
        status: "desconectada"
      });
    }

    // AÇÃO: OBTER URL DE CONEXÃO
    if (action === "connect_url") {
      const redirectUri = `${SUPABASE_URL}/functions/v1/mercadolivre-oauth`;
      return json({
        ok: true,
        redirect_url: redirectUri
      });
    }

    // CONSULTAR STATUS DA CONTA
    const accountResult = await admin
      .from("affiliate_accounts")
      .select("id, status, configuracao, updated_at")
      .eq("user_id", user.id)
      .eq("platform_id", platform.id)
      .maybeSingle();

    return json({
      ok: true,
      provider,
      status: accountResult.data?.status || "desconectada",
      connected: accountResult.data?.status === "conectada"
    });

  } catch (error) {
    console.error("ERRO AFFILIATE-CONNECT:", error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erro interno ao processar conexão."
      },
      500
    );
  }
});