const state={cinema:null,movies:[],halls:[],screenings:[],playlists:[],contentAssets:[],storageStatus:null,downloads:[
{name:"Avengers: Doomsday • BG Dub",progress:68,speed:"126 MB/s",status:"DOWNLOADING"},
{name:"Disney Trailer Pack",progress:100,speed:"Ready",status:"READY"}]};

const content=document.querySelector("#content");
const title=document.querySelector("#pageTitle");
const subtitle=document.querySelector("#pageSubtitle");
const nav=[...document.querySelectorAll(".nav-item")];
const movieDialog=document.querySelector("#movieDialog");
const movieForm=document.querySelector("#movieForm");

const api={
  async get(path){const r=await fetch(path);const d=await r.json();if(!r.ok)throw new Error(d.error||"Request failed");return d},
  async send(path,method,body){
    const r=await fetch(path,{
      method,
      headers:{"content-type":"application/json"},
      body:body?JSON.stringify(body):undefined
    });
    const text=await r.text();
    let d={};
    try{d=text?JSON.parse(text):{}}catch{
      const looksHtml=/<!doctype|<html/i.test(text||"");
      d={error:looksHtml ? ("Cloudflare Worker error (HTTP "+r.status+")") : (text||("HTTP "+r.status))}
    }
    if(!r.ok)throw new Error(d.detail ? (d.error+": "+d.detail) : (d.error||("HTTP "+r.status)));
    return d
  }
};

const statusPill=s=>'<span class="pill '+((s==="READY"||s==="ONLINE")?"good":s==="PLAYING"?"playing":s==="WAITING_CONTENT"?"warn":"")+'">'+s+'</span>';
const versions=()=>state.movies.flatMap(m=>(m.versions||[]).map(v=>({...v,movieId:m.id,movieTitle:m.title})));
const fmtDate=x=>new Date(x).toLocaleString("bg-BG");

async function refresh(){
  const d=await api.get("/api/bootstrap");
  Object.assign(state,{cinema:d.cinema,halls:d.halls||[],movies:d.movies||[],screenings:d.screenings||[]});
  state.playlists=await api.get("/api/playlists");
  state.contentAssets=await api.get("/api/content-assets");
  state.storageStatus=await api.get("/api/storage/status");
  subtitle.textContent=(state.cinema?.name||"CinemaOS")+" • "+(state.cinema?.city||"");
}

function modal(titleText,html,onSubmit){
  const d=document.createElement("dialog");d.className="dialog";
  d.innerHTML='<form method="dialog"><div class="dialog-head"><div><h2>'+titleText+'</h2></div><button value="cancel" class="icon-btn">×</button></div>'+html+'<div class="dialog-actions"><button value="cancel" class="ghost">Cancel</button><button type="submit" value="default" class="primary">Save</button></div></form>';
  document.body.appendChild(d);
  d.addEventListener("close",()=>d.remove());
  d.querySelector("form").addEventListener("submit",async e=>{e.preventDefault();try{await onSubmit(new FormData(e.currentTarget));d.close()}catch(err){alert(err.message)}});
  d.showModal();
}

