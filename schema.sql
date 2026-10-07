-- CinemaOS D1 schema draft
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cinemas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  country TEXT DEFAULT 'BG',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS halls (
  id TEXT PRIMARY KEY,
  cinema_id TEXT NOT NULL,
  name TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'IDLE',
  FOREIGN KEY (cinema_id) REFERENCES cinemas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS movies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  distributor TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS movie_versions (
  id TEXT PRIMARY KEY,
  movie_id TEXT NOT NULL,
  version_name TEXT NOT NULL,
  format TEXT,
  audio TEXT,
  language TEXT,
  status TEXT NOT NULL DEFAULT 'READY',
  FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS screenings (
  id TEXT PRIMARY KEY,
  hall_id TEXT NOT NULL,
  movie_version_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED',
  FOREIGN KEY (hall_id) REFERENCES halls(id) ON DELETE CASCADE,
  FOREIGN KEY (movie_version_id) REFERENCES movie_versions(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  screening_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (screening_id) REFERENCES screenings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  title TEXT NOT NULL,
  source_ref TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  cue_json TEXT,
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);


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
);


CREATE TABLE IF NOT EXISTS device_certificates (
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
);

CREATE TABLE IF NOT EXISTS kdm_requests (
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
);


CREATE TABLE IF NOT EXISTS agent_nodes (
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
);

CREATE TABLE IF NOT EXISTS agent_jobs (
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
);
