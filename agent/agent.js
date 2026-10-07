import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION="0.1.1";
const DATA_DIR=path.join(process.env.PROGRAMDATA||process.cwd(),"CinemaOSAgent");
const CONFIG_PATH=path.join(DATA_DIR,"config.json");
const QUEUE_PATH=path.join(DATA_DIR,"queue.json");

fs.mkdirSync(DATA_DIR,{recursive:true});

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

async function api(pathname,options={}){
  const headers={"content-type":"application/json",...(options.headers||{})};
  if(config.agentToken) headers.authorization="Bearer "+config.agentToken;
  const r=await fetch(config.apiBase+pathname,{...options,headers});
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

async function tick(){
  try{
    const enrolled=await enrollIfNeeded();
    if(!config.agentToken){
      console.log(new Date().toISOString(),"Agent waiting for enrollment.");
      return;
    }
    await heartbeat();
    await pollJobs();
    console.log(new Date().toISOString(),"STATUS: ONLINE | Queue:",queue.length);
  }catch(err){
    console.error(new Date().toISOString(),"STATUS: ERROR |",err.message);
  }
}

console.log("CinemaOS Agent",VERSION);
console.log("Data:",DATA_DIR);
await tick();
setInterval(tick,15000);
