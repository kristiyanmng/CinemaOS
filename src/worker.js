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
    env.DB.prepare("INSERT OR IGNORE INTO cinemas (id,name,city,country) VALUES (?,?,?,?)")
      .bind("BG-VT-PALACE-001","Cinema Palace","Veliko Tarnovo","BG"),
    env.DB.prepare("INSERT OR IGNORE INTO halls (id,cinema_id,name,seats,status) VALUES (?,?,?,?,?)")
      .bind("vip","BG-VT-PALACE-001","VIP Болярка",50,"IDLE"),
    env.DB.prepare("INSERT OR IGNORE INTO halls (id,cinema_id,name,seats,status) VALUES (?,?,?,?,?)")
      .bind("h2","BG-VT-PALACE-001","Hall 2",98,"IDLE"),
    env.DB.prepare("INSERT OR IGNORE INTO halls (id,cinema_id,name,seats,status) VALUES (?,?,?,?,?)")
      .bind("h3","BG-VT-PALACE-001","Hall 3",97,"IDLE")
  ]);
}

async function ensurePlaylistSchema(env) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      screening_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (screening_id) REFERENCES screenings(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS playlist_items (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      title TEXT NOT NULL,
      source_ref TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      cue_json TEXT,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    )`
  ];

  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
}

async function getPlaylists(env) {
  const { results } = await env.DB.prepare(`
    SELECT p.id,p.screening_id,p.name,p.created_at,
           s.starts_at,h.name AS hall_name,m.title AS movie_title,mv.version_name
    FROM playlists p
    JOIN screenings s ON s.id=p.screening_id
    JOIN halls h ON h.id=s.hall_id
    JOIN movie_versions mv ON mv.id=s.movie_version_id
    JOIN movies m ON m.id=mv.movie_id
    ORDER BY s.starts_at ASC
  `).all();

  for (const p of results || []) {
    const items = await env.DB.prepare(
      "SELECT id,playlist_id,position,item_type,title,source_ref,duration_seconds,cue_json FROM playlist_items WHERE playlist_id=? ORDER BY position ASC"
    ).bind(p.id).all();
    p.items = items.results || [];
  }
  return results || [];
}

async function ensureContentSchema(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS content_assets (
      id TEXT PRIMARY KEY,
      cinema_id TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      title TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      format TEXT,
      language TEXT,
      status TEXT NOT NULL DEFAULT 'READY',
      storage_ref TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cinema_id) REFERENCES cinemas(id) ON DELETE CASCADE
    )
  `).run();
}