const pages={
dashboard(){
content.innerHTML=`
<div class="grid stats">
<article class="card stat"><span>Halls</span><strong>${state.halls.length}</strong><small>D1 database</small></article>
<article class="card stat"><span>Movies</span><strong>${state.movies.length}</strong><small>Central library</small></article>
<article class="card stat"><span>Screenings</span><strong>${state.screenings.length}</strong><small>Shared schedule</small></article>
<article class="card stat"><span>Downloads</span><strong>${state.downloads.filter(d=>d.progress<100).length}</strong><small>Background queue</small></article>
</div>
<div class="grid two">
<article class="card"><div class="card-head"><h2>Hall status</h2><span class="pill good">D1 LIVE</span></div>
${state.halls.map(h=>'<div class="hall-row"><div><b>'+h.name+'</b><span>'+h.seats+' seats</span></div>'+statusPill(h.status)+'</div>').join("")||'<div class="empty">No halls.</div>'}</article>
<article class="card"><div class="card-head"><h2>Today's / upcoming screenings</h2><button class="link" data-go="schedule">Open</button></div>
<div class="timeline">${state.screenings.slice(0,5).map(s=>'<div><time>'+new Date(s.starts_at).toLocaleTimeString("bg-BG",{hour:"2-digit",minute:"2-digit"})+'</time><span>'+s.hall_name+'</span><b>'+s.movie_title+'</b></div>').join("")||'<div class="empty">No screenings.</div>'}</div></article>
</div>`},
contentLibrary(){
content.innerHTML=
'<div class="card" style="margin-bottom:18px"><div class="card-head"><div><h2>Content Library</h2><p class="muted">DCP trailers, advertisements and other preshow packages.</p></div><div style="display:flex;gap:8px"><button class="ghost" id="newContentAsset">+ Metadata only</button><button class="primary" id="uploadContentAsset">Import DCP</button></div></div><div class="notice">R2 Storage: '+(state.storageStatus?.configured?"CONNECTED":"NOT CONFIGURED")+' • Multipart R2 upload supports large DCP ZIP/packages; full feature DCP folders will use CinemaOS Agent.</div></div>'+
'<div class="page-grid">'+
(state.contentAssets.map(a=>'<article class="movie-card"><div class="card-head"><h3>'+a.title+'</h3><span class="pill '+(a.asset_type==="TRAILER"?"playing":a.asset_type==="AD"?"warn":"")+'">'+a.asset_type+'</span></div><p>'+(a.duration_seconds||0)+' sec • '+(a.format||"DCP")+'</p><div class="meta"><span>'+(a.language||"No language")+'</span><span>'+a.status+'</span><span>'+(a.storage_ref?"R2 FILE":"METADATA")+'</span></div><div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">'+(a.storage_ref?'<button class="ghost" data-preview-content="'+a.id+'">Preview / Open</button>':'')+'<button class="ghost" data-edit-content="'+a.id+'">Edit</button><button class="danger" data-delete-content="'+a.id+'">Delete</button></div></article>').join("")||'<div class="empty">No reusable content yet.</div>')+
'</div>';
document.querySelector("#newContentAsset").onclick=()=>openContentAssetModal();
document.querySelector("#uploadContentAsset").onclick=()=>openUploadContentModal()
},
movies(){
content.innerHTML='<div class="card" style="margin-bottom:18px"><div class="card-head"><div><h2>Movie Library</h2><p class="muted">Movies and all available versions.</p></div><button class="primary" id="newMovie">+ Add movie</button></div></div><div class="page-grid" id="moviesGrid"></div>';
renderMovies();document.querySelector("#newMovie").onclick=()=>movieDialog.showModal()},
delivery(){
content.innerHTML='<div class="card"><div class="card-head"><h2>Content Delivery Queue</h2><span class="pill warn">DEMO</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Content</th><th>Destination</th><th>Status</th><th>Progress</th></tr></thead><tbody>'+state.downloads.map(d=>'<tr><td>'+d.name+'</td><td>Central Storage</td><td>'+statusPill(d.status)+'</td><td>'+d.progress+'%</td></tr>').join("")+'</tbody></table></div></div>'},
schedule(){
content.innerHTML='<div class="card"><div class="card-head"><h2>Schedule</h2><button class="primary" id="newScreening">+ New screening</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Start</th><th>Hall</th><th>Movie</th><th>Version</th><th>Status</th><th></th></tr></thead><tbody>'+
(state.screenings.map(s=>'<tr><td>'+fmtDate(s.starts_at)+'</td><td>'+s.hall_name+'</td><td>'+s.movie_title+'</td><td>'+s.version_name+'</td><td>'+statusPill(s.status)+'</td><td><button class="danger" data-delete-screening="'+s.id+'">Delete</button></td></tr>').join("")||'<tr><td colspan="6">No screenings yet.</td></tr>')+
'</tbody></table></div></div>';
document.querySelector("#newScreening").onclick=()=>openScreeningModal()},
playlists(){
if(!state.screenings.length){content.innerHTML='<div class="card"><div class="empty">Create a screening first, then build its playlist.</div></div>';return}
content.innerHTML=
'<div class="card" style="margin-bottom:18px"><div class="card-head"><div><h2>Playlist Builder</h2><p class="muted">Ads → Trailers → Feature + automation cues.</p></div><button class="primary" id="newPlaylist">+ New playlist</button></div></div>'+
'<div class="page-grid">'+
(state.playlists.map(p=>'<article class="movie-card"><div class="card-head"><div><h3>'+p.movie_title+'</h3><p class="muted">'+fmtDate(p.starts_at)+' • '+p.hall_name+'</p></div><span class="pill good">'+(p.items?.length||0)+' ITEMS</span></div>'+
'<div class="queue-list">'+(p.items||[]).map(i=>'<div class="queue-row"><div><b>'+i.position+'. '+i.title+'</b><span>'+i.item_type+' • '+(i.duration_seconds||0)+' sec</span></div><button class="danger" data-delete-item="'+i.id+'">×</button></div>').join('')+'</div>'+
'<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap"><button class="ghost" data-add-playlist-item="'+p.id+'" data-item-type="AD">+ Ad</button><button class="ghost" data-add-playlist-item="'+p.id+'" data-item-type="TRAILER">+ Trailer</button><button class="ghost" data-add-playlist-item="'+p.id+'" data-item-type="CUE">+ Cue</button><button class="danger" data-delete-playlist="'+p.id+'">Delete playlist</button></div></article>').join('')||'<div class="empty">No playlists yet.</div>')+
'</div>';
document.querySelector("#newPlaylist").onclick=()=>openPlaylistModal()
},
halls(){
content.innerHTML='<div class="card" style="margin-bottom:18px"><div class="card-head"><div><h2>Halls</h2><p class="muted">Cinema halls stored in D1.</p></div><button class="primary" id="newHall">+ Add hall</button></div></div><div class="page-grid">'+state.halls.map(h=>'<article class="movie-card"><div class="card-head"><h3>'+h.name+'</h3>'+statusPill(h.status)+'</div><p>'+h.seats+' seats</p><div class="meta"><span>D1</span><span>ID '+h.id+'</span></div><div style="margin-top:16px;display:flex;gap:8px"><button class="ghost" data-edit-hall="'+h.id+'">Edit</button><button class="danger" data-delete-hall="'+h.id+'">Delete</button></div></article>').join("")+'</div>';
document.querySelector("#newHall").onclick=()=>openHallModal()},
automation(){content.innerHTML='<div class="grid two"><article class="card"><div class="card-head"><h2>Show Automation</h2><span class="pill warn">DEMO</span></div><p class="subtle">Future CinemaOS Agent commands for lights, curtains, audio and projector control.</p></article><article class="card"><h2>Hardware Adapter Layer</h2><p class="subtle">Real integration will use documented and authorized vendor interfaces.</p></article></div>'},
ai(){content.innerHTML='<div class="card"><div class="card-head"><h2>AI Assistant</h2><span class="pill ai">BETA</span></div><p class="subtle">Next: schedule optimization using real screening and hall data.</p></div>'},
reports(){content.innerHTML='<div class="grid three"><article class="card"><span class="muted">Screenings</span><div class="kpi">'+state.screenings.length+'</div></article><article class="card"><span class="muted">Movies</span><div class="kpi">'+state.movies.length+'</div></article><article class="card"><span class="muted">Halls</span><div class="kpi">'+state.halls.length+'</div></article></div>'},
settings(){content.innerHTML='<div class="grid two"><article class="card"><h2>Cinema profile</h2><div class="field"><label>Cinema ID<input value="'+(state.cinema?.id||"")+'" readonly></label></div><div class="field"><label>Name<input value="'+(state.cinema?.name||"")+'" readonly></label></div></article><article class="card"><h2>Database</h2><p class="subtle">Cloudflare D1 connected.</p></article></div>'}
};

