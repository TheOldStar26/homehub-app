(() => {
  'use strict';
  if (window !== window.top || location.origin !== 'https://theoldstar26.github.io' || !location.pathname.startsWith('/homehub-app/') || !window.HomeHubNative) return;
  let current = null, counter = 0;
  const send = payload => HomeHubNative.postMessage(JSON.stringify({version:1,...payload}));
  class NativeRecognition {
    start() { if (current) throw new Error('Recognition already active'); this.id = String(++counter); current = this; send({type:'listen',id:this.id}); }
    stop() { if (current === this) send({type:'stop',id:this.id}); }
    abort() { this.stop(); }
  }
  // Reuse Tablet Mode's existing recognition.onresult and answerCommand closures.
  window.SpeechRecognition = NativeRecognition;
  window.webkitSpeechRecognition = NativeRecognition;
  class NativeUtterance { constructor(text) { this.text=String(text); this.lang='en-GB'; } }
  let utterance=null;
  window.SpeechSynthesisUtterance=NativeUtterance;
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
    cancel(){send({type:'cancelSpeech'});utterance=null;}, getVoices(){return [];},
    speak(u){utterance=u;send({type:'speak',text:u.text});}
  }});
  HomeHubNative.onmessage = e => {
    let m; try {m=JSON.parse(e.data);}catch{return;}
    if(m.version!==1)return;
    if(m.type==='speechEnd'){utterance?.onend?.();utterance=null;return;}
    if(m.type==='speechError'){utterance?.onerror?.();utterance=null;return;}
    const r=current;if(!r||m.id!==r.id)return;
    if(m.type==='result')r.onresult?.({results:[[{transcript:m.text}]]});
    if(m.type==='error')r.onerror?.({error:m.error});
    if(m.type==='end'){current=null;r.onend?.();}
  };
  send({type:'ready'});
})();
