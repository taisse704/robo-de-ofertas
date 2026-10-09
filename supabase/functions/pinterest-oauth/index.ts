import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_URL = "https://taisse704.github.io/robo-de-ofertas/";
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/pinterest-oauth`;
const AUTH_URL = "https://www.pinterest.com/oauth/";
const TOKEN_URL = "https://api.pinterest.com/v5/oauth/token";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
  });

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function requireUser(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("Autorização obrigatória.");
  const token = auth.slice(7);
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new Error("Sessão inválida.");
  return { db, user: data.user };
}

function basic(clientId: string, secret: string) {
  return btoa(`${clientId}:${secret}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";

    if (action === "start") {
      const { user } = await requireUser(req);
      const clientId = Deno.env.get("PINTEREST_APP_ID") || "";
      if (!clientId) return json({ ok: false, error: "PINTEREST_APP_ID não configurado no Supabase." }, 500);

      const state = crypto.randomUUID() + "-" + crypto.randomUUID();
      const stateHash = await sha256(state);
      await db.from("pinterest_oauth_states").delete().eq("user_id", user.id);
      const { error } = await db.from("pinterest_oauth_states").insert({
        user_id: user.id,
        state_hash: stateHash,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
      if (error) throw error;

      const scopes = "boards:read,boards:write,pins:read,pins:write,user_accounts:read";
      const auth = new URL(AUTH_URL);
      auth.searchParams.set("client_id", clientId);
      auth.searchParams.set("redirect_uri", REDIRECT_URI);
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("scope", scopes);
      auth.searchParams.set("state", state);
      return json({ ok: true, authorization_url: auth.toString() });
    }

    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const errorParam = url.searchParams.get("error") || "";
    if (errorParam) {
      return Response.redirect(`${APP_URL}?pinterest=error&message=${encodeURIComponent(url.searchParams.get("error_description") || errorParam)}`, 302);
    }
    if (!code || !state) {
      return Response.redirect(`${APP_URL}?pinterest=error&message=${encodeURIComponent("Retorno do Pinterest incompleto.")}`, 302);
    }

    const stateHash = await sha256(state);
    const { data: oauthState, error: stateError } = await db
      .from("pinterest_oauth_states")
      .select("id,user_id,expires_at")
      .eq("state_hash", stateHash)
      .maybeSingle();
    if (stateError) throw stateError;
    if (!oauthState || new Date(oauthState.expires_at).getTime() < Date.now()) {
      return Response.redirect(`${APP_URL}?pinterest=error&message=${encodeURIComponent("State inválido ou expirado.")}`, 302);
    }

    const clientId = Deno.env.get("PINTEREST_APP_ID") || "";
    const clientSecret = Deno.env.get("PINTEREST_APP_SECRET") || "";
    if (!clientId || !clientSecret) {
      return Response.redirect(`${APP_URL}?pinterest=error&message=${encodeURIComponent("PINTEREST_APP_ID/PINTEREST_APP_SECRET não configurados no Supabase.")}`, 302);
    }

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basic(clientId, clientSecret)}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI
      })
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData?.access_token) {
      console.error("PINTEREST_TOKEN", tokenData);
      return Response.redirect(`${APP_URL}?pinterest=error&message=${encodeURIComponent(tokenData?.message || tokenData?.error_description || `Pinterest recusou a autorização (HTTP ${tokenResponse.status}).`)}`, 302);
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || "";
    const expiresIn = Number(tokenData.expires_in || 2592000);
    const accountResponse = await fetch("https://api.pinterest.com/v5/user_account", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const account = await accountResponse.json().catch(() => ({}));

    let boardId = "";
    const boardsResponse = await fetch("https://api.pinterest.com/v5/boards?page_size=25", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const boards = await boardsResponse.json().catch(() => ({}));
    if (boardsResponse.ok && Array.isArray(boards?.items) && boards.items.length) {
      boardId = String(boards.items[0].id || "");
    }
    if (!boardId) {
      const createBoard = await fetch("https://api.pinterest.com/v5/boards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: "Ofertas do Robô",
          description: "Ofertas e promoções selecionadas automaticamente pelo Robô de Ofertas."
        })
      });
      const board = await createBoard.json().catch(() => ({}));
      if (createBoard.ok) boardId = String(board?.id || "");
    }

    const canal = "pinterest";
    const { data: existing } = await db.from("channel_accounts").select("id").eq("user_id", oauthState.user_id).eq("canal", canal).maybeSingle();
    const configuration = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      board_id: boardId,
      board_name: "Ofertas do Robô",
      username: account?.username || "",
      account_id: account?.account_type || ""
    };
    if (existing?.id) {
      await db.from("channel_accounts").update({ status: "conectada", configuracao: configuration, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await db.from("channel_accounts").insert({ user_id: oauthState.user_id, canal, status: "conectada", configuracao: configuration });
    }

    const { data: channel } = await db.from("publication_channels").select("id").eq("user_id", oauthState.user_id).eq("tipo", canal).maybeSingle();
    if (channel?.id) {
      await db.from("publication_channels").update({
        nome: "Pinterest",
        ativo: true,
        identificador: account?.username || "",
        configuracao: { provider: "pinterest", conectado: true, board_id: boardId },
        updated_at: new Date().toISOString()
      }).eq("id", channel.id);
    } else {
      await db.from("publication_channels").insert({
        user_id: oauthState.user_id,
        tipo: canal,
        nome: "Pinterest",
        identificador: account?.username || "",
        ativo: true,
        configuracao: { provider: "pinterest", conectado: true, board_id: boardId }
      });
    }

    await db.from("pinterest_oauth_states").delete().eq("id", oauthState.id);
    return Response.redirect(`${APP_URL}?pinterest=success`, 302);
  } catch (e) {
    console.error("PINTEREST-OAUTH", e);
    return Response.redirect(`${APP_URL}?pinterest=error&message=${encodeURIComponent(e?.message || "Não foi possível conectar o Pinterest.")}`, 302);
  }
});
