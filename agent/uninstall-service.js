import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {Service}=require("node-windows");
const svc=new Service({name:"CinemaOS Agent",script:new URL("./agent.js",import.meta.url).pathname});
svc.on("uninstall",()=>console.log("CinemaOS Agent service removed."));
svc.on("error",err=>console.error(err));
svc.uninstall();
