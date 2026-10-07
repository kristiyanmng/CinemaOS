import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION="0.2.1";
const DATA_DIR=path.join(process.env.PROGRAMDATA||process.cwd(),"CinemaOSAgent");
const CONFIG_PATH=path.join(DATA_DIR,"config.json");
const QUEUE_PATH=path.join(DATA_DIR,"queue.json");
const INBOX_DIR=path.join(DATA_DIR,"Inbox");
const DONE_DIR=path.join(DATA_DIR,"Done");

fs.mkdirSync(DATA_DIR,{recursive:true});
fs.mkdirSync(INBOX_DIR,{recursive:true});
fs.mkdirSync(DONE_DIR,{recursive:true});

function loadJson(file,fallback){
  try{
    const raw=fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"");
    return JSON.parse(raw);
  }catch(err){
    console.error("Could not read JSON config:",file);
    console.error(err.message);
    return fallback;
  }
}
function saveJson(file,value){
  const tmp=file+".tmp";
  fs.writeFileSync(tmp,JSON.stringify(value,null,2));
  fs.renameSync(tmp,file);
}

let config=loadJson(CONFIG_PATH,{
  apiBase:"https://cinemaos.kristianmarkov5.workers.dev",
  name:"CinemaOS Agent",
  enrollmentKey:"",
  agentId:"",
  agentToken:""
});
let queue=loadJson(QUEUE_PATH,[]);
let processingLocal=false;

async function api(pathname,options={}){
  const headers={"content-type":"application/json",...(options.headers||{})};
  if(config.agentToken) headers.authorization="Bearer "+config.agentToken;
  const r=await fetch(config.apiBase+pathname,{...options,headers,signal:options.signal||AbortSignal.timeout(30000)});
  const text=await r.text();
  let data={};
  try{data=text?JSON.parse(text):{}}catch{}
  if(!r.ok) throw new Error(data.detail?data.error+": "+data.detail:data.error||"HTTP "+r.status);
  return data;
}

async function enrollIfNeeded(){
  if(config.agentId&&config.agentToken)return;
  if(!config.enrollmentKey){
    console.log("STATUS: NOT ENROLLED");
    console.log("Edit "+CONFIG_PATH+" and set enrollmentKey, then restart.");
    return false;
  }
  const data=await api("/api/agents/enroll",{
    method:"POST",
    body:JSON.stringify({
      enrollmentKey:config.enrollmentKey,
      name:config.name,
      machineName:os.hostname(),
      version:VERSION,
      capabilities:["persistent_queue","heartbeat","job_polling"]
    })
  });
  config.agentId=data.agentId;
  config.agentToken=data.agentToken;
  config.enrollmentKey="";
  saveJson(CONFIG_PATH,config);
  console.log("STATUS: ENROLLED");
  console.log("Agent ID:",config.agentId);
  return true;
}

async function heartbeat(){
  if(!config.agentToken)return;
  await api("/api/agent/heartbeat",{
    method:"POST",
    body:JSON.stringify({
      machineName:os.hostname(),
      version:VERSION,
      capabilities:["persistent_queue","heartbeat","job_polling"]
    })
  });
}

function mergeJobs(remoteJobs){
  const known=new Map(queue.map(j=>[j.id,j]));
  for(const job of remoteJobs){
    if(!known.has(job.id)){
      queue.push({...job,localStatus:"QUEUED",receivedAt:new Date().toISOString()});
    }
  }
  saveJson(QUEUE_PATH,queue);
}

async function pollJobs(){
  if(!config.agentToken)return;
  const jobs=await api("/api/agent/jobs");
  mergeJobs(jobs);
}

async function cloudJson(pathname,method,body){
  return await api(pathname,{method,body:body?JSON.stringify(body):undefined});
}

