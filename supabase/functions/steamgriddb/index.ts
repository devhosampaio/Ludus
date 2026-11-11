import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const apiKey = Deno.env.get("STEAMGRIDDB_API_KEY");
    if (!apiKey) return json({ error: "A integração com a SteamGridDB ainda não foi configurada." }, 503);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Sessão não encontrada." }, 401);

    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    const publishableKey = publishableKeys.default;
    if (!publishableKey) return json({ error: "Configuração do Supabase incompleta." }, 500);

    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authHeader.slice(7);
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Sua sessão expirou. Entre novamente." }, 401);

    const body = await req.json();
    const action = body?.action;

    if (action === "search") {
      const query = String(body.query ?? "").trim().slice(0, 80);
      if (query.length < 2) return json({ data: [] });
      const response = await fetch(
        "https://www.steamgriddb.com/api/v2/search/autocomplete/" + encodeURIComponent(query),
        { headers: { Authorization: "Bearer " + apiKey } },
      );
      if (!response.ok) {
        return json({ error: response.status === 401 ? "A chave da SteamGridDB é inválida." : "A SteamGridDB não respondeu à busca." }, 502);
      }
      const result = await response.json();
      const games = Array.isArray(result.data) ? result.data.slice(0, 8) : [];
      return json({ data: games });
    }

    if (action === "save") {
      const gameId = Number(body.game?.id);
      const title = String(body.game?.name ?? "").trim().slice(0, 180);
      if (!Number.isSafeInteger(gameId) || gameId <= 0 || !title) {
        return json({ error: "Jogo inválido." }, 400);
      }

      const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
      const secretKey = secretKeys.default;
      if (!secretKey) return json({ error: "Configuração segura do banco indisponível." }, 500);

      const artworkResponse = await fetch(
        `https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=600x900&types=static&limit=1`,
        { headers: { Authorization: "Bearer " + apiKey } },
      );
      let coverUrl: string | null = null;
      if (artworkResponse.ok) {
        const artwork = await artworkResponse.json();
        coverUrl = artwork.data?.[0]?.url ?? null;
      }

      const slugBase = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "jogo";
      const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: savedGame, error: saveError } = await admin.from("games").upsert({
        steamgriddb_id: gameId,
        slug: `${slugBase}-${gameId}`,
        title,
        cover_url: coverUrl,
      }, { onConflict: "steamgriddb_id" }).select("id, steamgriddb_id, slug, title, cover_url").single();

      if (saveError) {
        console.error("[steamgriddb] Não foi possível salvar o jogo:", saveError.message);
        return json({ error: "Não foi possível preparar esse jogo para avaliação." }, 500);
      }
      return json({ game: savedGame });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    console.error("[steamgriddb] Erro:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Não foi possível concluir a solicitação agora." }, 500);
  }
});
