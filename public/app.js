const state = {
  cinema: null,
  movies: [],
  halls: [],
  screenings: [],
  downloads: [
    {name:"Avengers: Doomsday • BG Dub",progress:68,speed:"126 MB/s",status:"DOWNLOADING"},
    {name:"Disney Trailer Pack",progress:100,speed:"Ready",status:"READY"}
  ]
};

const content = document.querySelector("#content");
const title = document.querySelector("#pageTitle");
const subtitle = document.querySelector("#pageSubtitle");
const nav = [...document.querySelectorAll(".nav-item")];
const movieDialog = document.querySelector("#movieDialog");
const movieForm = document.querySelector("#movieForm");

const api = {
  async get(path){
    const r = await fetch(path);
    if(!r.ok) throw new Error((await r.json()).error || "Request failed");
    return r.json();
  },
  async send(path, method, body){
    const r = await fetch(path,{
      method,
      headers:{"content-type":"application/json"},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error || "Request failed");
    return data;
  }
};

function statusPill(status){
  const c = status==="READY"||status==="ONLINE" ? "good" : status==="PLAYING" ? "playing" : status==="WAITING_CONTENT" ? "warn" : "";
  return `<span class="pill ${c}">${status}</span>`;
}

function flatVersions(){
  return state.movies.flatMap(m => (m.versions || []).map(v => ({...v,movieId:m.id,movieTitle:m.title})));
}

async function loadBackend(){
  try{
    const data = await api.get("/api/bootstrap");
    state.cinema = data.cinema;
    state.halls = data.halls || [];
    state.movies = data.movies || [];
    state.screenings = data.screenings || [];
    subtitle.textContent = `${state.cinema?.name || "CinemaOS"} • ${state.cinema?.city || ""}`;
  }catch(err){
    console.error(err);
  }
}

const pages = {
  dashboard(){
    content.innerHTML = `
      <div class="grid stats">
        <article class="card stat"><span>Halls</span><strong>${state.halls.length}</strong><small>D1 database</small></article>
        <article class="card stat"><span>Movies</span><strong>${state.movies.length}</strong><small>Central library</small></article>
        <article class="card stat"><span>Storage</span><strong>4.8 TB</strong><small>of 12 TB usable</small></article>
        <article class="card stat"><span>Downloads</span><strong>${state.downloads.filter(d=>d.progress<100).length}</strong><small>Background queue</small></article>
      </div>

      <div class="grid two">
        <article class="card">
          <div class="card-head"><h2>Hall status</h2><span class="pill good">DATABASE LIVE</span></div>
          ${state.halls.map(h=>`<div class="hall-row"><div><b>${h.name}</b><span>${h.seats} seats</span></div>${statusPill(h.status)}</div>`).join("") || '<div class="empty">No halls yet.</div>'}
        </article>

        <article class="card">
          <div class="card-head"><h2>Content delivery</h2><span>Central Storage</span></div>
          ${state.downloads.map(d=>`<div class="download"><div class="download-top"><b>${d.name}</b><span>${d.progress}%</span></div><div class="progress"><i style="width:${d.progress}%"></i></div><small>${d.speed}</small></div>`).join("")}
        </article>
      </div>

      <div class="grid two">
        <article class="card">
          <div class="card-head"><h2>Schedule</h2><button class="link" data-go="schedule">Open schedule</button></div>
          <div class="timeline">${state.screenings.slice(0,5).map(s=>`<div><time>${new Date(s.starts_at).toLocaleTimeString("bg-BG",{hour:"2-digit",minute:"2-digit"})}</time><span>${s.hall_name}</span><b>${s.movie_title}</b></div>`).join("") || '<div class="empty">No screenings yet.</div>'}</div>
        </article>

        <article class="card">
          <div class="card-head"><h2>Backend</h2><span class="pill good">D1 CONNECTED</span></div>
          <p class="subtle">Movies, halls and screenings now use the shared Cloudflare D1 database instead of browser localStorage.</p>
        </article>
      </div>`;
  },

  movies(){
    content.innerHTML = `
      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><div><h2>Movie Library</h2><p class="muted">Shared D1 content metadata.</p></div><button class="primary" id="newMovie">+ Add movie</button></div>
      </div>
      <div class="page-grid" id="moviesGrid"></div>`;
    renderMovies();
    document.querySelector("#newMovie").onclick=()=>movieDialog.showModal();
  },

  delivery(){
    content.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Content Delivery Queue</h2><span class="pill warn">DEMO</span></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Content</th><th>Destination</th><th>Status</th><th>Progress</th></tr></thead>
        <tbody>${state.downloads.map(d=>`<tr><td>${d.name}</td><td>Central Storage</td><td>${statusPill(d.status)}</td><td>${d.progress}%</td></tr>`).join("")}</tbody></table></div>
      </div>`;
  },

  schedule(){
    content.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Schedule</h2><button class="primary" id="demoScreening">+ Add test screening</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Start</th><th>Hall</th><th>Movie</th><th>Version</th><th>Status</th></tr></thead>
        <tbody>${state.screenings.map(s=>`<tr><td>${new Date(s.starts_at).toLocaleString("bg-BG")}</td><td>${s.hall_name}</td><td>${s.movie_title}</td><td>${s.version_name}</td><td>${statusPill(s.status)}</td></tr>`).join("") || '<tr><td colspan="5">No screenings yet.</td></tr>'}</tbody></table></div>
      </div>`;

    document.querySelector("#demoScreening").onclick=async()=>{
      const version = flatVersions()[0];
      const hall = state.halls[0];
      if(!version || !hall){
        alert("Add at least one movie first.");
        return;
      }
      const d = new Date();
      d.setMinutes(d.getMinutes()+30);
      d.setSeconds(0,0);
      try{
        await api.send("/api/screenings","POST",{
          hallId: hall.id,
          versionId: version.id,
          startsAt: d.toISOString()
        });
        state.screenings = await api.get("/api/screenings");
        pages.schedule();
      }catch(err){ alert(err.message); }
    };
  },

  playlists(){
    content.innerHTML = `
      <div class="grid two">
        <article class="card"><div class="card-head"><h2>Show Playlist</h2><span class="pill warn">NEXT</span></div>
          <div class="queue-row"><span>1. Advertisement</span><span class="pill">AD</span></div>
          <div class="queue-row"><span>2. Trailer</span><span class="pill">TRAILER</span></div>
          <div class="queue-row"><span>3. Feature Presentation</span><span class="pill good">MOVIE</span></div>
        </article>
        <article class="card"><h2>Automation cues</h2><div class="meta"><span>PRE-SHOW 70%</span><span>TRAILERS 50%</span><span>MOVIE 0%</span><span>CREDITS 20%</span><span>END 100%</span></div></article>
      </div>`;
  },

  halls(){
    content.innerHTML = `<div class="page-grid">${state.halls.map(h=>`
      <article class="movie-card">
        <div class="card-head"><h3>${h.name}</h3>${statusPill(h.status)}</div>
        <p>${h.seats} seats</p>
        <div class="meta"><span>ID: ${h.id}</span><span>D1</span><span>Agent pending</span></div>
      </article>`).join("")}</div>`;
  },

  automation(){
    content.innerHTML = `
      <div class="grid two">
        <article class="card"><div class="card-head"><h2>Show Automation</h2><span class="pill warn">DEMO</span></div>
          <p class="subtle">Future CinemaOS Agent commands for lights, curtains, audio and projector control.</p>
        </article>
        <article class="card"><h2>Hardware Adapter Layer</h2><p class="subtle">Real equipment integration will use documented and authorized interfaces.</p></article>
      </div>`;
  },

  ai(){
    content.innerHTML = `
      <div class="card"><div class="card-head"><h2>AI Assistant</h2><span class="pill ai">BETA</span></div>
      <p class="subtle">Next stage: schedule optimization using real D1 screening data.</p></div>`;
  },

  reports(){
    content.innerHTML = `
      <div class="grid three">
        <article class="card"><span class="muted">Screenings</span><div class="kpi">${state.screenings.length}</div></article>
        <article class="card"><span class="muted">Movies</span><div class="kpi">${state.movies.length}</div></article>
        <article class="card"><span class="muted">Halls</span><div class="kpi">${state.halls.length}</div></article>
      </div>`;
  },

  settings(){
    content.innerHTML = `
      <div class="grid two">
        <article class="card"><h2>Cinema profile</h2>
          <div class="field"><label>Cinema ID<input value="${state.cinema?.id || ""}" readonly /></label></div>
          <div class="field"><label>Name<input value="${state.cinema?.name || ""}" readonly /></label></div>
        </article>
        <article class="card"><h2>Database</h2><p class="subtle">Cloudflare D1 is connected. Shared operational metadata is now available from every device that opens CinemaOS.</p></article>
      </div>`;
  }
};

function renderMovies(){
  const grid=document.querySelector("#moviesGrid");
  if(!state.movies.length){grid.innerHTML='<div class="empty">No movies yet. Add the first one.</div>';return}
  grid.innerHTML=state.movies.map(m=>{
    const v=m.versions?.[0];
    return `
      <article class="movie-card">
        <div class="card-head"><h3>${m.title}</h3>${statusPill(v?.status || "READY")}</div>
        <p>${v?.name || "No version"}</p>
        <div class="meta"><span>${v?.format || "DCP"}</span><span>${v?.audio || "Unknown audio"}</span></div>
        <div style="margin-top:16px"><button class="danger" data-delete-movie="${m.id}">Delete</button></div>
      </article>`;
  }).join("");
}

function openPage(name){
  nav.forEach(n=>n.classList.toggle("active",n.dataset.page===name));
  const active=nav.find(n=>n.dataset.page===name);
  title.textContent=active?.textContent||"CinemaOS";
  if(name!=="dashboard") subtitle.textContent="CinemaOS Control Center";
  (pages[name]||pages.dashboard)();
}

nav.forEach(btn=>btn.addEventListener("click",()=>openPage(btn.dataset.page)));
document.querySelector("#quickMovie").onclick=()=>movieDialog.showModal();

document.addEventListener("click",async e=>{
  const go=e.target.closest("[data-go]");
  if(go) openPage(go.dataset.go);

  const del=e.target.closest("[data-delete-movie]");
  if(del){
    if(!confirm("Delete this movie and its versions?")) return;
    try{
      await api.send("/api/movies/"+encodeURIComponent(del.dataset.deleteMovie),"DELETE");
      state.movies=await api.get("/api/movies");
      renderMovies();
    }catch(err){ alert(err.message); }
  }
});

movieForm.addEventListener("submit",async e=>{
  e.preventDefault();
  const fd=new FormData(movieForm);
  try{
    await api.send("/api/movies","POST",{
      title:fd.get("title"),
      version:fd.get("version")||"Original",
      format:fd.get("format"),
      audio:fd.get("audio")
    });
    state.movies=await api.get("/api/movies");
    movieForm.reset();
    movieDialog.close();
    openPage("movies");
  }catch(err){ alert(err.message); }
});

(async()=>{
  await loadBackend();
  openPage("dashboard");
})();
