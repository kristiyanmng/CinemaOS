const json = (data, init = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });

async function seed(env) {
  if (!env.DB) return;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO cinemas (id,name,city,country) VALUES (?,?,?,?)"
    ).bind("BG-VT-PALACE-001","Cinema Palace","Veliko Tarnovo","BG"),

    env.DB.prepare(
      "INSERT OR IGNORE INTO halls (id,cinema_id,name,seats,status) VALUES (?,?,?,?,?)"
    ).bind("vip","BG-VT-PALACE-001","VIP Болярка",50,"IDLE"),

    env.DB.prepare(
      "INSERT OR IGNORE INTO halls (id,cinema_id,name,seats,status) VALUES (?,?,?,?,?)"
    ).bind("h2","BG-VT-PALACE-001","Hall 2",98,"IDLE"),

    env.DB.prepare(
      "INSERT OR IGNORE INTO halls (id,cinema_id,name,seats,status) VALUES (?,?,?,?,?)"
    ).bind("h3","BG-VT-PALACE-001","Hall 3",97,"IDLE")
  ]);
}

async function tableCount(env) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).first();
  return Number(row?.count ?? 0);
}

async function getMovies(env) {
  const { results } = await env.DB.prepare(`
    SELECT
      m.id,
      m.title,
      m.distributor,
      mv.id AS version_id,
      mv.version_name,
      mv.format,
      mv.audio,
      mv.language,
      mv.status
    FROM movies m
    LEFT JOIN movie_versions mv ON mv.movie_id = m.id
    ORDER BY m.created_at DESC, mv.version_name ASC
  `).all();

  const grouped = new Map();
  for (const row of results || []) {
    if (!grouped.has(row.id)) {
      grouped.set(row.id, {
        id: row.id,
        title: row.title,
        distributor: row.distributor,
        versions: []
      });
    }
    if (row.version_id) {
      grouped.get(row.id).versions.push({
        id: row.version_id,
        name: row.version_name,
        format: row.format,
        audio: row.audio,
        language: row.language,
        status: row.status
      });
    }
  }
  return [...grouped.values()];
}

async function getHalls(env) {
  const { results } = await env.DB.prepare(`
    SELECT id, cinema_id, name, seats, status
    FROM halls
    ORDER BY CASE id WHEN 'vip' THEN 1 WHEN 'h2' THEN 2 WHEN 'h3' THEN 3 ELSE 99 END, name
  `).all();
  return results || [];
}

async function getScreenings(env) {
  const { results } = await env.DB.prepare(`
    SELECT
      s.id,
      s.starts_at,
      s.status,
      h.id AS hall_id,
      h.name AS hall_name,
      m.id AS movie_id,
      m.title AS movie_title,
      mv.id AS version_id,
      mv.version_name
    FROM screenings s
    JOIN halls h ON h.id = s.hall_id
    JOIN movie_versions mv ON mv.id = s.movie_version_id
    JOIN movies m ON m.id = mv.movie_id
    ORDER BY s.starts_at ASC
  `).all();
  return results || [];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "CinemaOS API",
        version: "0.4.0",
        database: { bound: Boolean(env.DB), tables: await tableCount(env) },
        time: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/bootstrap" && method === "GET") {
      await seed(env);
      const [cinema, halls, movies, screenings] = await Promise.all([
        env.DB.prepare("SELECT * FROM cinemas WHERE id=?").bind("BG-VT-PALACE-001").first(),
        getHalls(env),
        getMovies(env),
        getScreenings(env)
      ]);
      return json({
        cinema,
        halls,
        movies,
        screenings,
        system: {
          apiVersion: "0.4.0",
          storageMode: "central",
          agentStatus: "demo",
          database: "D1"
        }
      });
    }

    if (url.pathname === "/api/movies" && method === "GET") {
      return json(await getMovies(env));
    }

    if (url.pathname === "/api/movies" && method === "POST") {
      const body = await request.json();
      const title = String(body.title || "").trim();
      if (!title) return json({ error: "Movie title is required" }, { status: 400 });

      const movieId = crypto.randomUUID();
      const versionId = crypto.randomUUID();

      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO movies (id,title,distributor) VALUES (?,?,?)"
        ).bind(movieId, title, body.distributor || null),

        env.DB.prepare(
          "INSERT INTO movie_versions (id,movie_id,version_name,format,audio,language,status) VALUES (?,?,?,?,?,?,?)"
        ).bind(
          versionId,
          movieId,
          String(body.version || "Original"),
          String(body.format || "DCP"),
          String(body.audio || "Unknown"),
          String(body.language || ""),
          "READY"
        )
      ]);

      return json({ ok: true, movieId, versionId }, { status: 201 });
    }

    if (url.pathname.startsWith("/api/movies/") && method === "DELETE") {
      const movieId = decodeURIComponent(url.pathname.split("/").pop());
      const versionRows = await env.DB.prepare(
        "SELECT id FROM movie_versions WHERE movie_id=?"
      ).bind(movieId).all();

      for (const row of versionRows.results || []) {
        await env.DB.prepare(
          "DELETE FROM screenings WHERE movie_version_id=?"
        ).bind(row.id).run();
      }
      await env.DB.prepare("DELETE FROM movie_versions WHERE movie_id=?").bind(movieId).run();
      await env.DB.prepare("DELETE FROM movies WHERE id=?").bind(movieId).run();

      return json({ ok: true });
    }

    if (url.pathname === "/api/halls" && method === "GET") {
      await seed(env);
      return json(await getHalls(env));
    }

    if (url.pathname === "/api/screenings" && method === "GET") {
      return json(await getScreenings(env));
    }

    if (url.pathname === "/api/screenings" && method === "POST") {
      const body = await request.json();
      if (!body.hallId || !body.versionId || !body.startsAt) {
        return json({ error: "hallId, versionId and startsAt are required" }, { status: 400 });
      }

      const conflict = await env.DB.prepare(
        "SELECT id FROM screenings WHERE hall_id=? AND starts_at=? LIMIT 1"
      ).bind(body.hallId, body.startsAt).first();

      if (conflict) {
        return json({ error: "A screening already exists in this hall at that time." }, { status: 409 });
      }

      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO screenings (id,hall_id,movie_version_id,starts_at,status) VALUES (?,?,?,?,?)"
      ).bind(id, body.hallId, body.versionId, body.startsAt, "SCHEDULED").run();

      return json({ ok: true, id }, { status: 201 });
    }

    if (url.pathname === "/api/db-status") {
      return json({
        bound: Boolean(env.DB),
        tables: await tableCount(env),
        ready: Boolean(env.DB) && (await tableCount(env)) >= 5
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
