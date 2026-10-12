// Static shell only: never intercept Supabase, authenticated requests,
// callback/query URLs, record APIs, POSTs or unknown resources.
const CACHE='homehub-app-static-v2';
const ROOT=new URL('./',self.location.href);
const FILES=['','index.html','style.css','app.js','production-app.js','calendar/model.js','calendar/ui.js','calendar/repository.js','calendar/realtime.js','calendar/notifications.js','features.js','documents.js','pwa.js','manifest.webmanifest','vendor/supabase-2.117.3.js','icons/homehub-180.png','icons/homehub-192.png','icons/homehub-512.png','icons/homehub-maskable-512.png','icons/splash-1170x2532.png','icons/splash-1179x2556.png','icons/splash-1290x2796.png'];
const ALLOWED=new Set(FILES.map(path=>new URL(path,ROOT).href));
function cacheable(request){
 const url=new URL(request.url);
 return request.method==='GET'&&!request.headers.has('authorization')&&url.origin===ROOT.origin&&!url.search&&ALLOWED.has(url.href);
}
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{const cache=await caches.open(CACHE);for(const path of FILES){const url=new URL(path,ROOT);const response=await fetch(new Request(url,{credentials:'omit',cache:'reload'}));if(!response.ok||response.redirected||response.type==='opaque')throw new Error('Static shell unavailable');await cache.put(url,response);}})());
 // Wait for old tabs to close; never interrupt an open record editor.
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('homehub-app-static-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})());
});
self.addEventListener('fetch',event=>{
 if(!cacheable(event.request))return;
 event.respondWith((async()=>{
  const cached=await caches.match(event.request,{cacheName:CACHE});
  // Do not dynamically put responses in Cache Storage. Install writes only
  // the public shell fetched without cookies or authorization headers.
  if(event.request.mode==='navigate'){try{return await fetch(event.request);}catch{if(cached)return cached;throw new Error('Offline shell unavailable');}}
  return cached||fetch(event.request);
 })());
});
