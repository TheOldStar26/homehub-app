// Pure helpers: no network, storage, authentication or private-data persistence.
export const FILE_TYPES={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'};
export function validateDocument(file){
 if(!file||!FILE_TYPES[file.type]||!(/\.(pdf|jpe?g|png)$/i.test(file.name)))throw new Error('Choose a PDF, JPEG or PNG file.');
 const extension=file.name.split('.').pop().toLowerCase();
 if((file.type==='application/pdf'&&extension!=='pdf')||(file.type==='image/png'&&extension!=='png')||(file.type==='image/jpeg'&&!['jpg','jpeg'].includes(extension)))throw new Error('File type and extension do not match.');
 if(!file.size||file.size>10*1024*1024)throw new Error('Choose a file between 1 byte and 10 MB.');
 return FILE_TYPES[file.type];
}
export function dayDifference(date,today=new Date()){
 const [y,m,d]=date.split('-').map(Number);
 return Math.round((Date.UTC(y,m-1,d)-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/86400000);
}
export function maintenanceReminders(records,today=new Date()){
 return records.filter(r=>r.category==='job'&&!r.completed&&r.due_date&&dayDifference(r.due_date,today)<=30).sort((a,b)=>a.due_date.localeCompare(b.due_date));
}
const escapeCalendar=text=>String(text).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
export function calendarReminder(record,now=new Date()){
 const date=record.due_date.replace(/-/g,'');
 const [y,m,d]=record.due_date.split('-').map(Number);const end=new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10).replace(/-/g,'');
 const stamp=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//HomeHub//Maintenance//EN','BEGIN:VEVENT',`UID:${record.id}@homehub`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${date}`,`DTEND;VALUE=DATE:${end}`,`SUMMARY:${escapeCalendar(record.title)}`,'BEGIN:VALARM','TRIGGER:-P7D','ACTION:DISPLAY',`DESCRIPTION:${escapeCalendar(record.title)}`,'END:VALARM','END:VEVENT','END:VCALENDAR'];
 // RFC 5545 folds physical lines at 75 UTF-8 octets.
 return lines.map(line=>{let result='',part='';for(const ch of line){if(new TextEncoder().encode(part+ch).length>75){result+=part+'\r\n';part=' ';}part+=ch;}return result+part;}).join('\r\n')+'\r\n';
}
export function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