function renderMovies(){
const grid=document.querySelector("#moviesGrid");
if(!state.movies.length){grid.innerHTML='<div class="empty">No movies yet.</div>';return}
grid.innerHTML=state.movies.map(m=>'<article class="movie-card"><div class="card-head"><h3>'+m.title+'</h3><span class="pill good">'+(m.versions?.length||0)+' VERSION(S)</span></div><p>'+(m.distributor||"No distributor")+'</p><div class="meta">'+(m.versions||[]).map(v=>'<span>'+v.name+' • '+(v.format||"DCP")+' • '+(v.audio||"")+'</span>').join("")+'</div><div style="margin-top:16px;display:flex;gap:8px"><button class="ghost" data-add-version="'+m.id+'">+ Version</button><button class="danger" data-delete-movie="'+m.id+'">Delete</button></div></article>').join("")
}

async function multipartUpload(file,meta,onProgress){
  const init=await api.send("/api/storage/multipart/init","POST",{
    assetType:meta.assetType,
    title:meta.title,
    fileName:file.name,
    contentType:file.type||"application/octet-stream"
  });

  const chunkSize=20*1024*1024;
  const totalParts=Math.ceil(file.size/chunkSize);
  const parts=[];

  try{
    for(let i=0;i<totalParts;i++){
      const start=i*chunkSize;
      const end=Math.min(file.size,start+chunkSize);
      const blob=file.slice(start,end);

      const qs=new URLSearchParams({
        key:init.key,
        uploadId:init.uploadId,
        partNumber:String(i+1)
      });

      const r=await fetch("/api/storage/multipart/part?"+qs.toString(),{
        method:"PUT",
        body:blob
      });

      const data=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.detail?(data.error+": "+data.detail):(data.error||("HTTP "+r.status)));
      parts.push({partNumber:data.partNumber,etag:data.etag});

      onProgress(Math.round(((i+1)/totalParts)*100));
    }

    await api.send("/api/storage/multipart/complete","POST",{
      key:init.key,
      uploadId:init.uploadId,
      parts
    });

    return init;
  }catch(err){
    try{
      await api.send("/api/storage/multipart/abort","POST",{
        key:init.key,
        uploadId:init.uploadId
      });
    }catch{}
    throw err;
  }
}

