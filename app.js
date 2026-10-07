const STORAGE_KEY = "cinemaos_state_v1";

const defaults = {
  movies: [
    {id:crypto.randomUUID(),title:"Odyssey",version:"Original",format:"4K DCP",audio:"Dolby 7.1",status:"READY"},
    {id:crypto.randomUUID(),title:"Avatar",version:"BG Dub",format:"2K DCP",audio:"5.1",status:"READY"},
    {id:crypto.randomUUID(),title:"Superman",version:"BG Dub",format:"4K DCP",audio:"Dolby 7.1",status:"READY"}
  ],
  halls:[
    {id:"vip",name:"VIP Болярка",seats:50,status:"PLAYING",now:"Odyssey • 14:30"},
    {id:"h2",name:"Hall 2",seats:98,status:"READY",now:"Ready for next show"},
    {id:"h3",name:"Hall 3",seats:97,status:"IDLE",now:"Idle"}
  ],
  screenings:[
    {time:"14:30",hall:"VIP Болярка",movie:"Odyssey",version:"Original",status:"READY"},
    {time:"16:45",hall:"Hall 2",movie:"Avatar",version:"BG Dub",status:"READY"},
    {time:"19:10",hall:"Hall 3",movie:"Superman",version:"BG Dub",status:"READY"}
  ],
  downloads:[
    {name:"Avengers: Doomsday • BG Dub",progress:68,speed:"126 MB/s",status:"DOWNLOADING"},
    {name:"Disney Trailer Pack",progress:100,speed:"Ready",status:"READY"}
  ]
};

function loadState(){
  try{
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ? {...defaults,...saved} : structuredClone(defaults);
  }catch{return structuredClone(defaults)}
}
const state = loadState();
const save = ()=>localStorage.setItem(STORAGE_KEY,JSON.stringify(state));

const content = document.querySelector("#content");
const title = document.querySelector("#pageTitle");
const subtitle = document.querySelector("#pageSubtitle");
const nav = [...document.querySelectorAll(".nav-item")];
const movieDialog = document.querySelector("#movieDialog");
const movieForm = document.querySelector("#movieForm");

function statusPill(status){
  const c = status==="READY"||status==="ONLINE" ? "good" : status==="PLAYING" ? "playing" : status==="WAITING_CONTENT" ? "warn" : "";
  return `<span class="pill ${c}">${status}</span>`;
}

