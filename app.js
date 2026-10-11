import {maintenanceReminders,dayDifference,calendarReminder,downloadBlob} from './features.js';
import {documentsUI} from './documents.js';
// HomeHub public client settings only; no secret or service-role key.
const { createClient } = window.supabase;
const APP_BASE=new URL('./',import.meta.url);
const EMAIL_REDIRECT_TO=['localhost','127.0.0.1'].includes(APP_BASE.hostname)?'http://localhost:8766/':APP_BASE.href;
const $=id=>document.getElementById(id);let db=null,user=null,records=[],tab='all',generation=0,loading=false;let documents=null;
const config=()=>({url:'https://ejshqohrnsdmzinvqqzz.supabase.co',key:'sb_publishable_JpXxDZ9SYISJn4QKeNxEHw_WRuxbtJd'});
const show=id=>{['setup','auth','dashboard'].forEach(x=>$(x).hidden=x!==id);$('launchScreen').hidden=true;};
const toast=msg=>{const t=$('toast');t.textContent=msg;t.style.display='block';setTimeout(()=>t.style.display='none',4500)};
function init(){const c=config();if(!c){show('setup');return}try{db=createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true}});documents=documentsUI(db,()=>user,toast);db.auth.onAuthStateChange((_event,session)=>{const next=session?.user??null;if(next?.id!==user?.id){generation++;records=[];documents?.reset();$('reminderList').replaceChildren();$('items').replaceChildren();$('editor').close()}user=next;show(user?'dashboard':'auth');$('signout').hidden=!user;if(user)setTimeout(()=>load(),0)});db.auth.getSession().then(({data,error})=>{if(error)authMessage('Could not restore your session: '+error.message);user=data.session?.user??null;show(user?'dashboard':'auth');$('signout').hidden=!user;if(user)load()}).catch(error=>{show('auth');authMessage('Could not restore your session: '+error.message)})}catch{show('setup');toast('Check your Supabase settings')}}
$('authForm').onsubmit=async e=>{e.preventDefault();const {error}=await db.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(error)toast(error.message)};
const authMessage=message=>{$('authMessage').textContent=message;$('authMessage').hidden=!message};
function confirmationError(){
 const url=new URL(window.location.href),hash=new URLSearchParams(url.hash.slice(1));
 const value=name=>hash.get(name)||url.searchParams.get(name);
 const code=value('error_code'),error=value('error');
 if(!code&&!error&&!value('error_description'))return;
 const messages={otp_expired:'This confirmation link has expired or is no longer valid. Wait before requesting one fresh email, then use only its link.',invalid_token:'This confirmation link is invalid. Use only the latest confirmation email.',access_denied:'Email confirmation was rejected. The link may be expired or invalid.'};
 authMessage(messages[code]||messages[error]||'Email confirmation failed or was rejected. You are not confirmed by this link.');
 // Remove callback error details and any accompanying tokens from browser history.
 for(const key of ['error','error_code','error_description'])url.searchParams.delete(key);
 url.hash='';window.history.replaceState(null,'',url.pathname+url.search);
}
let emailRequestBusy=false;
const cooldownKey=email=>'homehub_email_cooldown:'+email.toLowerCase();
function cooldownUntil(){try{return Number(localStorage.getItem(cooldownKey($('email').value.trim())))||0}catch{return 0}}
function updateEmailButtons(){const waiting=Date.now()<cooldownUntil();$('signup').disabled=emailRequestBusy||waiting;$('resend').disabled=emailRequestBusy||waiting;}
async function requestConfirmation(kind){
 const email=$('email').value.trim();
 if(!email||!$('email').reportValidity()||(kind==='signup'&&!$('authForm').reportValidity()))return;
 if(emailRequestBusy)return;
 const until=cooldownUntil();if(Date.now()<until){authMessage('Please wait '+Math.ceil((until-Date.now())/1000)+' seconds before another email request.');return}
 emailRequestBusy=true;updateEmailButtons();
 try{
 const result=kind==='signup'
  ?await db.auth.signUp({email,password:$('password').value,options:{emailRedirectTo:EMAIL_REDIRECT_TO}})
  :await db.auth.resend({type:'signup',email,options:{emailRedirectTo:EMAIL_REDIRECT_TO}});
 const error=result.error;
 authMessage(error?(error.code==='over_email_send_rate_limit'?'Supabase has limited email requests. No new email was sent. Wait for the service limit to reset.':error.message):'Confirmation email requested. Check Inbox and Spam, and use only the newest link.');
 }catch(error){authMessage('Email request failed: '+error.message)}
 finally{try{localStorage.setItem(cooldownKey(email),String(Date.now()+60000))}catch{}emailRequestBusy=false;updateEmailButtons()}
}
$('signup').onclick=()=>requestConfirmation('signup');
$('resend').onclick=()=>requestConfirmation('resend');
$('email').addEventListener('input',updateEmailButtons);
window.addEventListener('storage',updateEmailButtons);
setInterval(updateEmailButtons,1000);
confirmationError();updateEmailButtons();
$('signout').onclick=async()=>{const {error}=await db.auth.signOut();if(error)toast(error.message)};
async function load(){
if(!user||loading)return;
const owner=user.id,version=generation;loading=true;
try{const all=[];for(let offset=0;;offset+=500){
const {data,error}=await db.from('records').select('id,category,title,due_date,amount,notes,completed,created_at').eq('user_id',owner).order('created_at',{ascending:false}).order('id').range(offset,offset+499);
if(error)throw error;if(version!==generation||user?.id!==owner)return;
all.push(...data);if(data.length<500)break;
}records=all;render();$('syncStatus').textContent='Synced '+new Date().toLocaleTimeString();
}catch(error){if(version===generation){$('syncStatus').textContent='Sync failed — check connection';toast('Could not load records: '+error.message)}}finally{loading=false}
}
setInterval(()=>{if(!document.hidden)load()},15000);
window.addEventListener('focus',()=>load());
window.addEventListener('online',()=>load());
$('refresh').onclick=()=>load();
const dateText=s=>s?new Date(s+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'No due date';
const days=s=>s?Math.round((new Date(s+'T12:00:00')-new Date(new Date().toDateString()))/86400000):null;
function render(){renderSection();const open=records.filter(r=>!r.completed);$('openJobs').textContent=open.filter(r=>r.category==='job').length;$('soon').textContent=open.filter(r=>days(r.due_date)!==null&&days(r.due_date)>=0&&days(r.due_date)<=30).length;$('overdue').textContent=open.filter(r=>days(r.due_date)!==null&&days(r.due_date)<0).length;const selected=records.filter(r=>tab==='all'||r.category===tab).sort((a,b)=>(a.completed-b.completed)||((a.due_date||'9999').localeCompare(b.due_date||'9999')));$('listTitle').textContent=({all:'All records',job:'Maintenance',vehicle:'Vehicles',bill:'Bills'})[tab];$('count').textContent=selected.length+' records';$('items').replaceChildren();if(!selected.length){const p=document.createElement('div');p.className='empty';p.textContent='Nothing here yet. Add your first record to get started.';$('items').append(p)}for(const r of selected){const b=document.createElement('button');b.className='item';const left=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('small'),pill=document.createElement('span');name.textContent=r.title;meta.textContent=({job:'Maintenance',vehicle:'Vehicle',bill:'Bill'})[r.category]+' · '+dateText(r.due_date)+(r.amount!==null?' · £'+Number(r.amount).toFixed(2):'');left.append(name,meta);pill.className='pill'+(r.completed?' done':days(r.due_date)!==null&&days(r.due_date)<0?' late':'');pill.textContent=r.completed?'Completed':days(r.due_date)!==null&&days(r.due_date)<0?'Overdue':'Open';b.append(left,pill);b.onclick=()=>edit(r);$('items').append(b)}}
$('tabs').onclick=e=>{const b=e.target.closest('button[data-tab]');if(!b)return;tab=b.dataset.tab;for(const x of $('tabs').querySelectorAll('button')){x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));}render();if(tab==='documents')documents.refresh()};
function edit(r){$('recordForm').reset();$('recordId').value=r?.id||'';$('editorTitle').textContent=r?'Edit record':'New record';$('category').value=r?.category||(['job','vehicle','bill'].includes(tab)?tab:'job');$('title').value=r?.title||'';$('due').value=r?.due_date||'';$('amount').value=r?.amount??'';$('notes').value=r?.notes||'';$('done').checked=r?.completed||false;$('delete').hidden=!r;$('editor').showModal()}
$('add').onclick=()=>edit(null);$('close').onclick=()=>$('editor').close();
$('recordForm').onsubmit=async e=>{e.preventDefault();const id=$('recordId').value;const data={category:$('category').value,title:$('title').value.trim(),due_date:$('due').value||null,amount:$('amount').value===''?null:Number($('amount').value),notes:$('notes').value.trim(),completed:$('done').checked};if(!user||!data.title)return;if(!navigator.onLine){toast('Connect to the internet before saving.');return}if(data.amount!==null&&(!Number.isFinite(data.amount)||data.amount<0||data.amount>99999999.99)){toast('Enter a valid amount');return}let q=id?db.from('records').update(data).eq('id',id).eq('user_id',user.id).select('id').single():db.from('records').insert({...data,user_id:user.id}).select('id').single();const {error}=await q;if(error){toast(error.message);return}$('editor').close();await load()};
$('delete').onclick=async()=>{const id=$('recordId').value;if(!id||!confirm('Delete this record permanently?'))return;const {error}=await db.from('records').delete().eq('id',id).eq('user_id',user.id).select('id').single();if(error){toast(error.message);return}$('editor').close();await load()};
function renderSection(){
 $('recordArea').hidden=['documents','reminders'].includes(tab);$('documentsArea').hidden=tab!=='documents';$('reminderArea').hidden=tab!=='reminders';$('add').hidden=tab==='documents';
 if(tab!=='reminders')return;const list=$('reminderList');list.replaceChildren();const reminders=maintenanceReminders(records);
 if(!reminders.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='You are up to date. Set a due date on a maintenance job to see a reminder here.';list.append(empty);}
 for(const record of reminders){const card=document.createElement('article');card.className='documentItem';const title=document.createElement('strong');title.textContent=record.title;const detail=document.createElement('p');const remaining=dayDifference(record.due_date);detail.textContent=(remaining<0?'Overdue':remaining===0?'Due today':'Due in '+remaining+' days')+' · '+dateText(record.due_date);const actions=document.createElement('div');actions.className='actions';const editButton=document.createElement('button');editButton.textContent='Update job';editButton.onclick=()=>edit(record);const calendar=document.createElement('button');calendar.className='secondary';calendar.textContent='Add to calendar';calendar.onclick=()=>downloadBlob(new Blob([calendarReminder(record)],{type:'text/calendar;charset=utf-8'}),'HomeHub-reminder.ics');actions.append(editButton,calendar);card.append(title,detail,actions);list.append(card);}
}
init();
