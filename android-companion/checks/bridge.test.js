import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const asset=readFileSync(new URL('../app/src/main/assets/voice-adapter.js',import.meta.url),'utf8');
function page(path='/homehub-app/',origin='https://theoldstar26.github.io',frame=false){
 const messages=[];const context={location:{origin,pathname:path},HomeHubNative:{postMessage:m=>messages.push(JSON.parse(m))}};
 context.window=context;context.top=frame?{}:context;vm.createContext(context);vm.runInContext(asset,context);return {context,messages};
}
test('Bridge rejects sibling projects, foreign origins and iframes',()=>{
 for(const args of [['/old-star-dj/'],['/homehub-app/','https://evil.example'],['/homehub-app/','https://theoldstar26.github.io',true]]){
  const {context,messages}=page(...args);assert.equal(context.SpeechRecognition,undefined);assert.equal(messages.length,0);
 }
});
test('Native transcripts reach the existing recognition callback only for matching sessions',()=>{
 const {context:c,messages}=page();assert.equal(messages[0].type,'ready');const r=new c.SpeechRecognition();let transcript=null,ended=0;
 r.onresult=e=>transcript=e.results[0][0].transcript;r.onend=()=>ended++;r.start();
 const receive=m=>c.HomeHubNative.onmessage({data:JSON.stringify({version:1,...m})});
 receive({type:'result',id:'999',text:'wrong session'});assert.equal(transcript,null);
 receive({type:'result',id:'1',text:'What time is it?'});assert.equal(transcript,'What time is it?');
 receive({type:'end',id:'1'});assert.equal(ended,1);receive({type:'result',id:'1',text:'late result'});assert.equal(transcript,'What time is it?');
 r.start();r.stop();assert.equal(messages.at(-1).type,'stop');
});
test('Speech adapter sends text only and handles unavailable native TTS',()=>{
 const {context:c,messages}=page();let errors=0;const u=new c.SpeechSynthesisUtterance('Your real calendar answer');u.onerror=()=>errors++;
 c.speechSynthesis.speak(u);assert.equal(messages.at(-1).text,'Your real calendar answer');
 c.HomeHubNative.onmessage({data:JSON.stringify({version:1,type:'speechError'})});assert.equal(errors,1);
 c.speechSynthesis.cancel();assert.equal(messages.at(-1).type,'cancelSpeech');
});
test('Native security gates and unavailable engine are present',()=>{
 const source=readFileSync(new URL('../app/src/main/java/com/homehub/companion/MainActivity.kt',import.meta.url),'utf8');
 for(const required of ['!mainFrame','origin.toString()!=','!trusted(Uri.parse(web.url','request.deny()','allowFileAccess=false','allowContentAccess=false','MIXED_CONTENT_NEVER_ALLOW','h.cancel()','createOnDeviceSpeechRecognizer','handler.postDelayed(timeout,20000)','override fun onPause(){disableVoice()'])assert.ok(source.includes(required),required);
 assert.ok(!source.includes('addJavascriptInterface'));assert.ok(!source.includes('AudioRecord'));
 const engine=readFileSync(new URL('../app/src/main/java/com/homehub/companion/WakeWordEngine.kt',import.meta.url),'utf8');assert.match(engine,/override val available = false/);
});
