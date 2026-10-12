import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('background push displays without an app window, and tap opens the correct recurring occurrence',async()=>{
  const handlers={},shown=[],opened=[];
  const clients={matchAll:async()=>[],openWindow:async url=>opened.push(url)};
  const context={URL,Set,clients,self:{location:{href:'https://theoldstar26.github.io/homehub-app/sw.js'},clients,registration:{showNotification:async(...args)=>shown.push(args)},addEventListener:(name,fn)=>handlers[name]=fn}};
  vm.runInNewContext(readFileSync(new URL('../sw.js',import.meta.url),'utf8'),context);
  let pending;
  handlers.push({data:{json:()=>({title:'HomeHub reminder',body:'Synthetic test',eventId:'event-test',date:'2026-11-01',tag:'unique'})},waitUntil:p=>pending=p});await pending;
  assert.equal(shown.length,1);assert.equal(shown[0][1].tag,'unique');
  handlers.notificationclick({notification:{data:shown[0][1].data,close(){}},waitUntil:p=>pending=p});await pending;
  assert.equal(opened[0],'https://theoldstar26.github.io/homehub-app/?event=event-test&date=2026-11-01');
});