function openUploadContentModal(){
if(!state.storageStatus?.configured){alert("R2 is not connected yet.");return}

const d=document.createElement("dialog");d.className="dialog";
d.innerHTML='<form><div class="dialog-head"><div><h2>Import DCP package</h2><p>Upload a ZIP/package containing trailer, advertisement or other cinema content.</p></div><button type="button" class="icon-btn" data-close>×</button></div><div class="form-grid"><label>Type<select name="assetType"><option value="TRAILER">Trailer DCP</option><option value="AD">Advertisement DCP</option><option value="OTHER">Other DCP</option></select></label><label>Title<input name="title" required></label><label>Duration (sec)<input name="duration" type="number" min="0" value="30"></label><label>Language<input name="language" placeholder="bg / en"></label><label style="grid-column:1/-1">DCP package / ZIP<input name="file" type="file" accept=".zip,.dcp,application/zip,application/octet-stream" required></label></div><div class="notice" style="margin-top:14px">Large files are uploaded to R2 in 20 MB parts. For full feature DCP folders, CinemaOS Agent will later ingest directly from local disk/NAS without ZIP.</div><div class="download" style="margin-top:18px"><div class="download-top"><b id="uploadLabel">Waiting</b><span id="uploadPct">0%</span></div><div class="progress"><i id="uploadBar" style="width:0%"></i></div></div><div class="dialog-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="submit" class="primary">Import DCP</button></div></form>';

document.body.appendChild(d);
d.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>d.close());
d.addEventListener("close",()=>d.remove());

d.querySelector("form").addEventListener("submit",async e=>{
  e.preventDefault();
  const fd=new FormData(e.currentTarget);
  const file=fd.get("file");
  if(!(file instanceof File)||!file.size)return;

  const submit=e.currentTarget.querySelector('button[type="submit"]');
  submit.disabled=true;

  const bar=d.querySelector("#uploadBar");
  const pct=d.querySelector("#uploadPct");
  const label=d.querySelector("#uploadLabel");

  try{
    label.textContent="Uploading DCP package "+file.name;

    const uploaded=await multipartUpload(file,{
      assetType:fd.get("assetType"),
      title:fd.get("title")
    },p=>{
      bar.style.width=p+"%";
      pct.textContent=p+"%";
    });

    label.textContent="Saving CinemaOS metadata";

    await api.send("/api/content-assets","POST",{
      assetType:fd.get("assetType"),
      title:fd.get("title"),
      durationSeconds:Number(fd.get("duration")),
      format:"DCP package",
      language:fd.get("language"),
      storageRef:uploaded.key
    });

    state.contentAssets=await api.get("/api/content-assets");
    d.close();
    pages.contentLibrary();
  }catch(err){
    submit.disabled=false;
    alert(err.message);
  }
});

d.showModal();
}

function openContentAssetModal(asset){
modal(asset?"Edit content":"Add content",'<div class="form-grid"><label>Type<select name="assetType"><option value="TRAILER">Trailer</option><option value="AD">Advertisement</option><option value="OTHER">Other</option></select></label><label>Title<input name="title" required value="'+(asset?.title||"")+'"></label><label>Duration (sec)<input name="duration" type="number" min="0" value="'+(asset?.duration_seconds||30)+'"></label><label>Format<select name="format"><option>DCP</option><option>2K DCP</option><option>4K DCP</option><option>Other</option></select></label><label>Language<input name="language" value="'+(asset?.language||"")+'" placeholder="bg / en"></label><label>Status<select name="status"><option>READY</option><option>PROCESSING</option><option>OFFLINE</option></select></label></div>',async fd=>{
const payload={assetType:fd.get("assetType"),title:fd.get("title"),durationSeconds:Number(fd.get("duration")),format:fd.get("format"),language:fd.get("language"),status:fd.get("status")};
if(asset) await api.send("/api/content-assets/"+asset.id,"PUT",payload);
else await api.send("/api/content-assets","POST",payload);
state.contentAssets=await api.get("/api/content-assets");pages.contentLibrary()
});
}

