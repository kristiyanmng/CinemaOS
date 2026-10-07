import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const {Service}=require("node-windows");
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const svc=new Service({
  name:"CinemaOS Agent",
  description:"CinemaOS persistent cinema transfer and device agent",
  script:path.join(__dirname,"agent.js"),
  nodeOptions:[],
  env:[{name:"NODE_ENV",value:"production"}]
});
svc.on("install",()=>{console.log("CinemaOS Agent service installed.");svc.start()});
svc.on("alreadyinstalled",()=>console.log("CinemaOS Agent service is already installed."));
svc.on("start",()=>console.log("CinemaOS Agent service started."));
svc.on("error",err=>console.error(err));
svc.install();
