import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_PUBLISHABLE_KEYS = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
const SUPABASE_SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const PUBLISHABLE_KEY = SUPABASE_PUBLISHABLE_KEYS.default || Deno.env.get("SUPABASE_ANON_KEY") || "";
const SECRET_KEY = SUPABASE_SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CLIENT_KEY = Deno.env.get("TIKTOK_CLIENT_KEY") || "";
const CLIENT_SECRET = Deno.env.get("TIKTOK_CLIENT_SECRET") || "";
const REDIRECT_URI = "https://ytymdncyaynmypiodhfc.supabase.co/functions/v1/tiktok-oauth";
const APP_URL = "https://taisse704.github.io/robo-de-ofertas/";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function redirectToApp(status: string, message = "") {
  const url = new URL(APP_URL);
  url.searchParams.set("tiktok", status);
  if (message) url.searchParams.set("message", message.slice(0, 300));
  return Response.redirect(url.toString(), 302);
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

async function getUser(req: Request) {
  const token = getBearer(req);
  if (!token || !PUBLISHABLE_KEY) return null;
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function requireConfig() {
  if (!CLIENT_KEY || !CLIENT_SECRET) {
    throw new Error("TikTok ainda não está configurado no Supabase. Cadastre TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || (url.searchParams.has("code") || url.searchParams.has("error") ? "callback" : "start");

  try {
    if (action === "start") {
      requireConfig();
      const user = await getUser(req);
      if (!user) return json({ ok: false, error: "Sessão inválida. Faça login novamente." }, 401);

      const admin = createClient(SUPABASE_URL, SECRET_KEY);
      const state = randomState();
      const stateHash = await sha256(state);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await admin.from("tiktok_oauth_states").delete().lt("expires_at", new Date().toISOString());
      const { error: stateError } = await admin.from("tiktok_oauth_states").insert({
        user_id: user.id,
        state_hash: stateHash,
        expires_at: expiresAt
      });
      if (stateError) throw stateError;

      const existingChannel = await admin.from("publication_channels")
        .select("id")
        .eq("user_id", user.id)
        .eq("tipo", "tiktok")
        .maybeSingle();
      if (existingChannel.data?.id) {
        await admin.from("publication_channels").update({
          nome: "TikTok",
          ativo: false,
          configuracao: { provider: "tiktok", conectado: false, requires_official_oauth: true },
          updated_at: new Date().toISOString()
        }).eq("id", existingChannel.data.id);
      } else {
        await admin.from("publication_channels").insert({
          user_id: user.id,
          tipo: "tiktok",
          nome: "TikTok",
          ativo: false,
          configuracao: { provider: "tiktok", conectado: false, requires_official_oauth: true }
        });
      }

      const channel = await admin.from("channel_accounts").select("id").eq("user_id", user.id).eq("canal", "tiktok").maybeSingle();
      if (channel.data?.id) {
        await admin.from("channel_accounts").update({
          status: "aguardando_autorizacao",
          updated_at: new Date().toISOString()
        }).eq("id", channel.data.id);
      } else {
        await admin.from("channel_accounts").insert({
          user_id: user.id,
          canal: "tiktok",
          status: "aguardando_autorizacao",
          configuracao: { provider: "tiktok" }
        });
      }

      const authorize = new URL("https://www.tiktok.com/v2/auth/authorize/");
      authorize.searchParams.set("client_key", CLIENT_KEY);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("scope", "video.publish");
      authorize.searchParams.set("redirect_uri", REDIRECT_URI);
      authorize.searchParams.set("state", state);

      return json({ ok: true, authorization_url: authorize.toString() });
    }

    if (action === "callback") {
      requireConfig();
      const error = url.searchParams.get("error");
      if (error) {
        return redirectToApp("error", url.searchParams.get("error_description") || error);
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) return redirectToApp("error", "Retorno do TikTok incompleto.");

      const admin = createClient(SUPABASE_URL, SECRET_KEY);
      const stateHash = await sha256(state);
      const { data: stateRow, error: stateError } = await admin
        .from("tiktok_oauth_states")
        .select("id,user_id,expires_at")
        .eq("state_hash", stateHash)
        .maybeSingle();

      if (stateError || !stateRow || new Date(stateRow.expires_at).getTime() < Date.now()) {
        return redirectToApp("error", "Estado OAuth inválido ou expirado.");
      }

      await admin.from("tiktok_oauth_states").delete().eq("id", stateRow.id);

      const body = new URLSearchParams({
        client_key: CLIENT_KEY,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI
      });

      const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
        body
      });
      const token = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !token.access_token || !token.refresh_token) {
        console.error("TikTok token error", token);
        return redirectToApp("error", token.error_description || token.error || "Não foi possível obter o token do TikTok.");
      }

      const expiresAt = new Date(Date.now() + Number(token.expires_in || 86400) * 1000).toISOString();
      const refreshExpiresAt = new Date(Date.now() + Number(token.refresh_expires_in || 31536000) * 1000).toISOString();

      const { error: tokenError } = await admin.from("tiktok_tokens").upsert({
        user_id: stateRow.user_id,
        open_id: token.open_id || null,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: expiresAt,
        refresh_expires_at: refreshExpiresAt,
        scopes: token.scope || "",
        token_type: token.token_type || "Bearer",
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" });
      if (tokenError) throw tokenError;

      const account = await admin.from("channel_accounts").select("id").eq("user_id", stateRow.user_id).eq("canal", "tiktok").maybeSingle();
      const accountConfig = {
        provider: "tiktok",
        conectado: true,
        open_id: token.open_id || null,
        scopes: token.scope || "",
        expires_at: expiresAt,
        refresh_expires_at: refreshExpiresAt
      };
      if (account.data?.id) {
        await admin.from("channel_accounts").update({
          status: "conectada",
          configuracao: accountConfig,
          updated_at: new Date().toISOString()
        }).eq("id", account.data.id);
      } else {
        await admin.from("channel_accounts").insert({
          user_id: stateRow.user_id,
          canal: "tiktok",
          status: "conectada",
          configuracao: accountConfig
        });
      }

      const callbackChannel = await admin.from("publication_channels")
        .select("id")
        .eq("user_id", stateRow.user_id)
        .eq("tipo", "tiktok")
        .maybeSingle();
      if (callbackChannel.data?.id) {
        await admin.from("publication_channels").update({
          nome: "TikTok",
          ativo: true,
          configuracao: { provider: "tiktok", conectado: true },
          updated_at: new Date().toISOString()
        }).eq("id", callbackChannel.data.id);
      } else {
        await admin.from("publication_channels").insert({
          user_id: stateRow.user_id,
          tipo: "tiktok",
          nome: "TikTok",
          ativo: true,
          configuracao: { provider: "tiktok", conectado: true }
        });
      }

      return redirectToApp("success");
    }

    return json({ ok: false, error: "Ação inválida." }, 400);
  } catch (error) {
    console.error("TIKTOK OAUTH:", error);
    if (action === "callback") return redirectToApp("error", error instanceof Error ? error.message : "Erro OAuth.");
    return json({ ok: false, error: error instanceof Error ? error.message : "Erro OAuth." }, 500);
  }
});