async function uploadFileToCloud(job){
  const filePath=job.filePath;
  const stat=fs.statSync(filePath);
  const fileName=path.basename(filePath);
  const meta=job.meta||{};

  if(!job.multipart){
    const init=await cloudJson("/api/storage/multipart/init","POST",{
      assetType:meta.assetType||"OTHER",
      title:meta.title||path.parse(fileName).name,
      fileName,
      contentType:"application/octet-stream"
    });
    job.multipart={key:init.key,uploadId:init.uploadId,assetId:init.assetId,parts:[],chunkSize:20*1024*1024};
    job.status="UPLOADING";
    saveJson(QUEUE_PATH,queue);
  }

  const chunkSize=job.multipart.chunkSize||20*1024*1024;
  const totalParts=Math.ceil(stat.size/chunkSize);
  const completed=new Map((job.multipart.parts||[]).map(p=>[Number(p.partNumber),p]));

  const fd=fs.openSync(filePath,"r");
  try{
    for(let i=0;i<totalParts;i++){
      const partNumber=i+1;
      if(completed.has(partNumber))continue;

      const start=i*chunkSize;
      const length=Math.min(chunkSize,stat.size-start);
      const buffer=Buffer.allocUnsafe(length);
      fs.readSync(fd,buffer,0,length,start);

      const qs=new URLSearchParams({
        key:job.multipart.key,
        uploadId:job.multipart.uploadId,
        partNumber:String(partNumber)
      });

      console.log("Uploading",fileName,"part",partNumber+"/"+totalParts,"...");
      const r=await fetch(config.apiBase+"/api/storage/multipart/part?"+qs.toString(),{
        method:"PUT",
        headers:{authorization:"Bearer "+config.agentToken},
        body:buffer,
        signal:AbortSignal.timeout(120000)
      });
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(data.detail?data.error+": "+data.detail:data.error||"HTTP "+r.status);

      const part={partNumber:data.partNumber,etag:data.etag};
      job.multipart.parts.push(part);
      completed.set(partNumber,part);
      job.progress=Math.round((completed.size/totalParts)*100);
      job.status="UPLOADING";
      job.message="Uploading "+fileName;
      saveJson(QUEUE_PATH,queue);
      console.log("Progress:",job.progress+"%","("+completed.size+"/"+totalParts+" parts)");
    }
  }finally{
    fs.closeSync(fd);
  }

  job.multipart.parts.sort((a,b)=>a.partNumber-b.partNumber);
  await cloudJson("/api/storage/multipart/complete","POST",{
    key:job.multipart.key,
    uploadId:job.multipart.uploadId,
    parts:job.multipart.parts
  });

  await cloudJson("/api/content-assets","POST",{
    assetType:meta.assetType||"OTHER",
    title:meta.title||path.parse(fileName).name,
    durationSeconds:Number(meta.durationSeconds||0),
    format:"DCP package",
    language:meta.language||"",
    storageRef:job.multipart.key
  });

  job.status="READY";
  job.progress=100;
  job.message="Stored in CinemaOS";
  saveJson(QUEUE_PATH,queue);

  const target=path.join(DONE_DIR,fileName);
  try{
    if(fs.existsSync(target))fs.rmSync(target,{force:true});
    fs.renameSync(filePath,target);
    job.filePath=target;
    saveJson(QUEUE_PATH,queue);
  }catch{}
}

function discoverInbox(){
  const names=fs.readdirSync(INBOX_DIR);
  for(const name of names){
    const filePath=path.join(INBOX_DIR,name);
    let stat;
    try{stat=fs.statSync(filePath)}catch{continue}
    if(!stat.isFile())continue;
    const exists=queue.some(j=>j.filePath===filePath && j.status!=="READY");
    if(exists)continue;
    queue.push({
      id:"local-"+Date.now()+"-"+Math.random().toString(16).slice(2),
      source:"INBOX",
      filePath,
      status:"QUEUED",
      progress:0,
      message:"Discovered in Agent Inbox",
      meta:{assetType:"OTHER",title:path.parse(name).name,language:"",durationSeconds:0},
      createdAt:new Date().toISOString()
    });
    saveJson(QUEUE_PATH,queue);
    console.log("Queued local file:",name);
  }
}

async function processLocalQueue(){
  if(processingLocal)return;
  const job=queue.find(j=>j.source==="INBOX" && ["QUEUED","UPLOADING","PAUSED"].includes(j.status));
  if(!job)return;
  processingLocal=true;
  try{
    console.log("Starting transfer:",path.basename(job.filePath));
    await uploadFileToCloud(job);
    console.log("Transfer complete:",path.basename(job.filePath));
  }catch(err){
    job.status="PAUSED";
    job.message=err.message;
    saveJson(QUEUE_PATH,queue);
    console.error("Transfer paused:",err.message);
  }finally{
    processingLocal=false;
  }
}

async function tick(){
  try{
    const enrolled=await enrollIfNeeded();
    if(!config.agentToken){
      console.log(new Date().toISOString(),"Agent waiting for enrollment.");
      return;
    }
    await heartbeat();
    await pollJobs();
    discoverInbox();
    await processLocalQueue();
    const active=queue.filter(j=>["QUEUED","UPLOADING","PAUSED"].includes(j.status)).length;
    console.log(new Date().toISOString(),"STATUS: ONLINE | Queue:",active);
  }catch(err){
    console.error(new Date().toISOString(),"STATUS: ERROR |",err.message);
  }
}

console.log("CinemaOS Agent",VERSION);
console.log("Data:",DATA_DIR);
await tick();
setInterval(tick,15000);
