const json = (data, init = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });

const demoBootstrap = {
  cinema: {
    id: "BG-VT-PALACE-001",
    name: "Cinema Palace",
    city: "Veliko Tarnovo",
    mode: "Central Storage + Managed Hall Access"
  },
  halls: [
    { id: "vip", name: "VIP Болярка", seats: 50, status: "PLAYING", now: "Odyssey • 14:30" },
    { id: "h2", name: "Hall 2", seats: 98, status: "READY", now: "Ready for next show" },
    { id: "h3", name: "Hall 3", seats: 97, status: "IDLE", now: "Idle" }
  ],
  system: {
    apiVersion: "0.3.0",
    storageMode: "central",
    agentStatus: "demo"
  }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "CinemaOS API",
        version: "0.3.0",
        time: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/bootstrap") {
      return json(demoBootstrap);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