async function getContentAssets(env) {
  await ensureContentSchema(env);
  const { results } = await env.DB.prepare(
    "SELECT id,cinema_id,asset_type,title,duration_seconds,format,language,status,storage_ref,created_at FROM content_assets ORDER BY created_at DESC"
  ).all();
  return results || [];
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
    SELECT m.id,m.title,m.distributor,
           mv.id AS version_id,mv.version_name,mv.format,mv.audio,mv.language,mv.status
    FROM movies m
    LEFT JOIN movie_versions mv ON mv.movie_id=m.id
    ORDER BY m.created_at DESC,mv.version_name ASC
  `).all();

  const grouped = new Map();
  for (const row of results || []) {
    if (!grouped.has(row.id)) {
      grouped.set(row.id,{id:row.id,title:row.title,distributor:row.distributor,versions:[]});
    }
    if (row.version_id) {
      grouped.get(row.id).versions.push({
        id:row.version_id,name:row.version_name,format:row.format,
        audio:row.audio,language:row.language,status:row.status
      });
    }
  }
  return [...grouped.values()];
}

async function getHalls(env) {
  const { results } = await env.DB.prepare(
    "SELECT id,cinema_id,name,seats,status FROM halls ORDER BY name"
  ).all();
  return results || [];
}

async function getScreenings(env) {
  const { results } = await env.DB.prepare(`
    SELECT s.id,s.starts_at,s.status,
           h.id AS hall_id,h.name AS hall_name,
           m.id AS movie_id,m.title AS movie_title,
           mv.id AS version_id,mv.version_name
    FROM screenings s
    JOIN halls h ON h.id=s.hall_id
    JOIN movie_versions mv ON mv.id=s.movie_version_id
    JOIN movies m ON m.id=mv.movie_id
    ORDER BY s.starts_at ASC
  `).all();
  return results || [];
}

export default {
  async fetch(request, env) {
    try {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    await seed(env);

    if (url.pathname === "/api/health") {
      return json({
        ok:true,service:"CinemaOS API",version:"0.9.0",
        database:{bound:Boolean(env.DB),tables:await tableCount(env)},
        time:new Date().toISOString()
      });
    }

    if (url.pathname === "/api/bootstrap" && method === "GET") {
      const [cinema,halls,movies,screenings] = await Promise.all([
        env.DB.prepare("SELECT * FROM cinemas WHERE id=?").bind("BG-VT-PALACE-001").first(),
        getHalls(env),getMovies(env),getScreenings(env)
      ]);
      return json({
        cinema,halls,movies,screenings,
        system:{apiVersion:"0.9.0",storageMode:"central",agentStatus:"demo",database:"D1"}
      });
    }

    if (url.pathname === "/api/movies" && method === "GET") return json(await getMovies(env));

    if (url.pathname === "/api/movies" && method === "POST") {
      const body = await request.json();
      const title = String(body.title || "").trim();
      if (!title) return json({error:"Movie title is required"},{status:400});
      const movieId=crypto.randomUUID(), versionId=crypto.randomUUID();
      try {
        await env.DB.prepare(
          "INSERT INTO movies (id,title,distributor) VALUES (?,?,?)"
        ).bind(movieId,title,body.distributor||null).run();

        await env.DB.prepare(
          "INSERT INTO movie_versions (id,movie_id,version_name,format,audio,language,status) VALUES (?,?,?,?,?,?,?)"
        ).bind(
          versionId,movieId,String(body.version||"Original"),String(body.format||"DCP"),
          String(body.audio||"Unknown"),String(body.language||""),"READY"
        ).run();

        return json({ok:true,movieId,versionId},{status:201});
      } catch (err) {
        try {
          await env.DB.prepare("DELETE FROM movies WHERE id=?").bind(movieId).run();
        } catch {}
        return json({
          error:"Could not save movie",
          detail:String(err?.message || err)
        },{status:500});
      }
    }

    if (/^\/api\/movies\/[^/]+\/versions$/.test(url.pathname) && method === "POST") {
      const parts=url.pathname.split("/");
      const movieId=decodeURIComponent(parts[3]);
      const exists=await env.DB.prepare("SELECT id FROM movies WHERE id=?").bind(movieId).first();
      if(!exists) return json({error:"Movie not found"},{status:404});
      const body=await request.json();
      const id=crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO movie_versions (id,movie_id,version_name,format,audio,language,status) VALUES (?,?,?,?,?,?,?)"
      ).bind(
        id,movieId,String(body.version||"Original"),String(body.format||"DCP"),
        String(body.audio||"Unknown"),String(body.language||""),"READY"
      ).run();
      return json({ok:true,id},{status:201});
    }

    if (url.pathname.startsWith("/api/movies/") && method === "DELETE") {
      const movieId=decodeURIComponent(url.pathname.split("/").pop());
      const versions=await env.DB.prepare("SELECT id FROM movie_versions WHERE movie_id=?").bind(movieId).all();
      for(const row of versions.results||[]){
        await env.DB.prepare("DELETE FROM screenings WHERE movie_version_id=?").bind(row.id).run();
      }
      await env.DB.prepare("DELETE FROM movie_versions WHERE movie_id=?").bind(movieId).run();
      await env.DB.prepare("DELETE FROM movies WHERE id=?").bind(movieId).run();
      return json({ok:true});
    }

    if (url.pathname === "/api/halls" && method === "GET") return json(await getHalls(env));

    if (url.pathname === "/api/halls" && method === "POST") {
      const body=await request.json();
      const name=String(body.name||"").trim();
      const seats=Number(body.seats||0);
      if(!name) return json({error:"Hall name is required"},{status:400});
      const id=crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO halls (id,cinema_id,name,seats,status) VALUES (?,?,?,?,?)"
      ).bind(id,"BG-VT-PALACE-001",name,seats,"IDLE").run();
      return json({ok:true,id},{status:201});
    }

    if (url.pathname.startsWith("/api/halls/") && method === "PUT") {
      const id=decodeURIComponent(url.pathname.split("/").pop());
      const body=await request.json();
      await env.DB.prepare("UPDATE halls SET name=?,seats=?,status=? WHERE id=?")
        .bind(String(body.name||""),Number(body.seats||0),String(body.status||"IDLE"),id).run();
      return json({ok:true});
    }

    if (url.pathname.startsWith("/api/halls/") && method === "DELETE") {
      const id=decodeURIComponent(url.pathname.split("/").pop());
      const used=await env.DB.prepare("SELECT id FROM screenings WHERE hall_id=? LIMIT 1").bind(id).first();
      if(used) return json({error:"Hall has screenings and cannot be deleted yet."},{status:409});
      await env.DB.prepare("DELETE FROM halls WHERE id=?").bind(id).run();
      return json({ok:true});
    }

    if (url.pathname === "/api/screenings" && method === "GET") return json(await getScreenings(env));

    if (url.pathname === "/api/screenings" && method === "POST") {
      const body=await request.json();
      if(!body.hallId||!body.versionId||!body.startsAt){
        return json({error:"hallId, versionId and startsAt are required"},{status:400});
      }
      const conflict=await env.DB.prepare(
        "SELECT id FROM screenings WHERE hall_id=? AND starts_at=? LIMIT 1"
      ).bind(body.hallId,body.startsAt).first();
      if(conflict) return json({error:"A screening already exists in this hall at that time."},{status:409});
      const id=crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO screenings (id,hall_id,movie_version_id,starts_at,status) VALUES (?,?,?,?,?)"
      ).bind(id,body.hallId,body.versionId,body.startsAt,"SCHEDULED").run();
      return json({ok:true,id},{status:201});
    }

    if (url.pathname.startsWith("/api/screenings/") && method === "DELETE") {
      const id=decodeURIComponent(url.pathname.split("/").pop());
      await env.DB.prepare("DELETE FROM screenings WHERE id=?").bind(id).run();
      return json({ok:true});
    }

    if (url.pathname === "/api/storage/status" && method === "GET") {
      return json({
        configured: Boolean(env.CONTENT),
        provider: "Cloudflare R2",
        bucketBinding: "CONTENT"
      });
    }

    if (url.pathname === "/api/storage/upload" && method === "POST") {
      if (!env.CONTENT) return json({
        error:"R2 storage is not configured yet",
        detail:"Create an R2 bucket and bind it as CONTENT."
      },{status:503});

      const contentType=request.headers.get("content-type")||"application/octet-stream";
      const assetType=(url.searchParams.get("type")||"OTHER").toUpperCase();
      const title=(url.searchParams.get("title")||"upload").trim();
      const fileName=(url.searchParams.get("filename")||"file.bin").replace(/[^a-zA-Z0-9._-]/g,"_");
      const assetId=crypto.randomUUID();
      const key="cinema/BG-VT-PALACE-001/"+assetType.toLowerCase()+"/"+assetId+"/"+fileName;

      await env.CONTENT.put(key, request.body, {
        httpMetadata:{contentType},
        customMetadata:{assetId,assetType,title}
      });

      return json({ok:true,key,assetId},{status:201});
    }

    if (url.pathname.startsWith("/api/storage/object/") && method === "GET") {
      if (!env.CONTENT) return json({error:"R2 storage is not configured yet"},{status:503});
      const key=decodeURIComponent(url.pathname.replace("/api/storage/object/",""));
      const object=await env.CONTENT.get(key);
      if(!object) return json({error:"Object not found"},{status:404});
      const headers=new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag",object.httpEtag);
      headers.set("cache-control","private, max-age=0, no-store");
      return new Response(object.body,{headers});
    }

    if (url.pathname.startsWith("/api/storage/object/") && method === "DELETE") {
      if (!env.CONTENT) return json({error:"R2 storage is not configured yet"},{status:503});
      const key=decodeURIComponent(url.pathname.replace("/api/storage/object/",""));
      await env.CONTENT.delete(key);
      return json({ok:true});
    }

    if (url.pathname === "/api/content-assets" && method === "GET") {
      return json(await getContentAssets(env));
    }

    if (url.pathname === "/api/content-assets" && method === "POST") {
      await ensureContentSchema(env);
      const body=await request.json();
      const title=String(body.title||"").trim();
      const assetType=String(body.assetType||"OTHER").toUpperCase();
      if(!title) return json({error:"Content title is required"},{status:400});
      if(!["AD","TRAILER","OTHER"].includes(assetType)) return json({error:"Invalid content type"},{status:400});

      const id=crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO content_assets (id,cinema_id,asset_type,title,duration_seconds,format,language,status,storage_ref) VALUES (?,?,?,?,?,?,?,?,?)"
      ).bind(
        id,"BG-VT-PALACE-001",assetType,title,Number(body.durationSeconds||0),
        String(body.format||"DCP"),String(body.language||""),"READY",body.storageRef||null
      ).run();

      return json({ok:true,id},{status:201});
    }

    if (url.pathname.startsWith("/api/content-assets/") && method === "PUT") {
      await ensureContentSchema(env);
      const id=decodeURIComponent(url.pathname.split("/").pop());
      const body=await request.json();
      await env.DB.prepare(
        "UPDATE content_assets SET asset_type=?,title=?,duration_seconds=?,format=?,language=?,status=? WHERE id=?"
      ).bind(
        String(body.assetType||"OTHER").toUpperCase(),
        String(body.title||"").trim(),
        Number(body.durationSeconds||0),
        String(body.format||"DCP"),
        String(body.language||""),
        String(body.status||"READY"),
        id
      ).run();
      return json({ok:true});
    }

    if (url.pathname.startsWith("/api/content-assets/") && method === "DELETE") {
      await ensureContentSchema(env);
      const id=decodeURIComponent(url.pathname.split("/").pop());
      const asset=await env.DB.prepare("SELECT storage_ref FROM content_assets WHERE id=?").bind(id).first();
      await env.DB.prepare("UPDATE playlist_items SET source_ref=NULL WHERE source_ref=?").bind(id).run().catch(()=>{});
      await env.DB.prepare("DELETE FROM content_assets WHERE id=?").bind(id).run();
      if (asset?.storage_ref && env.CONTENT) {
        await env.CONTENT.delete(asset.storage_ref).catch(()=>{});
      }
      return json({ok:true});
    }

    if (url.pathname === "/api/playlists" && method === "GET") {
      await ensurePlaylistSchema(env);
      return json(await getPlaylists(env));
    }

    if (url.pathname === "/api/playlists" && method === "POST") {
      await ensurePlaylistSchema(env);
      const body = await request.json();
      if (!body.screeningId) return json({error:"screeningId is required"},{status:400});

      const exists = await env.DB.prepare("SELECT id FROM playlists WHERE screening_id=?").bind(body.screeningId).first();
      if (exists) return json({error:"This screening already has a playlist."},{status:409});

      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO playlists (id,screening_id,name) VALUES (?,?,?)"
      ).bind(id,body.screeningId,String(body.name||"Show Playlist")).run();

      const screening = await env.DB.prepare(`
        SELECT m.title,mv.version_name
        FROM screenings s
        JOIN movie_versions mv ON mv.id=s.movie_version_id
        JOIN movies m ON m.id=mv.movie_id
        WHERE s.id=?
      `).bind(body.screeningId).first();

      if (screening) {
        await env.DB.prepare(
          "INSERT INTO playlist_items (id,playlist_id,position,item_type,title,source_ref,duration_seconds,cue_json) VALUES (?,?,?,?,?,?,?,?)"
        ).bind(
          crypto.randomUUID(),id,100,"MOVIE",
          screening.title+" — "+screening.version_name,
          body.movieVersionId||null,0,
          JSON.stringify({lights:0})
        ).run();
      }

      return json({ok:true,id},{status:201});
    }

    if (/^\/api\/playlists\/[^/]+\/items$/.test(url.pathname) && method === "POST") {
      await ensurePlaylistSchema(env);
      const parts=url.pathname.split("/");
      const playlistId=decodeURIComponent(parts[3]);
      const body=await request.json();
      const row=await env.DB.prepare("SELECT COALESCE(MAX(position),0) AS max_pos FROM playlist_items WHERE playlist_id=?")
        .bind(playlistId).first();
      const position=Number(row?.max_pos||0)+10;
      const id=crypto.randomUUID();

      await env.DB.prepare(
        "INSERT INTO playlist_items (id,playlist_id,position,item_type,title,source_ref,duration_seconds,cue_json) VALUES (?,?,?,?,?,?,?,?)"
      ).bind(
        id,playlistId,position,String(body.itemType||"AD"),String(body.title||"Untitled"),
        body.sourceRef||null,Number(body.durationSeconds||0),
        JSON.stringify(body.cue||{})
      ).run();

      return json({ok:true,id},{status:201});
    }

    if (url.pathname.startsWith("/api/playlist-items/") && method === "PUT") {
      const id=decodeURIComponent(url.pathname.split("/").pop());
      const body=await request.json();
      await env.DB.prepare(
        "UPDATE playlist_items SET position=?,item_type=?,title=?,duration_seconds=?,cue_json=? WHERE id=?"
      ).bind(
        Number(body.position||0),String(body.itemType||"AD"),String(body.title||"Untitled"),
        Number(body.durationSeconds||0),JSON.stringify(body.cue||{}),id
      ).run();
      return json({ok:true});
    }

    if (url.pathname.startsWith("/api/playlist-items/") && method === "DELETE") {
      const id=decodeURIComponent(url.pathname.split("/").pop());
      await env.DB.prepare("DELETE FROM playlist_items WHERE id=?").bind(id).run();
      return json({ok:true});
    }

    if (url.pathname.startsWith("/api/playlists/") && method === "DELETE") {
      const id=decodeURIComponent(url.pathname.split("/").pop());
      await env.DB.prepare("DELETE FROM playlist_items WHERE playlist_id=?").bind(id).run();
      await env.DB.prepare("DELETE FROM playlists WHERE id=?").bind(id).run();
      return json({ok:true});
    }

    if (url.pathname === "/api/db-status") {
      const tables=await tableCount(env);
      return json({bound:Boolean(env.DB),tables,ready:Boolean(env.DB)&&tables>=5});
    }

    if (url.pathname.startsWith("/api/")) return json({error:"Not found"},{status:404});
    return env.ASSETS.fetch(request);
    } catch (err) {
      return json({
        error: "CinemaOS Worker error",
        detail: String(err?.message || err)
      }, { status: 500 });
    }
  }
};
