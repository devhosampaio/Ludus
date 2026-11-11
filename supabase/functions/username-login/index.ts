import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://devhosampaio.github.io",
  "http://localhost:5173",
]);

function response(data: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  if (!allowedOrigins.has(origin)) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
      },
    });
  }
  if (req.method !== "POST") return response({ error: "Método não permitido." }, 405, origin);

  try {
    const body = await req.json();
    const username = String(body?.username ?? "").trim().replace(/^@/, "");
    const password = String(body?.password ?? "");
    // Permite nomes antigos com até 24 caracteres; novos cadastros usam até 16.
    if (!/^[A-Za-z0-9._-]{3,24}$/.test(username) || password.length < 6 || password.length > 128) {
      return response({ error: "Usuário ou senha incorretos." }, 400, origin);
    }

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    const secretKey = secretKeys.default;
    const publishableKey = publishableKeys.default;
    if (!url || !secretKey || !publishableKey) {
      return response({ error: "O serviço de autenticação está indisponível." }, 503, origin);
    }

    const admin = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .maybeSingle();

    if (profileError || !profile) {
      return response({ error: "Usuário ou senha incorretos." }, 401, origin);
    }

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
    const email = userData?.user?.email;
    if (userError || !email) {
      return response({ error: "Usuário ou senha incorretos." }, 401, origin);
    }

    const authClient = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return response({ error: "Usuário ou senha incorretos." }, 401, origin);
    }

    return response({ session: data.session }, 200, origin);
  } catch (error) {
    console.error("[username-login]", error instanceof Error ? error.message : "unknown");
    return response({ error: "Não foi possível entrar agora. Tente novamente." }, 500, origin);
  }
});
