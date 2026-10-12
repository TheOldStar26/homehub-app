// Static shell only: never intercept Supabase, authenticated requests,
// callback/query URLs, record APIs, POSTs or unknown resources.
const CACHE='homehub-app-static-v6';
const ROOT=new URL('./',self.location.href);
const FILES=['','index.html','style.css','app.js','tablet.js','production-app.js','calendar/model.js','calendar/ui.js','calendar/repository.js','calendar/realtime.js','calendar/notifications.js','features.js','documents.js','pwa.js','manifest.webmanifest','vendor/supabase-2.117.3.js','icons/homehub-180.png','icons/homehub-192.png','icons/homehub-512.png','icons/homehub-maskable-512.png','icons/splash-1170x2532.png','icons/splash-1179x2556.png','icons/splash-1290x2796.png'];
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

self.addEventListener('push',event=>{let data={};try{data=event.data?.json()||{}}catch{}const title=typeof data.title==='string'?data.title:'HomeHub reminder';const body=typeof data.body==='string'?data.body:'You have an upcoming calendar event.';const url=new URL('./',self.location.href);if(typeof data.eventId==='string')url.searchParams.set('event',data.eventId);if(typeof data.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(data.date))url.searchParams.set('date',data.date);event.waitUntil(self.registration.showNotification(title,{body,icon:new URL('icons/homehub-192.png',self.location.href).href,tag:typeof data.tag==='string'?data.tag:'homehub-reminder',data:{url:url.href}}))});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url||new URL('./',self.location.href).href;event.waitUntil((async()=>{const windows=await clients.matchAll({type:'window',includeUncontrolled:true});for(const w of windows){if(w.url.startsWith(new URL('./',self.location.href).href)){await w.navigate(url);return w.focus()}}return clients.openWindow(url)})())});