function openHallModal(hall){
modal(hall?"Edit hall":"Add hall",'<div class="form-grid"><label>Name<input name="name" required value="'+(hall?.name||"")+'"></label><label>Seats<input name="seats" type="number" min="0" value="'+(hall?.seats||0)+'"></label><label>Status<select name="status"><option>IDLE</option><option>READY</option><option>PLAYING</option><option>OFFLINE</option></select></label></div>',async fd=>{
if(hall)await api.send("/api/halls/"+hall.id,"PUT",{name:fd.get("name"),seats:Number(fd.get("seats")),status:fd.get("status")});
else await api.send("/api/halls","POST",{name:fd.get("name"),seats:Number(fd.get("seats"))});
state.halls=await api.get("/api/halls");pages.halls()
});
}

function openVersionModal(movieId){
modal("Add movie version",'<div class="form-grid"><label>Version<input name="version" required placeholder="BG Dub"></label><label>Format<select name="format"><option>2K DCP</option><option>4K DCP</option><option>Trailer DCP</option></select></label><label>Audio<select name="audio"><option>Dolby 7.1</option><option>5.1</option><option>Atmos</option></select></label><label>Language<input name="language" placeholder="bg"></label></div>',async fd=>{
await api.send("/api/movies/"+movieId+"/versions","POST",{version:fd.get("version"),format:fd.get("format"),audio:fd.get("audio"),language:fd.get("language")});
state.movies=await api.get("/api/movies");pages.movies()
});
}

function openPlaylistModal(){
const used=new Set(state.playlists.map(p=>p.screening_id));
const available=state.screenings.filter(s=>!used.has(s.id));
if(!available.length){alert("Every screening already has a playlist.");return}
modal("New playlist",'<div class="form-grid"><label>Screening<select name="screeningId">'+available.map(s=>'<option value="'+s.id+'">'+fmtDate(s.starts_at)+' — '+s.hall_name+' — '+s.movie_title+' '+s.version_name+'</option>').join("")+'</select></label><label>Name<input name="name" value="Show Playlist"></label></div>',async fd=>{
const s=state.screenings.find(x=>x.id===fd.get("screeningId"));
await api.send("/api/playlists","POST",{screeningId:s.id,name:fd.get("name"),movieVersionId:s.version_id});
state.playlists=await api.get("/api/playlists");pages.playlists()
});
}

function openPlaylistItemModal(playlistId,itemType){
if(itemType==="CUE"){
  modal("Add automation cue",'<div class="form-grid"><label>Title<input name="title" required value="Automation Cue"></label><label>Lights %<input name="lights" type="number" min="0" max="100" value="20"></label></div>',async fd=>{
    await api.send("/api/playlists/"+playlistId+"/items","POST",{itemType:"CUE",title:fd.get("title"),durationSeconds:0,cue:{lights:Number(fd.get("lights"))}});
    state.playlists=await api.get("/api/playlists");pages.playlists()
  });
  return;
}
const matches=state.contentAssets.filter(a=>a.asset_type===itemType&&a.status==="READY");
if(!matches.length){alert("No READY "+itemType+" content in Content Library.");return}
modal("Add "+itemType+' from library','<div class="form-grid"><label>Content<select name="assetId">'+matches.map(a=>'<option value="'+a.id+'">'+a.title+' • '+a.duration_seconds+' sec</option>').join("")+'</select></label><label>Lights %<input name="lights" type="number" min="0" max="100" value="'+(itemType==="AD"?70:50)+'"></label></div>',async fd=>{
const asset=matches.find(a=>a.id===fd.get("assetId"));
await api.send("/api/playlists/"+playlistId+"/items","POST",{itemType,title:asset.title,sourceRef:asset.id,durationSeconds:Number(asset.duration_seconds||0),cue:{lights:Number(fd.get("lights"))}});
state.playlists=await api.get("/api/playlists");pages.playlists()
});
}

