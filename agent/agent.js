import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

const VERSION="0.4.0";
const DATA_DIR=path.join(process.env.PROGRAMDATA||process.cwd(),"CinemaOSAgent");
const CONFIG_PATH=path.join(DATA_DIR,"config.json");
const QUEUE_PATH=path.join(DATA_DIR,"queue.json");
const INBOX_DIR=path.join(DATA_DIR,"Inbox");
const DONE_DIR=path.join(DATA_DIR,"Done");
const STORAGE_DIR=path.join(DATA_DIR,"CentralStorage");

fs.mkdirSync(DATA_DIR,{recursive:true});
fs.mkdirSync(INBOX_DIR,{recursive:true});
fs.mkdirSync(DONE_DIR,{recursive:true});
fs.mkdirSync(STORAGE_DIR,{recursive:true});

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
      capabilities:["persistent_queue","heartbeat","job_polling","dcp_analysis","live_transfer_reporting"]
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
      capabilities:["persistent_queue","heartbeat","job_polling","dcp_folder_ingest","local_storage_registry","hardware_adapter_foundation"]
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

function xmlText(xml,tag){
  const m=xml.match(new RegExp("<(?:\\w+:)?"+tag+"[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?"+tag+">","i"));
  return m?m[1].replace(/<[^>]+>/g,"").trim():"";
}

function walkDirectory(root){
  const files=[];
  const stack=[root];
  while(stack.length){
    const current=stack.pop();
    let entries=[];
    try{entries=fs.readdirSync(current,{withFileTypes:true})}catch{continue}
    for(const e of entries){
      const full=path.join(current,e.name);
      if(e.isDirectory())stack.push(full);
      else if(e.isFile())files.push(full);
    }
  }
  return files;
}

function analyzeDcpFolder(folderPath){
  const result={
    hasAssetMap:false,hasPkl:false,hasCpl:false,packageFiles:0,bytesTotal:0,
    cplId:"",annotationText:"",editRate:"",durationFrames:0,runtimeSeconds:0,encrypted:false
  };
  const files=walkDirectory(folderPath);
  result.packageFiles=files.length;
  const cpls=[];
  for(const file of files){
    const base=path.basename(file).toUpperCase();
    try{result.bytesTotal+=fs.statSync(file).size}catch{}
    if(base==="ASSETMAP"||base==="ASSETMAP.XML")result.hasAssetMap=true;
    if(base.startsWith("PKL_")&&base.endsWith(".XML"))result.hasPkl=true;
    if(base.startsWith("CPL_")&&base.endsWith(".XML")){
      result.hasCpl=true;
      try{cpls.push(fs.readFileSync(file,"utf8"))}catch{}
    }
  }
  const cpl=cpls[0]||"";
  if(cpl){
    result.cplId=xmlText(cpl,"Id");
    result.annotationText=xmlText(cpl,"ContentTitleText")||xmlText(cpl,"AnnotationText");
    result.editRate=xmlText(cpl,"EditRate");
    const duration=Number(xmlText(cpl,"Duration")||xmlText(cpl,"IntrinsicDuration")||0);
    result.durationFrames=duration;
    const rate=Number((result.editRate.match(/\d+/)||["0"])[0]);
    result.runtimeSeconds=rate>0?Math.round(duration/rate):0;
    result.encrypted=/<(?:\w+:)?KeyId[>\s]/i.test(cpl);
  }
  return result;
}

function analyzeDcpPackage(filePath){
  const result={
    hasAssetMap:false,hasPkl:false,hasCpl:false,packageFiles:0,
    cplId:"",annotationText:"",editRate:"",durationFrames:0,runtimeSeconds:0,encrypted:false
  };
  if(path.extname(filePath).toLowerCase()!==".zip") return result;
  try{
    const zip=new AdmZip(filePath);
    const entries=zip.getEntries();
    result.packageFiles=entries.length;
    const xmls=[];
    for(const e of entries){
      const base=path.basename(e.entryName).toUpperCase();
      if(base==="ASSETMAP"||base==="ASSETMAP.XML") result.hasAssetMap=true;
      if(base.startsWith("PKL_")&&base.endsWith(".XML")) result.hasPkl=true;
      if(base.startsWith("CPL_")&&base.endsWith(".XML")){
        result.hasCpl=true;
        try{xmls.push(e.getData().toString("utf8"))}catch{}
      }
    }
    const cpl=xmls[0]||"";
    if(cpl){
      result.cplId=xmlText(cpl,"Id");
      result.annotationText=xmlText(cpl,"ContentTitleText")||xmlText(cpl,"AnnotationText");
      result.editRate=xmlText(cpl,"EditRate");
      const duration=Number(xmlText(cpl,"Duration")||xmlText(cpl,"IntrinsicDuration")||0);
      result.durationFrames=duration;
      const rate=Number((result.editRate.match(/\d+/)||["0"])[0]);
      result.runtimeSeconds=rate>0?Math.round(duration/rate):0;
      result.encrypted=/<(?:\w+:)?KeyId[>\s]/i.test(cpl);
    }
  }catch(err){
    result.analysisError=err.message;
  }
  return result;
}

