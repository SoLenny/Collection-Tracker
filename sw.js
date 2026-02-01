const CACHE="collection-tracker-v4.1.2";
const ASSETS=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icon-192.png","./icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil((async()=>{const c=await caches.open(CACHE);await c.addAll(ASSETS);self.skipWaiting();})())});
self.addEventListener("activate",e=>{e.waitUntil((async()=>{const ks=await caches.keys();await Promise.all(ks.map(k=>k===CACHE?null:caches.delete(k)));self.clients.claim();})())});
self.addEventListener("fetch",e=>{
  const req=e.request; const url=new URL(req.url);
  if(url.origin!==location.origin) return;
  const isCore=url.pathname.endsWith("/")||url.pathname.endsWith("/index.html")||url.pathname.endsWith("/styles.css")||url.pathname.endsWith("/app.js")||url.pathname.endsWith("/manifest.webmanifest")||url.pathname.endsWith("/sw.js");
  e.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(isCore){
      try{const fresh=await fetch(new Request(req,{cache:"reload"}));cache.put(req,fresh.clone());return fresh;}
      catch{const cached=await cache.match(req); if(cached) return cached; return new Response("Offline",{status:503});}
    }
    const cached=await cache.match(req); if(cached) return cached;
    try{const res=await fetch(req); if(req.method==="GET") cache.put(req,res.clone()); return res;}
    catch{return new Response("Offline",{status:503});}
  })());
});
