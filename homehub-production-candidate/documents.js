import {validateDocument,downloadBlob} from './features.js';
// Keep disabled until private bucket policies are approved and tested.
const DOCUMENTS_ENABLED=false;
export function documentsUI(db,getUser,notify){
 const form=document.getElementById('documentForm'),list=document.getElementById('documentList'),status=document.getElementById('documentStatus');
 let busy=false,revision=0;
 const bucket=()=>db.storage.from('homehub-documents');
 const message=text=>{status.textContent=text;};
 function reset(){revision++;list.replaceChildren();form.reset();}
 async function refresh(){
  const owner=getUser()?.id,version=++revision;list.replaceChildren();
  form.hidden=!DOCUMENTS_ENABLED;
  if(!DOCUMENTS_ENABLED){message('Private document storage is being prepared. Uploads will be enabled after its security setup is approved and tested.');return;}
  if(!owner)return;
  try{const rows=[];for(let offset=0;;offset+=100){const {data,error}=await bucket().list(owner,{limit:100,offset,sortBy:{column:'name',order:'asc'}});if(error)throw error;if(version!==revision||getUser()?.id!==owner)return;rows.push(...data.filter(f=>f.id));if(data.length<100)break;}
   message(rows.length?`${rows.length} private documents`:'No documents yet.');
   for(const file of rows){const item=document.createElement('article');item.className='documentItem';const title=document.createElement('strong');title.textContent=file.name.replace(/^[0-9a-f-]{36}_/i,'');const actions=document.createElement('div');actions.className='actions';
    const path=owner+'/'+file.name;
    const download=document.createElement('button');download.textContent='Download';download.onclick=async()=>{if(getUser()?.id!==owner)return;download.disabled=true;try{const {data,error}=await bucket().download(path);if(error)throw error;if(getUser()?.id===owner)downloadBlob(data,title.textContent);}catch(error){notify('Download failed: '+error.message);}finally{download.disabled=false;}};
    const remove=document.createElement('button');remove.textContent='Delete';remove.className='danger';remove.onclick=async()=>{if(busy||getUser()?.id!==owner||!confirm('Permanently delete this document?'))return;busy=true;remove.disabled=true;try{const {error}=await bucket().remove([path]);if(error)throw error;await refresh();}catch(error){notify('Delete failed: '+error.message);}finally{busy=false;remove.disabled=false;}};
    actions.append(download,remove);item.append(title,actions);list.append(item);
   }
  }catch(error){if(version===revision)message('Could not load private documents. Please reconnect and try again.');}
 }
 form.onsubmit=async event=>{
  event.preventDefault();if(!DOCUMENTS_ENABLED||busy||!getUser())return;
  const owner=getUser().id,file=document.getElementById('documentFile').files[0];
  try{const extension=validateDocument(file);if(!navigator.onLine)throw new Error('Connect to upload your document.');busy=true;form.querySelector('button').disabled=true;
   const name=file.name.replace(/\.[^.]*$/,'').replace(/[^a-zA-Z0-9 _-]/g,'_').slice(0,100)||'document';
   const path=owner+'/'+crypto.randomUUID()+'_'+name+'.'+extension;
   const {error}=await bucket().upload(path,file,{upsert:false,contentType:file.type,cacheControl:'0'});if(error)throw error;
   if(getUser()?.id===owner){form.reset();await refresh();notify('Document uploaded.');}
  }catch(error){notify(error.message);}finally{busy=false;form.querySelector('button').disabled=false;}
 };
 return {refresh,reset};
}
