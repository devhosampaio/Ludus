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

function releaseYearFromDate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  let timestamp = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(timestamp)) {
    const parsed = Date.parse(String(value));
    if (!Number.isFinite(parsed)) return null;
    timestamp = parsed / 1000;
  } else if (timestamp > 100000000000) {
    timestamp /= 1000;
  }
  const year = new Date(timestamp * 1000).getUTCFullYear();
  return Number.isInteger(year) && year >= 1970 && year <= 2100 ? year : null;
}

async function fetchGameReleaseYear(gameId: number, apiKey: string): Promise<number | null> {
  const response = await fetch(
    `https://www.steamgriddb.com/api/v2/games/id/${gameId}`,
    { headers: { Authorization: "Bearer " + apiKey } },
  );
  if (!response.ok) return null;
  const result = await response.json();
  const details = Array.isArray(result.data) ? result.data[0] : result.data;
  return releaseYearFromDate(details?.release_date);
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

    if (action === "sync_years") {
      const gameIds = [...new Set((Array.isArray(body.game_ids) ? body.game_ids : [])
        .map((id: unknown) => Number(id))
        .filter((id: number) => Number.isSafeInteger(id) && id > 0))].slice(0, 50);
      if (!gameIds.length) return json({ games: [] });

      const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
      const secretKey = secretKeys.default;
      if (!secretKey) return json({ error: "Configuração segura do banco indisponível." }, 500);
      const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: rows, error: rowsError } = await admin.from("games")
        .select("id, steamgriddb_id")
        .in("steamgriddb_id", gameIds)
        .is("release_year", null);
      if (rowsError) return json({ error: "Não foi possível consultar os jogos sem ano." }, 500);

      const updatedGames = await Promise.all((rows || []).map(async (game: { id: string; steamgriddb_id: number }) => {
        try {
          const year = await fetchGameReleaseYear(Number(game.steamgriddb_id), apiKey);
          if (!year) return null;
          const { error: updateError } = await admin.from("games")
            .update({ release_year: year })
            .eq("id", game.id)
            .is("release_year", null);
          if (updateError) return null;
          return { steamgriddb_id: game.steamgriddb_id, release_year: year };
        } catch (metadataError) {
          console.warn("[steamgriddb] Não foi possível sincronizar o ano:", game.steamgriddb_id);
          return null;
        }
      }));
      return json({ games: updatedGames.filter(Boolean) });
    }

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
      const withArtwork = await Promise.all(games.map(async (game: { id: number; name: string; release_date?: number }) => {
        let coverUrl: string | null = null;
        try {
          const artworkResponse = await fetch(
            `https://www.steamgriddb.com/api/v2/grids/game/${game.id}?dimensions=600x900&types=static&limit=1`,
            { headers: { Authorization: "Bearer " + apiKey } },
          );
          if (artworkResponse.ok) {
            const artwork = await artworkResponse.json();
            coverUrl = artwork.data?.[0]?.thumb ?? artwork.data?.[0]?.url ?? null;
          }
        } catch (artworkError) {
          console.warn("[steamgriddb] Não foi possível carregar a capa:", game.id);
        }
        let releaseYear = releaseYearFromDate(game.release_date);
        if (!releaseYear) {
          try { releaseYear = await fetchGameReleaseYear(Number(game.id), apiKey); }
          catch (metadataError) { console.warn("[steamgriddb] Não foi possível obter o ano:", game.id); }
        }
        return { ...game, cover_url: coverUrl, release_year: releaseYear };
      }));
      return json({ data: withArtwork });
    }

    if (action === "save") {
      const gameId = Number(body.game?.id);
      const title = String(body.game?.name ?? "").trim().slice(0, 180);
      let releaseYear = releaseYearFromDate(body.game?.release_year);
      if (!releaseYear) {
        try { releaseYear = await fetchGameReleaseYear(gameId, apiKey); }
        catch (metadataError) { console.warn("[steamgriddb] Não foi possível obter o ano ao salvar:", gameId); }
      }
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
        release_year: releaseYear,
      }, { onConflict: "steamgriddb_id" }).select("id, steamgriddb_id, slug, title, cover_url, release_year").single();

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