async function reportTransfer(job,stat,startTime){
  if(!config.agentToken)return;
  const bytesTotal=Number(stat?.size||0);
  const completedParts=(job.multipart?.parts||[]).length;
  const chunkSize=job.multipart?.chunkSize||20*1024*1024;
  const bytesDone=Math.min(bytesTotal,completedParts*chunkSize);
  const elapsed=Math.max(1,(Date.now()-startTime)/1000);
  const speedBps=Math.round(bytesDone/elapsed);
  try{
    await cloudJson("/api/agent/transfers/report","POST",{
      id:job.id,fileName:path.basename(job.filePath),direction:"UPLOAD",
      status:job.status||"QUEUED",progress:Number(job.progress||0),
      bytesDone,bytesTotal,speedBps,message:job.message||""
    });
  }catch{}
}

async function cloudJson(pathname,method,body){
  return await api(pathname,{method,body:body?JSON.stringify(body):undefined});
}

async function uploadFileToCloud(job){
  const filePath=job.filePath;
  const stat=fs.statSync(filePath);
  const fileName=path.basename(filePath);
  const meta=job.meta||{};
  const startedAt=job.startedAt||Date.now();
  job.startedAt=startedAt;
  if(!job.analysis){
    job.analysis=analyzeDcpPackage(filePath);
    if(job.analysis.annotationText) meta.title=job.analysis.annotationText;
    if(job.analysis.runtimeSeconds) meta.durationSeconds=job.analysis.runtimeSeconds;
    if(/_TLR|TRAILER/i.test(fileName)) meta.assetType="TRAILER";
    job.meta=meta;
    saveJson(QUEUE_PATH,queue);
  }

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
    await reportTransfer(job,stat,startedAt);
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
      await reportTransfer(job,stat,startedAt);
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

  const createdAsset=await cloudJson("/api/content-assets","POST",{
    assetType:meta.assetType||"OTHER",
    title:meta.title||path.parse(fileName).name,
    durationSeconds:Number(meta.durationSeconds||0),
    format:"DCP package",
    language:meta.language||"",
    storageRef:job.multipart.key
  });

  if(createdAsset?.id){
    await cloudJson("/api/content-assets/"+encodeURIComponent(createdAsset.id)+"/metadata","POST",job.analysis||{});
  }

  job.status="READY";
  job.progress=100;
  job.message="Stored in CinemaOS";
  saveJson(QUEUE_PATH,queue);
  await reportTransfer(job,stat,startedAt);

  const target=path.join(DONE_DIR,fileName);
  try{
    if(fs.existsSync(target))fs.rmSync(target,{force:true});
    fs.renameSync(filePath,target);
    job.filePath=target;
    saveJson(QUEUE_PATH,queue);
  }catch{}
}

async function reportLocalFolder(folderPath){
  const analysis=analyzeDcpFolder(folderPath);
  if(!(analysis.hasAssetMap||analysis.hasPkl||analysis.hasCpl)) return false;
  const localKey="inbox-folder:"+path.basename(folderPath);
  const title=analysis.annotationText||path.basename(folderPath);
  await cloudJson("/api/agent/local-assets/report","POST",{
    localKey,
    title,
    packageType:"DCP_FOLDER",
    localPathLabel:path.basename(folderPath),
    bytesTotal:analysis.bytesTotal,
    filesTotal:analysis.packageFiles,
    cplId:analysis.cplId,
    annotationText:analysis.annotationText,
    editRate:analysis.editRate,
    runtimeSeconds:analysis.runtimeSeconds,
    encrypted:analysis.encrypted,
    hasAssetMap:analysis.hasAssetMap,
    hasPkl:analysis.hasPkl,
    hasCpl:analysis.hasCpl,
    status:"READY"
  });
  return true;
}

