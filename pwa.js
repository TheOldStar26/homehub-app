// Installation UI only. No record/session access and no email requests.
(() => {
 const byId=id=>document.getElementById(id);
 let installPrompt;
 const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const status=()=>{
  byId('connectionStatus').hidden=navigator.onLine;
  byId('connectionStatus').textContent='You are offline. Connect to sign in, load records and save changes. Private records are not stored for offline use.';
  byId('installHelp').hidden=standalone();
 };
 setTimeout(()=>{if(!byId('launchScreen').hidden){byId('launchScreen').hidden=true;byId('setup').hidden=false;}},10000);
 status();window.addEventListener('online',status);window.addEventListener('offline',status);
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;byId('installApp').hidden=false;});
 byId('installApp').onclick=async()=>{if(!installPrompt)return;await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;byId('installApp').hidden=true;};
 window.addEventListener('appinstalled',status);
 // Do not register a worker during an authentication callback.
 if('serviceWorker' in navigator && !location.search && !location.hash){
  navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(reg=>{
   if(reg.waiting)byId('updateNotice').hidden=false;
   reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)byId('updateNotice').hidden=false;});});
  }).catch(()=>{byId('installHelp').insertAdjacentText('beforeend',' Offline app launch is unavailable in this browser.');});
 }
})();
