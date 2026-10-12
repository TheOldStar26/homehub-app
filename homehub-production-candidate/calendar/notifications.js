export function safeEventURL(base,eventId,date){const url=new URL(base);url.search='';url.hash='';url.searchParams.set('event',eventId);if(date)url.searchParams.set('date',date);return url.href;}
export function eventLink(location){const url=new URL(location);const id=url.searchParams.get('event'),date=url.searchParams.get('date');return id?{id,date}:null;}
function bytes(key){const raw=atob(key.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
export class Notifications{
 constructor(repository,{invoke=null,vapidPublicKey=null}={}){this.repository=repository;this.invoke=invoke;this.vapidPublicKey=vapidPublicKey;}
 async worker(create=false){
  if(!navigator.serviceWorker.getRegistration)return navigator.serviceWorker.ready;
  const scope=new URL('../',import.meta.url);
  let registration=await navigator.serviceWorker.getRegistration(scope.href);
  if(!registration&&create){registration=await navigator.serviceWorker.register(new URL('../sw.js',import.meta.url).href,{scope:scope.href,updateViaCache:'none'});}
  if(registration&&!registration.active&&create)return navigator.serviceWorker.ready;
  return registration;
 }
 async enable(){
  if(this.repository.mock){await this.repository.setNotifications(true);return 'Mock notifications enabled. No permission requested and no remote subscription created.';}
  if(!('Notification' in window)||!('serviceWorker' in navigator)||!('PushManager' in window))throw Error('Push notifications are unavailable. On iPhone, install HomeHub on the Home Screen and open it there.');
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent||'')||(/Mac/.test(navigator.userAgent||'')&&navigator.maxTouchPoints>1);
  if(ios&&!navigator.standalone&&!window.matchMedia?.('(display-mode: standalone)').matches)throw Error('On iPhone, add this development app to the Home Screen, then open it there to enable notifications.');
  if(!this.invoke||!this.vapidPublicKey)throw Error('The development push backend is not configured.');
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications were not allowed. You can change this in device settings.');
  const reg=await this.worker(true);
  const subscription=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(this.vapidPublicKey)});
  try{await this.invoke({action:'subscribe',subscription:subscription.toJSON()});await this.repository.setNotifications(true);}catch(e){try{await this.invoke({action:'unsubscribe',endpoint:subscription.endpoint});}catch{}await subscription.unsubscribe();throw e;}
  return 'Notifications enabled for this device.';
 }
 async disable(){
  if(this.repository.mock){await this.repository.setNotifications(false);return 'Mock notifications disabled.';}
  if(!navigator.serviceWorker)return 'No notifications are enabled on this device.';
  const reg=await this.worker(false);if(!reg)return 'No notifications are enabled on this device.';
  const sub=await reg.pushManager.getSubscription();
  // Revoke server registration before local unsubscribe; fail visibly if revoke fails.
  if(sub){await this.invoke({action:'unsubscribe',endpoint:sub.endpoint});await sub.unsubscribe();}
  return 'Notifications disabled for this device.';
 }
 async preview(event,date){
  const url=safeEventURL(new URL('../',import.meta.url),event.id,date);
  // Mock notification opens exactly the same event URL without OS permission.
  if(this.repository.mock){window.location.assign(url);return;}
  const reg=await this.worker(true);
  await reg.showNotification('HomeHub reminder',{body:'You have a calendar reminder.',tag:`homehub:${event.id}:${date}`,data:{url}});
 }
}
