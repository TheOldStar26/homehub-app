import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverReminders } from '../supabase/functions/homehub-reminder-sender/delivery.js';
import { validEndpoint, validSubscription, cors } from '../supabase/functions/homehub-push-subscription/validation.js';
import { DEFAULTS } from '../calendar/model.js';
import { pushTransport } from '../supabase/functions/homehub-reminder-sender/transport.js';
test('Edge transport sends encrypted request via fetch and preserves provider failures for retry',async()=>{
  const generated={endpoint:'https://web.push.apple.com/synthetic',method:'POST',headers:{Authorization:'synthetic-test'},body:new Uint8Array([1,2,3])};
  const library={generateRequestDetails:()=>generated};let call;
  await pushTransport(library,async(...args)=>{call=args;return new Response(null,{status:201});}).sendNotification({},'test',{TTL:3600,timeout:10000});
  assert.equal(call[0],generated.endpoint);assert.equal(call[1].body,generated.body);assert.ok(call[1].signal instanceof AbortSignal);
  await assert.rejects(()=>pushTransport(library,async()=>new Response('{"reason":"BadJwtToken"}',{status:403})).sendNotification({},'test',{TTL:3600,timeout:10000}),e=>e.statusCode===403&&e.providerReason==='BadJwtToken');
});
function backend() {
  const tables = {
    push_subscriptions: [{ id:'s1', user_id:'u1', endpoint:'https://web.push.apple.com/test', p256dh:'synthetic', auth:'synthetic' }],
    calendar_events: [{ id:'e1', user_id:'u1', title:'Test reminder', category:'personal', all_day:false, start_date:'2026-11-01',end_date:'2026-11-01',start_time:'10:00:00',end_time:'11:00:00', timezone:'UTC', recurrence:'none', reminders:[5,0], version:1 }],
    notification_preferences: [{ user_id:'u1',enabled:true,categories:DEFAULTS }], homehub_notification_deliveries: [],
  };
  const db = {from(name) {
    const filters = []; let operation = 'select';
    const query = {
      select() { return this; }, order() { return this; },
      eq(k,v) { filters.push([k,v]); return this; },
      match: row => filters.every(([k,v]) => row[k] === v),
      range: async (a,b) => ({data:tables[name].filter(query.match).slice(a,b+1),error:null}),
      maybeSingle: async () => ({data:tables[name].find(query.match) ?? null,error:null}),
      async insert(row) { if (tables[name].some(r=>r.reminder_key===row.reminder_key)) return {error:{code:'23505'}}; tables[name].push(row); return {error:null}; },
      delete() { operation='delete'; return this; },
      then(resolve) { if(operation==='delete') tables[name]=tables[name].filter(r=>!query.match(r)); return Promise.resolve({error:null}).then(resolve); },
    }; return query;
  }};
  return {tables,db};
}
test('sender delivers both offsets, respects stored database times and suppresses overlapping runs and title edits', async () => {
  const {tables,db}=backend(), sends=[]; const push={sendNotification:async (_,body)=>sends.push(JSON.parse(body))};
  const now=new Date('2026-11-01T10:00:20Z');
  const runs=await Promise.all([deliverReminders(db,push,now),deliverReminders(db,push,now)]);
  assert.equal(runs.reduce((n,r)=>n+r.delivered,0),2); assert.equal(sends.length,2);
  assert.equal(new Set(sends.map(x=>x.tag)).size,2);
  tables.calendar_events[0].version=2; tables.calendar_events[0].title='Edited title';
  assert.equal((await deliverReminders(db,push,now)).delivered,0);
  assert.equal(sends[0].eventId,'e1'); assert.equal(sends[0].date,'2026-11-01');
});
test('failed sends can retry; successful reminders are not resent', async () => {
  const {db}=backend(); let fail=true,calls=0;
  const push={sendNotification:async()=>{calls++;if(fail)throw {statusCode:503};}};
  const now=new Date('2026-11-01T10:00:20Z');
  assert.equal((await deliverReminders(db,push,now)).errors,2);
  fail=false; assert.equal((await deliverReminders(db,push,now)).delivered,2);
  assert.equal((await deliverReminders(db,push,now)).delivered,0); assert.equal(calls,4);
});
test('disabled global preferences, completed events, event-off and disabled category defaults do not notify',async()=>{
  for(const mode of ['global','completed','off','category']) {
    const {tables,db}=backend(); tables.notification_preferences[0].categories=structuredClone(DEFAULTS);
    if(mode==='global')tables.notification_preferences[0].enabled=false;
    if(mode==='completed')tables.calendar_events[0].completed=true;
    if(mode==='off')tables.calendar_events[0].reminders=[];
    if(mode==='category'){tables.calendar_events[0].reminders=null;tables.notification_preferences[0].categories.personal.enabled=false;}
    let sends=0;await deliverReminders(db,{sendNotification:async()=>sends++},new Date('2026-11-01T10:00:20Z'));assert.equal(sends,0,mode);
  }
});
test('expired subscriptions are removed; every other owner is still processed',async()=>{
  const {tables,db}=backend();tables.push_subscriptions.push({...tables.push_subscriptions[0],id:'s2',user_id:'u2'});
  tables.calendar_events.push({...tables.calendar_events[0],id:'e2',user_id:'u2'});
  tables.notification_preferences.push({...tables.notification_preferences[0],user_id:'u2'});
  let calls=0;const result=await deliverReminders(db,{sendNotification:async()=>{if(calls++===0)throw {statusCode:410};}},new Date('2026-11-01T10:00:20Z'));
  assert.equal(result.expired,1);assert.equal(result.delivered,2);assert.deepEqual(tables.push_subscriptions.map(x=>x.id),['s2']);
});
test('registration supports SDK preflight and rejects private or malformed push destinations',()=>{
  assert.ok(cors['Access-Control-Allow-Headers'].includes('x-client-info'));assert.ok(cors['Access-Control-Allow-Methods'].includes('POST'));
  for(const endpoint of ['https://127.0.0.1/a','http://web.push.apple.com/a','https://web.push.apple.com.evil.invalid/a','https://web.push.apple.com:8443/a','https://user:pass@web.push.apple.com/a'])assert.equal(validEndpoint(endpoint),false);
  const sub={endpoint:'https://web.push.apple.com/synthetic',keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
  assert.equal(validSubscription(sub),true);assert.equal(validSubscription({...sub,keys:{...sub.keys,auth:'bad'}}),false);
});