const pages = {
  dashboard(){
    content.innerHTML = `
      <div class="grid stats">
        <article class="card stat"><span>Halls online</span><strong>3 / 3</strong><small>All systems operational</small></article>
        <article class="card stat"><span>Active content</span><strong>${state.movies.length}</strong><small>Central library</small></article>
        <article class="card stat"><span>Storage</span><strong>4.8 TB</strong><small>of 12 TB usable</small></article>
        <article class="card stat"><span>Downloads</span><strong>${state.downloads.filter(d=>d.progress<100).length}</strong><small>Background queue</small></article>
      </div>

      <div class="grid two">
        <article class="card">
          <div class="card-head"><h2>Hall status</h2><span class="pill good">LIVE</span></div>
          ${state.halls.map(h=>`<div class="hall-row"><div><b>${h.name}</b><span>${h.now}</span></div>${statusPill(h.status)}</div>`).join("")}
        </article>

        <article class="card">
          <div class="card-head"><h2>Content delivery</h2><span>Central Storage</span></div>
          ${state.downloads.map(d=>`<div class="download"><div class="download-top"><b>${d.name}</b><span>${d.progress}%</span></div><div class="progress"><i style="width:${d.progress}%"></i></div><small>${d.speed} • ${d.progress===100?"available to halls":"verified chunks"}</small></div>`).join("")}
        </article>
      </div>

      <div class="grid two">
        <article class="card">
          <div class="card-head"><h2>Today's schedule</h2><button class="link" data-go="schedule">Open schedule</button></div>
          <div class="timeline">${state.screenings.map(s=>`<div><time>${s.time}</time><span>${s.hall}</span><b>${s.movie}</b></div>`).join("")}</div>
        </article>

        <article class="card">
          <div class="card-head"><h2>AI Assistant</h2><span class="pill ai">BETA</span></div>
          <p class="subtle">Hall 2 is free between 18:40 and 21:15. CinemaOS can eventually use attendance, runtime and release priority to suggest a better schedule.</p>
          <button class="primary" data-go="ai">Open AI Assistant</button>
        </article>
      </div>`;
  },

  movies(){
    content.innerHTML = `
      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><div><h2>Movie Library</h2><p class="muted">One central content library for the cinema.</p></div><button class="primary" id="newMovie">+ Add movie</button></div>
        <div class="notice">Current build stores demo metadata in your browser. Real DCP ingest and CPL/PKL/ASSETMAP parsing will be added through the backend and CinemaOS Agent.</div>
      </div>
      <div class="page-grid" id="moviesGrid"></div>`;
    renderMovies();
    document.querySelector("#newMovie").onclick=()=>movieDialog.showModal();
  },

  delivery(){
    content.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Content Delivery Queue</h2><span class="pill good">CONNECTED</span></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Content</th><th>Destination</th><th>Status</th><th>Progress</th></tr></thead>
        <tbody>${state.downloads.map(d=>`<tr><td>${d.name}</td><td>Central Storage</td><td>${statusPill(d.status)}</td><td>${d.progress}%</td></tr>`).join("")}</tbody></table></div>
      </div>`;
  },

  schedule(){
    content.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Schedule</h2><button class="primary" id="demoScreening">+ Demo screening</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Hall</th><th>Movie</th><th>Version</th><th>Readiness</th></tr></thead>
        <tbody>${state.screenings.map(s=>`<tr><td>${s.time}</td><td>${s.hall}</td><td>${s.movie}</td><td>${s.version}</td><td>${statusPill(s.status)}</td></tr>`).join("")}</tbody></table></div>
      </div>`;
    document.querySelector("#demoScreening").onclick=()=>{
      const next={time:"21:30",hall:"Hall 2",movie:state.movies[0]?.title||"Movie",version:state.movies[0]?.version||"Original",status:"READY"};
      if(!state.screenings.some(s=>s.time===next.time&&s.hall===next.hall)){state.screenings.push(next);save();pages.schedule()}
    };
  },

  playlists(){
    content.innerHTML = `
      <div class="grid two">
        <article class="card"><div class="card-head"><h2>Show Playlist</h2><span>Hall 2 • 21:30</span></div>
          <div class="queue-row"><span>1. Coca-Cola Ad</span><span class="pill">AD</span></div>
          <div class="queue-row"><span>2. Disney Trailer</span><span class="pill">TRAILER</span></div>
          <div class="queue-row"><span>3. Feature Presentation</span><span class="pill good">MOVIE</span></div>
        </article>
        <article class="card"><h2>Automation cues</h2><div class="meta"><span>PRE-SHOW 70%</span><span>TRAILERS 50%</span><span>MOVIE 0%</span><span>CREDITS 20%</span><span>END 100%</span></div></article>
      </div>`;
  },

  halls(){
    content.innerHTML = `<div class="page-grid">${state.halls.map(h=>`
      <article class="movie-card">
        <div class="card-head"><h3>${h.name}</h3>${statusPill(h.status==="IDLE"?"ONLINE":h.status)}</div>
        <p>${h.seats} seats</p>
        <div class="meta"><span>Projector adapter</span><span>IMS/Server</span><span>Dolby 7.1</span></div>
        <p class="muted" style="margin-top:14px">${h.now}</p>
      </article>`).join("")}</div>`;
  },

  automation(){
    content.innerHTML = `
      <div class="grid two">
        <article class="card"><div class="card-head"><h2>Show Automation</h2><span class="pill warn">DEMO</span></div>
          <p class="subtle">Cue engine for lights, curtains, audio and projector actions. Commands will be routed through CinemaOS Agent and official hardware adapters.</p>
          <div class="meta"><span>LIGHTS</span><span>CURTAINS</span><span>AUDIO</span><span>PROJECTOR</span></div>
        </article>
        <article class="card"><h2>Hardware Adapter Layer</h2><p class="subtle">Designed for manufacturer-specific integrations without locking CinemaOS to one vendor. Actual control requires documented/authorized interfaces.</p></article>
      </div>`;
  },

  ai(){
    content.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>AI Assistant</h2><span class="pill ai">BETA</span></div>
        <p class="subtle">The production assistant will analyze schedule conflicts, hall capacity, historical sales and content readiness. For now this is an interface prototype.</p>
        <div class="field"><label>Ask CinemaOS<textarea rows="5" placeholder="Коя зала е свободна в 21:00?"></textarea></label></div>
        <button class="primary">Analyze</button>
      </div>`;
  },

  reports(){
    content.innerHTML = `
      <div class="grid three">
        <article class="card"><span class="muted">Shows today</span><div class="kpi">${state.screenings.length}</div><span class="pill good">Operational</span></article>
        <article class="card"><span class="muted">Content ready</span><div class="kpi">${state.movies.length}</div><span class="pill">Library</span></article>
        <article class="card"><span class="muted">Storage usage</span><div class="kpi">40%</div><span class="pill good">Healthy</span></article>
      </div>`;
  },

  settings(){
    content.innerHTML = `
      <div class="grid two">
        <article class="card"><h2>Cinema profile</h2>
          <div class="field"><label>Cinema ID<input value="BG-VT-PALACE-001" /></label></div>
          <div class="field"><label>Name<input value="Cinema Palace" /></label></div>
        </article>
        <article class="card"><h2>Storage architecture</h2>
          <div class="field"><label>Mode<select><option>Central Storage + Managed Hall Access</option><option>Shared Library</option><option>Managed Copy fallback</option></select></label></div>
          <p class="subtle">CinemaOS should use one central content source wherever supported. If a server requires an authorized local ingest, CinemaOS will manage that process rather than bypassing the server requirement.</p>
        </article>
      </div>`;
  }
};

function renderMovies(){
  const grid=document.querySelector("#moviesGrid");
  if(!state.movies.length){grid.innerHTML='<div class="empty">No movies yet.</div>';return}
  grid.innerHTML=state.movies.map(m=>`
    <article class="movie-card">
      <div class="card-head"><h3>${m.title}</h3>${statusPill(m.status)}</div>
      <p>${m.version}</p>
      <div class="meta"><span>${m.format}</span><span>${m.audio}</span></div>
      <div style="margin-top:16px"><button class="danger" data-delete-movie="${m.id}">Delete</button></div>
    </article>`).join("");
}

function openPage(name){
  nav.forEach(n=>n.classList.toggle("active",n.dataset.page===name));
  const active=nav.find(n=>n.dataset.page===name);
  title.textContent=active?.textContent||"CinemaOS";
  subtitle.textContent=name==="dashboard"?"Cinema Palace • Veliko Tarnovo":"CinemaOS Control Center";
  (pages[name]||pages.dashboard)();
}

nav.forEach(btn=>btn.addEventListener("click",()=>openPage(btn.dataset.page)));
document.querySelector("#quickMovie").onclick=()=>movieDialog.showModal();

document.addEventListener("click",e=>{
  const go=e.target.closest("[data-go]");
  if(go) openPage(go.dataset.go);
  const del=e.target.closest("[data-delete-movie]");
  if(del){
    state.movies=state.movies.filter(m=>m.id!==del.dataset.deleteMovie);
    save();renderMovies();
  }
});

movieForm.addEventListener("submit",e=>{
  e.preventDefault();
  const fd=new FormData(movieForm);
  state.movies.push({
    id:crypto.randomUUID(),
    title:fd.get("title"),
    version:fd.get("version")||"Original",
    format:fd.get("format"),
    audio:fd.get("audio"),
    status:"READY"
  });
  save();movieForm.reset();movieDialog.close();openPage("movies");
});

openPage("dashboard");