async function discoverDcpFolders(){
  let entries=[];
  try{entries=fs.readdirSync(INBOX_DIR,{withFileTypes:true})}catch{return}
  for(const e of entries){
    if(!e.isDirectory())continue;
    const full=path.join(INBOX_DIR,e.name);
    const key="folder:"+full;
    const existing=queue.find(j=>j.id===key);
    if(existing&&existing.status==="REGISTERED")continue;
    try{
      const ok=await reportLocalFolder(full);
      if(ok){
        if(existing){existing.status="REGISTERED";existing.progress=100}
        else queue.push({id:key,source:"FOLDER",filePath:full,status:"REGISTERED",progress:100,message:"DCP folder registered in CinemaOS"});
        saveJson(QUEUE_PATH,queue);
        console.log("Registered DCP folder:",e.name);
      }
    }catch(err){console.error("Folder analysis failed:",e.name,err.message)}
  }
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

async function reportRemoteJob(job,status,progress,message){
  try{
    await api("/api/agent/jobs/"+encodeURIComponent(job.id),{
      method:"PUT",
      body:JSON.stringify({status,progress,message})
    });
  }catch{}
}

async function downloadRemoteContent(job){
  let payload={};
  try{payload=JSON.parse(job.payload_json||"{}")}catch{}
  const storageRef=String(payload.storageRef||"");
  if(!storageRef) throw new Error("Missing storageRef");
  const fileName=String(payload.fileName||path.basename(storageRef)||"content.bin").replace(/[<>:"/\\|?*]/g,"_");
  const finalPath=path.join(STORAGE_DIR,fileName);
  const tempPath=finalPath+".part";
  let offset=0;
  try{offset=fs.existsSync(tempPath)?fs.statSync(tempPath).size:0}catch{}

  await reportRemoteJob(job,"RUNNING",Number(job.progress||0),"Downloading to central storage");
  const headers={authorization:"Bearer "+config.agentToken};
  if(offset>0)headers.range="bytes="+offset+"-";
  const r=await fetch(config.apiBase+"/api/storage/object/"+encodeURIComponent(storageRef),{
    method:"GET",headers,signal:AbortSignal.timeout(120000)
  });
  if(!r.ok && r.status!==206) throw new Error("Download HTTP "+r.status);

  const totalHeader=Number(r.headers.get("content-length")||0);
  const total=offset+totalHeader;
  const fh=fs.openSync(tempPath,offset>0?"a":"w");
  let done=offset,lastReport=Date.now();
  try{
    const reader=r.body.getReader();
    while(true){
      const {done:ended,value}=await reader.read();
      if(ended)break;
      fs.writeSync(fh,value);
      done+=value.byteLength;
      if(Date.now()-lastReport>1000){
        const p=total?Math.min(99,Math.round(done/total*100)):0;
        await reportRemoteJob(job,"RUNNING",p,"Downloading "+fmtLocalBytes(done)+" / "+fmtLocalBytes(total));
        lastReport=Date.now();
      }
    }
  }finally{fs.closeSync(fh)}
  if(fs.existsSync(finalPath))fs.rmSync(finalPath,{force:true});
  fs.renameSync(tempPath,finalPath);
  await reportRemoteJob(job,"READY",100,"Stored in CentralStorage");
}

function fmtLocalBytes(n){
  n=Number(n||0);if(n<1024)return n+" B";if(n<1048576)return (n/1024).toFixed(1)+" KB";if(n<1073741824)return (n/1048576).toFixed(1)+" MB";return (n/1073741824).toFixed(2)+" GB";
}

async function processRemoteJobs(remoteJobs){
  for(const job of remoteJobs||[]){
    if(job.job_type!=="DOWNLOAD_CONTENT")continue;
    if(job.status==="RUNNING")continue;
    try{
      console.log("Remote job:",job.job_type,job.id);
      await downloadRemoteContent(job);
      console.log("Remote download complete:",job.id);
    }catch(err){
      await reportRemoteJob(job,"PAUSED",Number(job.progress||0),err.message);
      console.error("Remote job paused:",err.message);
    }
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
    try{const stat=fs.existsSync(job.filePath)?fs.statSync(job.filePath):null;await reportTransfer(job,stat,job.startedAt||Date.now())}catch{}
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
    const remoteJobs=await api("/api/agent/jobs");
    mergeJobs(remoteJobs);
    await processRemoteJobs(remoteJobs);
    await discoverDcpFolders();
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