function openScreeningModal(){
const vs=versions();
if(!state.halls.length||!vs.length){alert("You need at least one hall and one movie version.");return}
modal("New screening",'<div class="form-grid"><label>Hall<select name="hallId">'+state.halls.map(h=>'<option value="'+h.id+'">'+h.name+'</option>').join("")+'</select></label><label>Movie / version<select name="versionId">'+vs.map(v=>'<option value="'+v.id+'">'+v.movieTitle+' — '+v.name+'</option>').join("")+'</select></label><label>Start<input name="startsAt" type="datetime-local" required></label></div>',async fd=>{
const local=fd.get("startsAt");const iso=new Date(local).toISOString();
await api.send("/api/screenings","POST",{hallId:fd.get("hallId"),versionId:fd.get("versionId"),startsAt:iso});
state.screenings=await api.get("/api/screenings");pages.schedule()
});
}

function openPage(name){nav.forEach(n=>n.classList.toggle("active",n.dataset.page===name));title.textContent=nav.find(n=>n.dataset.page===name)?.textContent||"CinemaOS";if(name!=="dashboard")subtitle.textContent="CinemaOS Control Center";(pages[name]||pages.dashboard)()}
nav.forEach(btn=>btn.addEventListener("click",()=>openPage(btn.dataset.page)));
document.querySelector("#quickMovie").onclick=()=>movieDialog.showModal();

document.addEventListener("click",async e=>{
const go=e.target.closest("[data-go]");if(go)openPage(go.dataset.go);
const del=e.target.closest("[data-delete-movie]");if(del&&confirm("Delete this movie and its versions?")){await api.send("/api/movies/"+encodeURIComponent(del.dataset.deleteMovie),"DELETE");state.movies=await api.get("/api/movies");renderMovies()}
const av=e.target.closest("[data-add-version]");if(av)openVersionModal(av.dataset.addVersion);
const eh=e.target.closest("[data-edit-hall]");if(eh)openHallModal(state.halls.find(h=>h.id===eh.dataset.editHall));
const dh=e.target.closest("[data-delete-hall]");if(dh&&confirm("Delete this hall?")){try{await api.send("/api/halls/"+encodeURIComponent(dh.dataset.deleteHall),"DELETE");state.halls=await api.get("/api/halls");pages.halls()}catch(err){alert(err.message)}}
const ds=e.target.closest("[data-delete-screening]");if(ds&&confirm("Delete this screening?")){await api.send("/api/screenings/"+encodeURIComponent(ds.dataset.deleteScreening),"DELETE");state.screenings=await api.get("/api/screenings");state.playlists=await api.get("/api/playlists");pages.schedule()}
const apiBtn=e.target.closest("[data-add-playlist-item]");if(apiBtn)openPlaylistItemModal(apiBtn.dataset.addPlaylistItem,apiBtn.dataset.itemType);
const di=e.target.closest("[data-delete-item]");if(di&&confirm("Delete this playlist item?")){await api.send("/api/playlist-items/"+encodeURIComponent(di.dataset.deleteItem),"DELETE");state.playlists=await api.get("/api/playlists");pages.playlists()}
const dp=e.target.closest("[data-delete-playlist]");if(dp&&confirm("Delete this playlist?")){await api.send("/api/playlists/"+encodeURIComponent(dp.dataset.deletePlaylist),"DELETE");state.playlists=await api.get("/api/playlists");pages.playlists()}
const pc=e.target.closest("[data-preview-content]");if(pc){const a=state.contentAssets.find(x=>x.id===pc.dataset.previewContent);if(a?.storage_ref)window.open("/api/storage/object/"+encodeURIComponent(a.storage_ref),"_blank")}
const ec=e.target.closest("[data-edit-content]");if(ec)openContentAssetModal(state.contentAssets.find(a=>a.id===ec.dataset.editContent));
const dc=e.target.closest("[data-delete-content]");if(dc&&confirm("Delete this content item?")){await api.send("/api/content-assets/"+encodeURIComponent(dc.dataset.deleteContent),"DELETE");state.contentAssets=await api.get("/api/content-assets");pages.contentLibrary()}
});

movieForm.addEventListener("submit",async e=>{e.preventDefault();const fd=new FormData(movieForm);try{await api.send("/api/movies","POST",{title:fd.get("title"),version:fd.get("version")||"Original",format:fd.get("format"),audio:fd.get("audio")});state.movies=await api.get("/api/movies");movieForm.reset();movieDialog.close();openPage("movies")}catch(err){alert(err.message)}});

(async()=>{await refresh();openPage("dashboard")})();