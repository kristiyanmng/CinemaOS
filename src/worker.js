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
  await ensureOperationsSchema(env);
  const { results } = await env.DB.prepare(`
    SELECT ca.id,ca.cinema_id,ca.asset_type,ca.title,ca.duration_seconds,ca.format,ca.language,ca.status,ca.storage_ref,ca.created_at,
           md.cpl_id,md.annotation_text,md.edit_rate,md.duration_frames,md.runtime_seconds,md.encrypted,
           md.has_assetmap,md.has_pkl,md.has_cpl,md.package_files,md.metadata_json
    FROM content_assets ca
    LEFT JOIN content_asset_metadata md ON md.asset_id=ca.id
    ORDER BY ca.created_at DESC
  `).all();
  return results || [];
}

async function ensureSecuritySchema(env) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS device_certificates (
      id TEXT PRIMARY KEY,
      cinema_id TEXT NOT NULL,
      hall_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      manufacturer TEXT,
      model TEXT,
      serial_number TEXT,
      certificate_pem TEXT,
      fingerprint_sha256 TEXT,
      valid_from TEXT,
      valid_until TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cinema_id) REFERENCES cinemas(id) ON DELETE CASCADE,
      FOREIGN KEY (hall_id) REFERENCES halls(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS kdm_requests (
      id TEXT PRIMARY KEY,
      movie_version_id TEXT NOT NULL,
      hall_id TEXT NOT NULL,
      certificate_id TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_until TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'READY_TO_REQUEST',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_version_id) REFERENCES movie_versions(id) ON DELETE CASCADE,
      FOREIGN KEY (hall_id) REFERENCES halls(id) ON DELETE CASCADE,
      FOREIGN KEY (certificate_id) REFERENCES device_certificates(id) ON DELETE CASCADE
    )`
  ];
  for(const sql of statements) await env.DB.prepare(sql).run();
}

async function getCertificates(env) {
  await ensureSecuritySchema(env);
  const {results}=await env.DB.prepare(`
    SELECT dc.*,h.name AS hall_name
    FROM device_certificates dc
    JOIN halls h ON h.id=dc.hall_id
    ORDER BY h.name,dc.device_name
  `).all();
  return results||[];
}

async function getKdmRequests(env) {
  await ensureSecuritySchema(env);
  const {results}=await env.DB.prepare(`
    SELECT kr.*,h.name AS hall_name,dc.device_name,dc.fingerprint_sha256,
           m.title AS movie_title,mv.version_name
    FROM kdm_requests kr
    JOIN halls h ON h.id=kr.hall_id
    JOIN device_certificates dc ON dc.id=kr.certificate_id
    JOIN movie_versions mv ON mv.id=kr.movie_version_id
    JOIN movies m ON m.id=mv.movie_id
    ORDER BY kr.created_at DESC
  `).all();
  return results||[];
}

async function ensureAgentSchema(env){
  const statements=[
    `CREATE TABLE IF NOT EXISTS agent_nodes (
      id TEXT PRIMARY KEY,
      cinema_id TEXT NOT NULL,
      name TEXT NOT NULL,
      machine_name TEXT,
      version TEXT,
      token_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OFFLINE',
      last_seen_at TEXT,
      capabilities_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cinema_id) REFERENCES cinemas(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS agent_jobs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agent_nodes(id) ON DELETE CASCADE
    )`
  ];
  for(const sql of statements) await env.DB.prepare(sql).run();
}

async function sha256Hex(value){
  const bytes=new TextEncoder().encode(String(value));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function authenticateAgent(request,env){
  await ensureAgentSchema(env);
  const auth=request.headers.get("authorization")||"";
  if(!auth.startsWith("Bearer ")) return null;
  const token=auth.slice(7).trim();
  if(!token) return null;
  const hash=await sha256Hex(token);
  return await env.DB.prepare("SELECT * FROM agent_nodes WHERE token_hash=? LIMIT 1").bind(hash).first();
}

async function getAgents(env){
  await ensureAgentSchema(env);
  const {results}=await env.DB.prepare(`
    SELECT id,cinema_id,name,machine_name,version,status,last_seen_at,capabilities_json,created_at
    FROM agent_nodes ORDER BY created_at DESC
  `).all();
  return results||[];
}

async function ensureOperationsSchema(env){
  const statements=[
    `CREATE TABLE IF NOT EXISTS agent_transfers (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'UPLOAD',
      status TEXT NOT NULL DEFAULT 'QUEUED',
      progress INTEGER NOT NULL DEFAULT 0,
      bytes_done INTEGER NOT NULL DEFAULT 0,
      bytes_total INTEGER NOT NULL DEFAULT 0,
      speed_bps INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agent_nodes(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS hall_devices (
      id TEXT PRIMARY KEY,
      hall_id TEXT NOT NULL,
      device_type TEXT NOT NULL,
      manufacturer TEXT,
      model TEXT,
      name TEXT NOT NULL,
      address TEXT,
      status TEXT NOT NULL DEFAULT 'UNKNOWN',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (hall_id) REFERENCES halls(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS content_asset_metadata (
      asset_id TEXT PRIMARY KEY,
      cpl_id TEXT,
      annotation_text TEXT,
      edit_rate TEXT,
      duration_frames INTEGER,
      runtime_seconds INTEGER,
      encrypted INTEGER NOT NULL DEFAULT 0,
      has_assetmap INTEGER NOT NULL DEFAULT 0,
      has_pkl INTEGER NOT NULL DEFAULT 0,
      has_cpl INTEGER NOT NULL DEFAULT 0,
      package_files INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_id) REFERENCES content_assets(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS distributors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact_email TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS distribution_deliveries (
      id TEXT PRIMARY KEY,
      distributor_id TEXT,
      content_asset_id TEXT,
      destination_cinema_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (distributor_id) REFERENCES distributors(id) ON DELETE SET NULL,
      FOREIGN KEY (content_asset_id) REFERENCES content_assets(id) ON DELETE SET NULL,
      FOREIGN KEY (destination_cinema_id) REFERENCES cinemas(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS app_roles (
      id TEXT PRIMARY KEY,
      role_name TEXT NOT NULL UNIQUE,
      permissions_json TEXT NOT NULL
    )`
  ];
  for(const sql of statements) await env.DB.prepare(sql).run();
  const roles=[
    ["administrator","Administrator",["*"]],
    ["manager","Manager",["movies","schedule","playlists","content","reports"]],
    ["projectionist","Projectionist",["content","playlists","halls","kdm"]],
    ["technician","Technician",["halls","devices","agents"]],
    ["distributor","Distributor",["distribution","content_upload","kdm_request"]]
  ];
  for(const r of roles){
    await env.DB.prepare("INSERT OR IGNORE INTO app_roles (id,role_name,permissions_json) VALUES (?,?,?)")
      .bind(r[0],r[1],JSON.stringify(r[2])).run();
  }
}

async function getAgentTransfers(env){
  await ensureAgentSchema(env); await ensureOperationsSchema(env);
  const {results}=await env.DB.prepare(`
    SELECT t.*,a.name AS agent_name,a.machine_name
    FROM agent_transfers t JOIN agent_nodes a ON a.id=t.agent_id
    ORDER BY t.updated_at DESC
  `).all();
  return results||[];
}

async function getHallDevices(env){
  await ensureOperationsSchema(env);
  const {results}=await env.DB.prepare(`
    SELECT d.*,h.name AS hall_name FROM hall_devices d
    JOIN halls h ON h.id=d.hall_id ORDER BY h.name,d.device_type,d.name
  `).all();
  return results||[];
}

async function getDistributors(env){
  await ensureOperationsSchema(env);
  const {results}=await env.DB.prepare("SELECT * FROM distributors ORDER BY name").all();
  return results||[];
}

async function getDeliveries(env){
  await ensureOperationsSchema(env);
  const {results}=await env.DB.prepare(`
    SELECT dd.*,d.name AS distributor_name,ca.title AS content_title
    FROM distribution_deliveries dd
    LEFT JOIN distributors d ON d.id=dd.distributor_id
    LEFT JOIN content_assets ca ON ca.id=dd.content_asset_id
    ORDER BY dd.created_at DESC
  `).all();
  return results||[];
}

async function ensureAuthSchema(env){
  const statements=[
    `CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      cinema_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role_id TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT,
      FOREIGN KEY (cinema_id) REFERENCES cinemas(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS app_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
    )`
  ];
  for(const sql of statements) await env.DB.prepare(sql).run();
}

function bytesToHex(bytes){return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("")}
function randomHex(bytes=32){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return bytesToHex(a)}
function hexToBytes(hex){const a=new Uint8Array(hex.length/2);for(let i=0;i<a.length;i++)a[i]=parseInt(hex.slice(i*2,i*2+2),16);return a}

async function passwordHash(password,saltHex){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits(
    {name:"PBKDF2",hash:"SHA-256",salt:hexToBytes(saltHex),iterations:210000},
    key,256
  );
  return bytesToHex(new Uint8Array(bits));
}

function parseCookies(request){
  const out={};
  for(const part of (request.headers.get("cookie")||"").split(";")){
    const i=part.indexOf("=");if(i<0)continue;
    out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}

async function currentUser(request,env){
  await ensureAuthSchema(env);
  const token=parseCookies(request).cinemaos_session;
  if(!token)return null;
  const hash=await sha256Hex(token);
  const row=await env.DB.prepare(`
    SELECT u.id,u.email,u.display_name,u.role_id,u.status,s.id AS session_id,s.expires_at
    FROM app_sessions s JOIN app_users u ON u.id=s.user_id
    WHERE s.token_hash=? LIMIT 1
  `).bind(hash).first();
  if(!row||row.status!=="ACTIVE")return null;
  if(new Date(row.expires_at).getTime()<=Date.now()){
    await env.DB.prepare("DELETE FROM app_sessions WHERE id=?").bind(row.session_id).run().catch(()=>{});
    return null;
  }
  await env.DB.prepare("UPDATE app_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.session_id).run().catch(()=>{});
  return row;
}

async function authConfigured(env){
  await ensureAuthSchema(env);
  const r=await env.DB.prepare("SELECT COUNT(*) AS c FROM app_users").first();
  return Number(r?.c||0)>0;
}

function sessionCookie(token,maxAge=43200){
  return "cinemaos_session="+encodeURIComponent(token)+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+maxAge;
}

function roleCan(role,path,method){
  if(role==="administrator")return true;
  if(method==="GET")return true;
  if(role==="manager") return /^\/api\/(movies|screenings|playlists|playlist-items|content-assets|distribution-deliveries)/.test(path);
  if(role==="projectionist") return /^\/api\/(playlists|playlist-items|content-assets|kdm-requests)/.test(path);
  if(role==="technician") return /^\/api\/(halls|hall-devices|certificates)/.test(path);
  if(role==="distributor") return /^\/api\/(distribution-deliveries|content-assets|storage\/multipart)/.test(path);
  return false;
}

async function getUsers(env){
  await ensureAuthSchema(env);
  const {results}=await env.DB.prepare(`
    SELECT id,email,display_name,role_id,status,created_at,last_login_at
    FROM app_users ORDER BY display_name
  `).all();
  return results||[];
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
        ok:true,service:"CinemaOS API",version:"0.15.0",
        database:{bound:Boolean(env.DB),tables:await tableCount(env)},
        time:new Date().toISOString()
      });
    }

    if (url.pathname === "/api/auth/status" && method === "GET") {
      const configured=await authConfigured(env);
      const user=configured?await currentUser(request,env):null;
      return json({configured,user:user?{id:user.id,email:user.email,displayName:user.display_name,role:user.role_id}:null,setupSecretConfigured:Boolean(env.ADMIN_SETUP_KEY)});
    }

    if (url.pathname === "/api/auth/setup-admin" && method === "POST") {
      await ensureAuthSchema(env);
      if(await authConfigured(env)) return json({error:"Administrator is already configured."},{status:409});
      if(!env.ADMIN_SETUP_KEY) return json({error:"ADMIN_SETUP_KEY is not configured in Worker secrets."},{status:503});
      const body=await request.json();
      if(String(body.setupKey||"")!==String(env.ADMIN_SETUP_KEY)) return json({error:"Invalid setup key"},{status:403});
      const email=String(body.email||"").trim().toLowerCase();
      const displayName=String(body.displayName||"Administrator").trim();
      const password=String(body.password||"");
      if(!email.includes("@")) return json({error:"Valid email is required"},{status:400});
      if(password.length<10) return json({error:"Password must be at least 10 characters"},{status:400});
      const salt=randomHex(16),hash=await passwordHash(password,salt),id=crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO app_users (id,cinema_id,email,display_name,role_id,password_salt,password_hash,status)
        VALUES (?,?,?,?,?,?,?,'ACTIVE')
      `).bind(id,"BG-VT-PALACE-001",email,displayName,"administrator",salt,hash).run();
      return json({ok:true,id},{status:201});
    }

    if (url.pathname === "/api/auth/login" && method === "POST") {
      await ensureAuthSchema(env);
      const body=await request.json();
      const email=String(body.email||"").trim().toLowerCase();
      const password=String(body.password||"");
      const u=await env.DB.prepare("SELECT * FROM app_users WHERE email=? LIMIT 1").bind(email).first();
      if(!u||u.status!=="ACTIVE") return json({error:"Invalid email or password"},{status:401});
      const hash=await passwordHash(password,u.password_salt);
      if(hash!==u.password_hash) return json({error:"Invalid email or password"},{status:401});
      const token=randomHex(32),tokenHash=await sha256Hex(token),sid=crypto.randomUUID();
      const expires=new Date(Date.now()+12*60*60*1000).toISOString();
      await env.DB.prepare("INSERT INTO app_sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)").bind(sid,u.id,tokenHash,expires).run();
      await env.DB.prepare("UPDATE app_users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(u.id).run();
      return json({ok:true,user:{id:u.id,email:u.email,displayName:u.display_name,role:u.role_id}},{
        headers:{"set-cookie":sessionCookie(token)}
      });
    }

    if (url.pathname === "/api/auth/logout" && method === "POST") {
      const token=parseCookies(request).cinemaos_session;
      if(token){
        const hash=await sha256Hex(token);
        await env.DB.prepare("DELETE FROM app_sessions WHERE token_hash=?").bind(hash).run().catch(()=>{});
      }
      return json({ok:true},{headers:{"set-cookie":"cinemaos_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"}});
    }

    if (url.pathname === "/api/users" && method === "GET") {
      const user=await currentUser(request,env);
      if(!user||user.role_id!=="administrator") return json({error:"Administrator access required"},{status:403});
      return json(await getUsers(env));
    }

    if (url.pathname === "/api/users" && method === "POST") {
      const user=await currentUser(request,env);
      if(!user||user.role_id!=="administrator") return json({error:"Administrator access required"},{status:403});
      const body=await request.json();
      const email=String(body.email||"").trim().toLowerCase(),password=String(body.password||"");
      const role=String(body.role||"projectionist");
      if(!["administrator","manager","projectionist","technician","distributor"].includes(role)) return json({error:"Invalid role"},{status:400});
      if(!email.includes("@")||password.length<10) return json({error:"Valid email and password of at least 10 characters are required"},{status:400});
      const salt=randomHex(16),hash=await passwordHash(password,salt),id=crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO app_users (id,cinema_id,email,display_name,role_id,password_salt,password_hash,status)
        VALUES (?,?,?,?,?,?,?,'ACTIVE')
      `).bind(id,"BG-VT-PALACE-001",email,String(body.displayName||email),role,salt,hash).run();
      return json({ok:true,id},{status:201});
    }

    if (/^\/api\/users\/[^/]+$/.test(url.pathname) && method === "PUT") {
      const user=await currentUser(request,env);
      if(!user||user.role_id!=="administrator") return json({error:"Administrator access required"},{status:403});
      const id=decodeURIComponent(url.pathname.split("/").pop());
      const body=await request.json();
      const role=String(body.role||"projectionist"),status=String(body.status||"ACTIVE");
      if(!["administrator","manager","projectionist","technician","distributor"].includes(role)) return json({error:"Invalid role"},{status:400});
      if(!["ACTIVE","DISABLED"].includes(status)) return json({error:"Invalid status"},{status:400});
      await env.DB.prepare("UPDATE app_users SET display_name=?,role_id=?,status=? WHERE id=?")
        .bind(String(body.displayName||""),role,status,id).run();
      return json({ok:true});
    }

    // Once the first administrator exists, protect all normal API mutations.
    // Agent authentication endpoints and auth endpoints use their own credentials.
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/agent") &&
        !url.pathname.startsWith("/api/auth/") && url.pathname!=="/api/health" &&
        method!=="GET" && await authConfigured(env)) {
      const user=await currentUser(request,env);
      if(!user) return json({error:"Authentication required"},{status:401});
      if(!roleCan(user.role_id,url.pathname,method)) return json({error:"Your role does not allow this action"},{status:403});
    }

    if (url.pathname === "/api/bootstrap" && method === "GET") {
      const [cinema,halls,movies,screenings] = await Promise.all([
        env.DB.prepare("SELECT * FROM cinemas WHERE id=?").bind("BG-VT-PALACE-001").first(),
        getHalls(env),getMovies(env),getScreenings(env)
      ]);
      return json({
        cinema,halls,movies,screenings,
        system:{apiVersion:"0.15.0",storageMode:"central",agentStatus:"demo",database:"D1"}
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

    if (url.pathname === "/api/agents" && method === "GET") {
      return json(await getAgents(env));
    }

    if (url.pathname === "/api/agents/enroll" && method === "POST") {
      await ensureAgentSchema(env);
      if(!env.AGENT_ENROLLMENT_KEY){
        return json({error:"Agent enrollment is not configured",detail:"Set the Worker secret AGENT_ENROLLMENT_KEY first."},{status:503});
      }
      const body=await request.json();
      if(String(body.enrollmentKey||"")!==String(env.AGENT_ENROLLMENT_KEY)){
        return json({error:"Invalid enrollment key"},{status:403});
      }
      const token=crypto.randomUUID()+crypto.randomUUID().replaceAll("-","");
      const tokenHash=await sha256Hex(token);
      const id=crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO agent_nodes
        (id,cinema_id,name,machine_name,version,token_hash,status,last_seen_at,capabilities_json)
        VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)
      `).bind(
        id,"BG-VT-PALACE-001",String(body.name||"CinemaOS Agent"),
        String(body.machineName||""),String(body.version||"0.1.0"),tokenHash,"ONLINE",
        JSON.stringify(body.capabilities||["persistent_queue","heartbeat"])
      ).run();
      return json({ok:true,agentId:id,agentToken:token},{status:201});
    }

    if (url.pathname === "/api/agent/heartbeat" && method === "POST") {
      const agent=await authenticateAgent(request,env);
      if(!agent) return json({error:"Unauthorized agent"},{status:401});
      const body=await request.json().catch(()=>({}));
      await env.DB.prepare(`
        UPDATE agent_nodes
        SET status='ONLINE',last_seen_at=CURRENT_TIMESTAMP,version=?,machine_name=?,capabilities_json=?
        WHERE id=?
      `).bind(
        String(body.version||agent.version||""),
        String(body.machineName||agent.machine_name||""),
        JSON.stringify(body.capabilities||[]),
        agent.id
      ).run();
      return json({ok:true,agentId:agent.id,time:new Date().toISOString()});
    }

    if (url.pathname === "/api/agent/jobs" && method === "GET") {
      const agent=await authenticateAgent(request,env);
      if(!agent) return json({error:"Unauthorized agent"},{status:401});
      const {results}=await env.DB.prepare(`
        SELECT id,job_type,payload_json,status,progress,message,created_at,updated_at
        FROM agent_jobs
        WHERE agent_id=? AND status IN ('QUEUED','RUNNING','PAUSED')
        ORDER BY created_at ASC
      `).bind(agent.id).all();
      return json(results||[]);
    }

    if (/^\/api\/agent\/jobs\/[^/]+$/.test(url.pathname) && method === "PUT") {
      const agent=await authenticateAgent(request,env);
      if(!agent) return json({error:"Unauthorized agent"},{status:401});
      const jobId=decodeURIComponent(url.pathname.split("/").pop());
      const body=await request.json();
      await env.DB.prepare(`
        UPDATE agent_jobs SET status=?,progress=?,message=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND agent_id=?
      `).bind(
        String(body.status||"RUNNING"),
        Math.max(0,Math.min(100,Number(body.progress||0))),
        String(body.message||""),
        jobId,agent.id
      ).run();
      return json({ok:true});
    }

    if (url.pathname === "/api/agent-transfers" && method === "GET") {
      return json(await getAgentTransfers(env));
    }

    if (url.pathname === "/api/agent-jobs" && method === "POST") {
      const configured=await authConfigured(env);
      const user=configured?await currentUser(request,env):null;
      if(configured&&!user) return json({error:"Authentication required"},{status:401});
      const body=await request.json();
      const agentId=String(body.agentId||"");
      const type=String(body.jobType||"");
      if(!agentId||!["DOWNLOAD_CONTENT"].includes(type)) return json({error:"Invalid agent job"},{status:400});
      const agent=await env.DB.prepare("SELECT id FROM agent_nodes WHERE id=? LIMIT 1").bind(agentId).first();
      if(!agent) return json({error:"Agent not found"},{status:404});
      const id=crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO agent_jobs (id,agent_id,job_type,payload_json,status,progress,message)
        VALUES (?,?,?,?,?,?,?)
      `).bind(id,agentId,type,JSON.stringify(body.payload||{}),"QUEUED",0,"Waiting for Agent").run();
      return json({ok:true,id},{status:201});
    }

    if (url.pathname === "/api/agent/transfers/report" && method === "POST") {
      const agent=await authenticateAgent(request,env);
      if(!agent) return json({error:"Unauthorized agent"},{status:401});
      await ensureOperationsSchema(env);
      const body=await request.json();
      const id=String(body.id||crypto.randomUUID());
      await env.DB.prepare(`
        INSERT INTO agent_transfers
        (id,agent_id,file_name,direction,status,progress,bytes_done,bytes_total,speed_bps,message,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          status=excluded.status,progress=excluded.progress,bytes_done=excluded.bytes_done,
          bytes_total=excluded.bytes_total,speed_bps=excluded.speed_bps,message=excluded.message,
          updated_at=CURRENT_TIMESTAMP
      `).bind(
        id,agent.id,String(body.fileName||"Unknown"),String(body.direction||"UPLOAD"),
        String(body.status||"QUEUED"),Math.max(0,Math.min(100,Number(body.progress||0))),
        Number(body.bytesDone||0),Number(body.bytesTotal||0),Number(body.speedBps||0),String(body.message||"")
      ).run();
      return json({ok:true,id});
    }

    if (url.pathname === "/api/hall-devices" && method === "GET") return json(await getHallDevices(env));

    if (url.pathname === "/api/hall-devices" && method === "POST") {
      await ensureOperationsSchema(env);
      const body=await request.json();
      if(!body.hallId||!body.deviceType||!String(body.name||"").trim()) return json({error:"hallId, deviceType and name are required"},{status:400});
      const id=crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO hall_devices (id,hall_id,device_type,manufacturer,model,name,address,status,notes)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).bind(id,body.hallId,String(body.deviceType),String(body.manufacturer||""),String(body.model||""),String(body.name).trim(),String(body.address||""),String(body.status||"UNKNOWN"),String(body.notes||"")).run();
      return json({ok:true,id},{status:201});
    }

    if (url.pathname.startsWith("/api/hall-devices/") && method === "DELETE") {
      const id=decodeURIComponent(url.pathname.split("/").pop());
      await env.DB.prepare("DELETE FROM hall_devices WHERE id=?").bind(id).run();
      return json({ok:true});
    }

    if (/^\/api\/content-assets\/[^/]+\/metadata$/.test(url.pathname) && method === "POST") {
      await ensureOperationsSchema(env);
      const assetId=decodeURIComponent(url.pathname.split("/")[3]);
      const body=await request.json();
      await env.DB.prepare(`
        INSERT INTO content_asset_metadata
        (asset_id,cpl_id,annotation_text,edit_rate,duration_frames,runtime_seconds,encrypted,has_assetmap,has_pkl,has_cpl,package_files,metadata_json,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(asset_id) DO UPDATE SET
          cpl_id=excluded.cpl_id,annotation_text=excluded.annotation_text,edit_rate=excluded.edit_rate,
          duration_frames=excluded.duration_frames,runtime_seconds=excluded.runtime_seconds,encrypted=excluded.encrypted,
          has_assetmap=excluded.has_assetmap,has_pkl=excluded.has_pkl,has_cpl=excluded.has_cpl,
          package_files=excluded.package_files,metadata_json=excluded.metadata_json,updated_at=CURRENT_TIMESTAMP
      `).bind(
        assetId,String(body.cplId||""),String(body.annotationText||""),String(body.editRate||""),
        Number(body.durationFrames||0),Number(body.runtimeSeconds||0),body.encrypted?1:0,
        body.hasAssetMap?1:0,body.hasPkl?1:0,body.hasCpl?1:0,Number(body.packageFiles||0),JSON.stringify(body)
      ).run();
      return json({ok:true});
    }

    if (url.pathname === "/api/distributors" && method === "GET") return json(await getDistributors(env));
    if (url.pathname === "/api/distributors" && method === "POST") {
      await ensureOperationsSchema(env);
      const body=await request.json();
      if(!String(body.name||"").trim()) return json({error:"Distributor name is required"},{status:400});
      const id=crypto.randomUUID();
      await env.DB.prepare("INSERT INTO distributors (id,name,contact_email,status) VALUES (?,?,?,?)")
        .bind(id,String(body.name).trim(),String(body.contactEmail||""),"ACTIVE").run();
      return json({ok:true,id},{status:201});
    }

    if (url.pathname === "/api/distribution-deliveries" && method === "GET") return json(await getDeliveries(env));
    if (url.pathname === "/api/distribution-deliveries" && method === "POST") {
      await ensureOperationsSchema(env);
      const body=await request.json();
      const id=crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO distribution_deliveries (id,distributor_id,content_asset_id,destination_cinema_id,status,notes)
        VALUES (?,?,?,?,?,?)
      `).bind(id,body.distributorId||null,body.contentAssetId||null,"BG-VT-PALACE-001","QUEUED",String(body.notes||"")).run();
      return json({ok:true,id},{status:201});
    }

    if (url.pathname === "/api/storage/status" && method === "GET") {
      return json({
        configured: Boolean(env.CONTENT),
        provider: "Cloudflare R2",
        bucketBinding: "CONTENT"
      });
    }

    if (url.pathname === "/api/storage/multipart/init" && method === "POST") {
      if (!env.CONTENT) return json({error:"R2 storage is not configured yet"},{status:503});
      const body=await request.json();
      const assetType=String(body.assetType||"OTHER").toUpperCase();
      const title=String(body.title||"upload").trim();
      const fileName=String(body.fileName||"package.zip").replace(/[^a-zA-Z0-9._-]/g,"_");
      const assetId=crypto.randomUUID();
      const key="cinema/BG-VT-PALACE-001/"+assetType.toLowerCase()+"/"+assetId+"/"+fileName;
      const upload=await env.CONTENT.createMultipartUpload(key,{
        httpMetadata:{contentType:String(body.contentType||"application/octet-stream")},
        customMetadata:{assetId,assetType,title}
      });
      return json({ok:true,key,assetId,uploadId:upload.uploadId},{status:201});
    }

    if (url.pathname === "/api/storage/multipart/part" && method === "PUT") {
      if (!env.CONTENT) return json({error:"R2 storage is not configured yet"},{status:503});
      const key=url.searchParams.get("key");
      const uploadId=url.searchParams.get("uploadId");
      const partNumber=Number(url.searchParams.get("partNumber"));
      if(!key||!uploadId||!partNumber) return json({error:"Missing multipart parameters"},{status:400});
      const upload=env.CONTENT.resumeMultipartUpload(key,uploadId);
      const part=await upload.uploadPart(partNumber,request.body);
      return json({partNumber:part.partNumber,etag:part.etag});
    }

    if (url.pathname === "/api/storage/multipart/complete" && method === "POST") {
      if (!env.CONTENT) return json({error:"R2 storage is not configured yet"},{status:503});
      const body=await request.json();
      const upload=env.CONTENT.resumeMultipartUpload(body.key,body.uploadId);
      const object=await upload.complete(body.parts||[]);
      return json({ok:true,key:body.key,etag:object.httpEtag||null});
    }

    if (url.pathname === "/api/storage/multipart/abort" && method === "POST") {
      if (!env.CONTENT) return json({error:"R2 storage is not configured yet"},{status:503});
      const body=await request.json();
      const upload=env.CONTENT.resumeMultipartUpload(body.key,body.uploadId);
      await upload.abort();
      return json({ok:true});
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
      if(await authConfigured(env)){
        const webUser=await currentUser(request,env);
        const agentUser=await authenticateAgent(request,env);
        if(!webUser&&!agentUser) return json({error:"Authentication required"},{status:401});
      }
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
          crypto.randomUUID(),id,1000,"MOVIE",
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
      const itemType=String(body.itemType||"AD");
      let position;
      if(itemType==="MOVIE"){
        position=1000;
      }else{
        const row=await env.DB.prepare("SELECT COALESCE(MAX(position),0) AS max_pos FROM playlist_items WHERE playlist_id=? AND position<1000")
          .bind(playlistId).first();
        position=Math.min(990,Number(row?.max_pos||0)+10);
      }
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

    if (url.pathname === "/api/certificates" && method === "GET") {
      return json(await getCertificates(env));
    }

    if (url.pathname === "/api/certificates" && method === "POST") {
      await ensureSecuritySchema(env);
      const body=await request.json();
      if(!body.hallId||!String(body.deviceName||"").trim()){
        return json({error:"hallId and deviceName are required"},{status:400});
      }
      const id=crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO device_certificates
        (id,cinema_id,hall_id,device_name,manufacturer,model,serial_number,certificate_pem,fingerprint_sha256,valid_from,valid_until,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id,"BG-VT-PALACE-001",body.hallId,String(body.deviceName).trim(),
        String(body.manufacturer||""),String(body.model||""),String(body.serialNumber||""),
        String(body.certificatePem||""),String(body.fingerprintSha256||""),
        body.validFrom||null,body.validUntil||null,"ACTIVE"
      ).run();
      return json({ok:true,id},{status:201});
    }

    if (url.pathname.startsWith("/api/certificates/") && method === "DELETE") {
      await ensureSecuritySchema(env);
      const id=decodeURIComponent(url.pathname.split("/").pop());
      const used=await env.DB.prepare("SELECT id FROM kdm_requests WHERE certificate_id=? LIMIT 1").bind(id).first();
      if(used) return json({error:"Certificate is referenced by KDM requests."},{status:409});
      await env.DB.prepare("DELETE FROM device_certificates WHERE id=?").bind(id).run();
      return json({ok:true});
    }

    if (url.pathname === "/api/kdm-requests" && method === "GET") {
      return json(await getKdmRequests(env));
    }

    if (url.pathname === "/api/kdm-requests" && method === "POST") {
      await ensureSecuritySchema(env);
      const body=await request.json();
      if(!body.versionId||!body.hallId||!body.validFrom||!body.validUntil){
        return json({error:"versionId, hallId, validFrom and validUntil are required"},{status:400});
      }

      const cert=await env.DB.prepare(`
        SELECT id,status,valid_from,valid_until
        FROM device_certificates
        WHERE hall_id=? AND status='ACTIVE'
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(body.hallId).first();

      if(!cert) return json({
        error:"No active device certificate for this hall",
        detail:"Add/import the IMS/media block public certificate once in Certificates."
      },{status:409});

      const id=crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO kdm_requests
        (id,movie_version_id,hall_id,certificate_id,valid_from,valid_until,status,notes)
        VALUES (?,?,?,?,?,?,?,?)
      `).bind(
        id,body.versionId,body.hallId,cert.id,body.validFrom,body.validUntil,
        "READY_TO_REQUEST",String(body.notes||"")
      ).run();

      return json({ok:true,id,certificateId:cert.id,status:"READY_TO_REQUEST"},{status:201});
    }

    if (url.pathname.startsWith("/api/kdm-requests/") && method === "PUT") {
      await ensureSecuritySchema(env);
      const id=decodeURIComponent(url.pathname.split("/").pop());
      const body=await request.json();
      const allowed=["READY_TO_REQUEST","REQUESTED","RECEIVED","INSTALLED","EXPIRED","FAILED"];
      const status=String(body.status||"READY_TO_REQUEST");
      if(!allowed.includes(status)) return json({error:"Invalid KDM status"},{status:400});
      await env.DB.prepare("UPDATE kdm_requests SET status=?,notes=? WHERE id=?")
        .bind(status,String(body.notes||""),id).run();
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
