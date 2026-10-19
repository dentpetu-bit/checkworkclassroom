(() => {
'use strict';
const cfg = window.APP_CONFIG || {};
let supabaseClient = null;
let assignments = [], students = [], managedStudents = [], roomList = [];
let scanState = 'student', selectedStudent = null, html5QrCode = null, lastText = '', lastAt = 0;
let scanPeriod = 'pre';
let keyboardScanBuffer = '', keyboardScanTimer = null, keyboardLastAt = 0;
let attendanceStudents = [], attendanceRows = [], attendanceReportRows = [], attendanceSession = null;
let nonexistentStudents = [];
const $ = id => document.getElementById(id);
const safe = (id, fn) => { const el = $(id); if (el && typeof fn === 'function') fn(el); return el; };
function toast(msg){ const box=$('toast'); if(!box){ console.log(msg); return; } const el=document.createElement('div'); el.className='toast'; el.textContent=msg; box.appendChild(el); setTimeout(()=>el.remove(),3500); }
function setStatus(msg, ok=true){ const el=$('connectionStatus'); if(!el) return; el.textContent=msg; el.style.color=ok?'#9fffe7':'#fecaca'; }
function fillSelect(el, items, getVal=x=>x, getText=x=>x){ if(!el) return; el.innerHTML=''; (items||[]).forEach((i,idx)=>{ const o=document.createElement('option'); o.value=getVal(i,idx); o.textContent=getText(i,idx); el.appendChild(o); }); }
function escapeHtml(v){ return String(v ?? '').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])); }
function workNo(a, idx){ const n=Number(a?.sort_order); const fallback=Number(idx)+1; return Number.isFinite(n) && n>0 ? n : (Number.isFinite(fallback) && fallback>0 ? fallback : 1); }

function isNonexistentStudent(s){ return !!s?.is_nonexistent; }
function nonexistentBadge(s){
  return isNonexistentStudent(s) ? '<span class="nonexistent-badge">ไม่มีตัวตน</span>' : '';
}
function nonexistentRowClass(s){
  return isNonexistentStudent(s) ? ' class="nonexistent-student-row"' : '';
}
function scoreCellClass(score, maxScore){ const v=Number(score); const max=Number(maxScore); if(v===0) return 'zero-score'; if(Number.isFinite(max) && max>0 && v===max) return 'full-score'; return ''; }
async function withTimeout(promise, ms=12000, label='เชื่อมต่อช้าเกินไป'){ let t; const timeout=new Promise((_,rej)=>{t=setTimeout(()=>rej(new Error(label)),ms)}); try{return await Promise.race([promise,timeout]);} finally{clearTimeout(t);} }
window.addEventListener('error', e => { setStatus('JavaScript error: '+(e.message||'ไม่ทราบสาเหตุ'), false); console.error(e.error||e.message); });
window.addEventListener('unhandledrejection', e => { setStatus('Supabase/Network error: '+(e.reason?.message||e.reason||'ไม่ทราบสาเหตุ'), false); console.error(e.reason); });

function bindEvents(){
  document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{ document.querySelectorAll('.nav,.page').forEach(x=>x.classList.remove('active')); b.classList.add('active'); const page=$(b.dataset.page); if(page) page.classList.add('active'); if(b.dataset.page==='scorePage' && supabaseClient) loadAssignments($('roomSelect')?.value); if(b.dataset.page==='workPage' && supabaseClient) loadAssignments($('workRoomSelect')?.value); if(b.dataset.page==='studentPage' && supabaseClient) loadManagedStudents(); if(b.dataset.page==='realScorePage' && supabaseClient) loadRealScoreConfig(); if(b.dataset.page==='systemPage' && supabaseClient){ loadRooms(); renderRoomManager(); } if(b.dataset.page==='attendancePage' && supabaseClient){ initAttendanceDefaults(); loadTeacherAttendance(); } if(b.dataset.page==='nonexistentPage' && supabaseClient){ loadNonexistentStudents(); } });
  safe('roomSelect',el=>el.onchange=async()=>{ await loadStudents(); await loadAssignments($('roomSelect')?.value); }); safe('workRoomSelect',el=>el.onchange=()=>loadAssignments(el.value)); safe('workPeriodSelect',el=>el.onchange=()=>{}); safe('reportRoomSelect',el=>el.onchange=()=>{}); safe('startScanBtn',el=>el.onclick=startScan); safe('stopScanBtn',el=>el.onclick=stopScan); safe('manualSaveBtn',el=>el.onclick=manualSave); safe('barcodeFocusBtn',el=>el.onclick=focusBarcodeInput); safe('barcodeInput',el=>{ el.onkeydown=handleBarcodeInputKeydown; el.onfocus=()=>el.classList.add('scanner-ready'); el.onblur=()=>el.classList.remove('scanner-ready'); });
  document.querySelectorAll('[data-scan-period]').forEach(b=>b.onclick=()=>setScanPeriod(b.dataset.scanPeriod));
  safe('addAssignmentBtn',el=>el.onclick=addAssignment); safe('loadReportBtn',el=>el.onclick=loadReport); safe('exportPreExcelBtn',el=>el.onclick=()=>exportReportExcel('pre')); safe('exportMidExcelBtn',el=>el.onclick=()=>exportReportExcel('mid')); safe('exportPostExcelBtn',el=>el.onclick=()=>exportReportExcel('post')); safe('exportFinalExcelBtn',el=>el.onclick=()=>exportReportExcel('final')); safe('exportPreImageBtn',el=>el.onclick=()=>exportReportImage('pre')); safe('exportMidImageBtn',el=>el.onclick=()=>exportReportImage('mid')); safe('exportPostImageBtn',el=>el.onclick=()=>exportReportImage('post')); safe('exportFinalImageBtn',el=>el.onclick=()=>exportReportImage('final'));
  safe('studentRoomSelect',el=>el.onchange=loadManagedStudents); safe('studentSearchInput',el=>el.oninput=renderStudentTable); safe('clearStudentFormBtn',el=>el.onclick=clearStudentForm);
  safe('studentForm',el=>el.onsubmit=saveStudentForm); safe('studentFileInput',el=>el.onchange=handleStudentFile); safe('previewImportBtn',el=>el.onclick=previewImportStudents);
  safe('addRoomBtn',el=>el.onclick=addRoom); safe('backupDriveBtn',el=>el.onclick=backupToGoogleDrive); safe('downloadBackupBtn',el=>el.onclick=downloadBackupJson); safe('clearSystemBtn',el=>el.onclick=clearSystemData);
  safe('nonexistentRoomSelect',el=>el.onchange=loadNonexistentStudents);
  safe('loadNonexistentStudentsBtn',el=>el.onclick=loadNonexistentStudents);
  safe('attendanceRoomSelect',el=>el.onchange=loadTeacherAttendance);
  safe('attendanceDate',el=>el.onchange=loadTeacherAttendance);
  safe('loadAttendanceBtn',el=>el.onclick=loadTeacherAttendance);
  safe('attendanceBarcodeFocusBtn',el=>el.onclick=focusAttendanceBarcode);
  safe('attendanceBarcodeInput',el=>el.onkeydown=handleAttendanceBarcodeKeydown);
  safe('showAttendanceQrBtn',el=>el.onclick=openAttendanceSelfSession);
  safe('closeAttendanceQrBtn',el=>el.onclick=closeAttendanceSelfSession);
  safe('loadAttendanceReportBtn',el=>el.onclick=loadAttendanceReport);
  safe('exportAttendanceExcelBtn',el=>el.onclick=exportAttendanceExcel);
  safe('exportAttendancePdfBtn',el=>el.onclick=exportAttendancePdf);
  safe('attendanceSelfSubmitBtn',el=>el.onclick=submitAttendanceSelfCheck);
  safe('confirmImportBtn',el=>el.onclick=importStudents); safe('downloadTemplateBtn',el=>el.onclick=downloadStudentTemplate); safe('scoreFileInput',el=>el.onchange=handleScoreFile); safe('previewScoreImportBtn',el=>el.onclick=previewImportScores); safe('confirmScoreImportBtn',el=>el.onclick=importScores); safe('downloadScoreTemplateBtn',el=>el.onclick=downloadScoreTemplate); safe('realRoomSelect',el=>el.onchange=loadRealScoreConfig); safe('loadRealScoreBtn',el=>el.onclick=loadRealScore); safe('exportRealExcelBtn',el=>el.onclick=exportRealExcel); safe('exportRealImageBtn',el=>el.onclick=exportRealImage);
}

function focusBarcodeInput(){
  const input=$('barcodeInput');
  if(!input) return toast('ไม่พบช่องรับเครื่องยิง');
  input.focus();
  input.select?.();
  toast('พร้อมรับข้อมูลจากเครื่องยิงบาร์โค้ด/QR');
}
async function processScannerText(text, source='barcode'){
  const value=normalizeQR(String(text||'').trim());
  if(!value) return;
  safe('barcodeInput',el=>{ el.value=''; el.focus(); });
  await onScan(value);
}
function handleBarcodeInputKeydown(e){
  if(e.key==='Enter' || e.key==='Tab'){
    e.preventDefault();
    const value=e.currentTarget.value.trim();
    processScannerText(value,'barcode-input');
  }
}
function bindKeyboardScannerListener(){
  document.addEventListener('keydown', e=>{
    if(e.ctrlKey || e.altKey || e.metaKey) return;
    const active=document.activeElement;
    const tag=(active?.tagName||'').toLowerCase();
    const isBarcodeInput=active?.id==='barcodeInput';
    const isTypingField=['input','textarea','select'].includes(tag) && !isBarcodeInput;
    if(isTypingField) return;
    if(e.key==='Enter' || e.key==='Tab'){
      const text=keyboardScanBuffer.trim();
      keyboardScanBuffer='';
      clearTimeout(keyboardScanTimer);
      if(text.length>=1){ e.preventDefault(); processScannerText(text,'keyboard-wedge'); }
      return;
    }
    if(e.key.length!==1) return;
    const now=Date.now();
    if(now-keyboardLastAt>90) keyboardScanBuffer='';
    keyboardLastAt=now;
    keyboardScanBuffer+=e.key;
    clearTimeout(keyboardScanTimer);
    keyboardScanTimer=setTimeout(()=>{ keyboardScanBuffer=''; },350);
  });
}

async function init(){
  setStatus('กำลังเริ่มระบบ...');
  bindEvents();
  bindKeyboardScannerListener();
  setRoomOptions((cfg.ROOMS||[]).map((name,idx)=>({name:String(name),sort_order:idx+1})));
  if(!window.supabase){ setStatus('โหลดไลบรารี Supabase ไม่สำเร็จ ให้เช็คอินเทอร์เน็ต/CDN', false); toast('โหลด Supabase JS ไม่สำเร็จ'); return; }
  if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || String(cfg.SUPABASE_URL).includes('YOUR_PROJECT')){ setStatus('ยังไม่ได้ตั้งค่า config.js', false); toast('ต้องมีไฟล์ config.js ใน GitHub root'); return; }
  try{ supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY); }
  catch(e){ setStatus('ตั้งค่า Supabase ไม่ถูกต้อง', false); toast(e.message); return; }
  setStatus('กำลังเชื่อมต่อ Supabase...');
  try{
    await withTimeout((async()=>{ await loadRooms(); await Promise.all([loadAssignments(currentRoom('roomSelect')), loadStudents(), loadManagedStudents()]); })(),15000,'เชื่อมต่อ Supabase ไม่สำเร็จใน 15 วินาที');
    setStatus('เชื่อมต่อ Supabase แล้ว');
    initAttendanceDefaults();
    await initAttendanceSelfMode();
    toast('ระบบพร้อมใช้งาน');
  }catch(e){ setStatus('เชื่อมต่อไม่สำเร็จ: '+e.message, false); toast('เช็ค config.js / RLS / อินเทอร์เน็ต'); }
}


function firstRoomName(){ return roomList[0]?.name || String((cfg.ROOMS||[])[0] || ''); }
function currentRoom(selectId){ return $(selectId)?.value || firstRoomName(); }
function setRoomOptions(items){
  const normalized=(items||[]).map((r,idx)=>({id:r.id||null,name:String(r.name??r).trim(),sort_order:Number(r.sort_order)||idx+1})).filter(r=>r.name);
  roomList=normalized;
  const ids=['roomSelect','workRoomSelect','reportRoomSelect','realRoomSelect','studentRoomSelect','importRoomSelect','studentFormRoom','attendanceRoomSelect','nonexistentRoomSelect'];
  ids.forEach(id=>{
    const el=$(id); if(!el) return;
    const old=el.value;
    fillSelect(el,roomList,r=>r.name,r=>r.name);
    if(old && roomList.some(r=>r.name===old)) el.value=old;
  });
  renderRoomManager();
}
async function loadRooms(){
  if(!supabaseClient) return;
  const {data,error}=await supabaseClient.from('rooms').select('*').order('sort_order',{ascending:true}).order('name',{ascending:true});
  if(error){
    console.warn('rooms table unavailable, fallback to config.js',error);
    setRoomOptions((cfg.ROOMS||[]).map((name,idx)=>({name:String(name),sort_order:idx+1})));
    return;
  }
  let rows=data||[];
  if(!rows.length && (cfg.ROOMS||[]).length){
    const seed=(cfg.ROOMS||[]).map((name,idx)=>({name:String(name),sort_order:idx+1}));
    const seeded=await supabaseClient.from('rooms').upsert(seed,{onConflict:'name'}).select('*');
    if(!seeded.error) rows=seeded.data||seed;
  }
  setRoomOptions(rows);
}
function renderRoomManager(){
  safe('roomCountBadge',el=>el.textContent=`${roomList.length} ห้อง`);
  const box=$('roomManagerList'); if(!box) return;
  box.innerHTML=roomList.map((r,idx)=>`<div class="list-item"><div class="work-main"><b>${escapeHtml(r.name)}</b><span>ลำดับ ${escapeHtml(r.sort_order||idx+1)}</span></div><div class="table-actions"><button class="mini" data-room-edit="${escapeHtml(r.id||'')}" data-room-name="${escapeHtml(r.name)}">แก้ไข</button><button class="mini danger" data-room-delete="${escapeHtml(r.id||'')}" data-room-name="${escapeHtml(r.name)}">ลบ</button></div></div>`).join('') || '<p class="hint">ยังไม่มีห้องเรียน กรุณาเพิ่มห้อง</p>';
  document.querySelectorAll('[data-room-edit]').forEach(b=>b.onclick=()=>editRoom(b.dataset.roomEdit,b.dataset.roomName));
  document.querySelectorAll('[data-room-delete]').forEach(b=>b.onclick=()=>deleteRoom(b.dataset.roomDelete,b.dataset.roomName));
}
async function addRoom(){
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  const name=$('newRoomName')?.value.trim();
  const order=Number($('newRoomOrder')?.value)||roomList.length+1;
  if(!name) return toast('กรุณากรอกชื่อห้อง');
  const {error}=await supabaseClient.from('rooms').insert({name,sort_order:order});
  if(error) return toast(error.code==='23505'?'มีห้องนี้อยู่แล้ว':error.message);
  safe('newRoomName',el=>el.value=''); safe('newRoomOrder',el=>el.value='');
  await loadRooms(); toast(`เพิ่มห้อง ${name} แล้ว`);
}
async function editRoom(id,oldName){
  if(!id) return toast('ห้องนี้มาจาก config.js กรุณารัน schema.sql v32 ก่อนแก้ไข');
  const newName=prompt('แก้ชื่อห้อง',oldName); if(newName===null) return;
  const name=String(newName).trim(); if(!name || name===oldName) return;
  if(!confirm(`เปลี่ยนชื่อห้อง ${oldName} เป็น ${name}?\nระบบจะปรับชื่อนี้ในข้อมูลนักเรียนและชิ้นงานด้วย`)) return;
  const u1=await supabaseClient.from('rooms').update({name}).eq('id',id); if(u1.error) return toast(u1.error.message);
  const u2=await supabaseClient.from('students').update({room:name}).eq('room',oldName); if(u2.error) return toast('แก้ห้องแล้ว แต่ปรับนักเรียนไม่สำเร็จ: '+u2.error.message);
  const u3=await supabaseClient.from('assignments').update({room:name}).eq('room',oldName); if(u3.error) return toast('แก้ห้องแล้ว แต่ปรับชิ้นงานไม่สำเร็จ: '+u3.error.message);
  await loadRooms(); toast('แก้ไขชื่อห้องแล้ว');
}
async function deleteRoom(id,name){
  if(!id) return toast('ห้องนี้มาจาก config.js กรุณารัน schema.sql v32 ก่อนลบ');
  const [s,a]=await Promise.all([
    supabaseClient.from('students').select('id',{count:'exact',head:true}).eq('room',name),
    supabaseClient.from('assignments').select('id',{count:'exact',head:true}).eq('room',name)
  ]);
  if((s.count||0)>0 || (a.count||0)>0) return toast(`ลบห้อง ${name} ไม่ได้ เพราะยังมีนักเรียนหรือชิ้นงานอยู่`);
  if(!confirm(`ยืนยันลบห้อง ${name}?`)) return;
  const {error}=await supabaseClient.from('rooms').delete().eq('id',id); if(error) return toast(error.message);
  await loadRooms(); toast('ลบห้องแล้ว');
}
async function collectBackupData(){
  if(!supabaseClient) throw new Error('ยังไม่เชื่อมต่อ Supabase');
  const [r,s,a,sc,att,ses]=await Promise.all([
    supabaseClient.from('rooms').select('*').order('sort_order',{ascending:true}),
    supabaseClient.from('students').select('*').order('room',{ascending:true}).order('number',{ascending:true}),
    supabaseClient.from('assignments').select('*').order('room',{ascending:true}).order('sort_order',{ascending:true}),
    supabaseClient.from('scores').select('*'),
    supabaseClient.from('attendance').select('*'),
    supabaseClient.from('attendance_sessions').select('*')
  ]);
  const err=[r.error,s.error,a.error,sc.error,att.error,ses.error].find(Boolean); if(err) throw err;
  return {app:'Kru Dew QR Score Studio',version:'v34',backed_up_at:new Date().toISOString(),rooms:r.data||roomList,students:s.data||[],assignments:a.data||[],scores:sc.data||[],attendance:att.data||[],attendance_sessions:ses.data||[]};
}
function backupFileName(){
  const d=new Date(); const p=n=>String(n).padStart(2,'0');
  return `QR_Score_Studio_Backup_${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.json`;
}
async function downloadBackupJson(){
  try{
    safe('backupStatus',el=>el.textContent='กำลังรวบรวมข้อมูลสำรอง...');
    const data=await collectBackupData();
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=backupFileName(); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500);
    safe('backupStatus',el=>el.textContent=`สำรองข้อมูล ${data.students.length} นักเรียน / ${data.assignments.length} ชิ้นงาน / ${data.scores.length} คะแนน`);
    toast('ดาวน์โหลด Backup JSON แล้ว');
  }catch(e){ toast('สำรองข้อมูลไม่สำเร็จ: '+e.message); }
}
async function backupToGoogleDrive(){
  const url=String(cfg.GOOGLE_DRIVE_BACKUP_URL||'').trim();
  if(!url) return toast('ยังไม่ได้ตั้งค่า GOOGLE_DRIVE_BACKUP_URL ใน config.js');
  try{
    safe('backupStatus',el=>el.textContent='กำลังสำรองข้อมูลไป Google Drive...');
    const data=await collectBackupData();
    const payload={filename:backupFileName(),backup:data};
    await fetch(url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
    safe('backupStatus',el=>el.textContent=`ส่ง Backup ไป Google Drive แล้ว (${data.students.length} นักเรียน / ${data.scores.length} คะแนน)`);
    toast('ส่งข้อมูลสำรองไป Google Drive แล้ว');
  }catch(e){ toast('สำรอง Google Drive ไม่สำเร็จ: '+e.message); safe('backupStatus',el=>el.textContent='สำรอง Google Drive ไม่สำเร็จ'); }
}
async function clearSystemData(){
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  const ok=confirm('คำเตือน: จะลบคะแนน ชิ้นงาน และนักเรียนทั้งหมดในระบบ\nรายชื่อห้องจะยังคงอยู่\n\nแนะนำให้สำรองข้อมูลก่อน ต้องการดำเนินการต่อหรือไม่?');
  if(!ok) return;
  const typed=prompt('เพื่อยืนยัน ให้พิมพ์คำว่า ล้างข้อมูลทั้งหมด');
  if(String(typed||'').trim()!=='ล้างข้อมูลทั้งหมด') return toast('ยกเลิกการล้างข้อมูล');
  safe('backupStatus',el=>el.textContent='กำลังล้างข้อมูล...');
  const da=await supabaseClient.from('attendance').delete().not('id','is',null); if(da.error) return toast(da.error.message);
  const ds=await supabaseClient.from('attendance_sessions').delete().not('id','is',null); if(ds.error) return toast(ds.error.message);
  const d1=await supabaseClient.from('scores').delete().not('id','is',null); if(d1.error) return toast(d1.error.message);
  const d2=await supabaseClient.from('assignments').delete().not('id','is',null); if(d2.error) return toast(d2.error.message);
  const d3=await supabaseClient.from('students').delete().not('id','is',null); if(d3.error) return toast(d3.error.message);
  assignments=[]; students=[]; managedStudents=[];
  renderAssignmentList(); renderScanAssignmentSelect(); renderStudentTable();
  ['reportPreTable','reportMidTable','reportPostTable','reportFinalTable','realScoreTable'].forEach(id=>safe(id,t=>{t.querySelector('thead').innerHTML='';t.querySelector('tbody').innerHTML='';}));
  safe('backupStatus',el=>el.textContent='ล้างข้อมูลนักเรียน ชิ้นงาน และคะแนนเรียบร้อยแล้ว (คงรายชื่อห้องไว้)');
  toast('ล้างข้อมูลทั้งระบบเรียบร้อยแล้ว');
}

async function loadAssignments(roomArg){
  if(!supabaseClient) return;
  const room = roomArg || $('workRoomSelect')?.value || $('roomSelect')?.value || firstRoomName();
  if($('workRoomSelect') && roomArg) $('workRoomSelect').value = roomArg;
  let query = supabaseClient.from('assignments').select('*').order('sort_order',{ascending:true});
  if(room) query = query.eq('room', room);
  const {data,error}=await query;
  if(error) throw error;
  assignments=data||[];
  renderScanAssignmentSelect();
  renderAssignmentList();
}
async function loadStudents(){ if(!supabaseClient) return; const room=currentRoom('roomSelect'); if(!room) return; const {data,error}=await supabaseClient.from('students').select('*').eq('room',room).order('number',{ascending:true}); if(error) throw error; students=data||[]; }
function periodLabel(period){
  return {pre:'ก่อนกลางภาค',mid:'กลางภาค',post:'หลังกลางภาค',final:'ปลายภาค'}[period||'pre'] || 'ก่อนกลางภาค';
}
function setScanPeriod(period){
  scanPeriod = ['pre','mid','post','final'].includes(period) ? period : 'pre';
  document.querySelectorAll('[data-scan-period]').forEach(btn=>{
    const active=btn.dataset.scanPeriod===scanPeriod;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-pressed',active?'true':'false');
  });
  // ถ้าเปลี่ยนช่วงระหว่างที่เลือกนักเรียนอยู่ ให้เริ่มรอบสแกนใหม่เพื่อกันลงผิดงาน
  if(selectedStudent){
    selectedStudent=null;
    scanState='student';
    updateMode();
    safe('currentStudent',el=>{el.classList.remove('nonexistent-student-card'); el.innerHTML='เปลี่ยนช่วงคะแนนแล้ว กรุณาสแกนนักเรียนใหม่';});
  }
  renderScanAssignmentSelect();
}
function renderScanAssignmentSelect(){
  const select=$('assignmentSelect'); if(!select) return;
  const list=(assignments||[])
    .filter(a=>(a.period||'pre')===scanPeriod)
    .sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0));

  if(!list.length){
    select.innerHTML=`<option value="">— ยังไม่มีชิ้นงาน${periodLabel(scanPeriod)} —</option>`;
  }else{
    fillSelect(select,list,a=>a.id,(a,idx)=>`${periodWorkNo(a,idx,list)}. ${a.title} (${a.max_score} คะแนน)`);

    // เลือกงานล่าสุดของห้องและช่วงคะแนนนี้ให้อัตโนมัติ
    // งานใหม่จะมี sort_order สูงสุด จึงเป็นรายการสุดท้ายหลังเรียงลำดับ
    const latestAssignment=list[list.length-1];
    if(latestAssignment) select.value=latestAssignment.id;
  }

  safe('scanPeriodHint',el=>el.textContent=`กำลังเลือก: ${periodLabel(scanPeriod)} • ${list.length} ชิ้นงาน${list.length ? ' • เลือกงานล่าสุดให้อัตโนมัติ' : ''}`);
}
function periodWorkNo(a, idx, list){
  const n=Number(a?.sort_order);
  if(Number.isFinite(n) && n>0) return n;
  return idx+1;
}
function renderAssignmentList(){
  const el=$('assignmentList'); if(!el) return;
  const groups=[
    {period:'pre', title:'ชิ้นงานก่อนกลางภาค'},
    {period:'mid', title:'ชิ้นงานกลางภาค'},
    {period:'post', title:'ชิ้นงานหลังกลางภาค'},
    {period:'final', title:'ชิ้นงานปลายภาค'}
  ];
  el.innerHTML=groups.map(g=>{
    const list=(assignments||[]).filter(a=>(a.period||'pre')===g.period).sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0));
    const total=list.reduce((sum,a)=>sum+(Number(a.max_score)||0),0);
    const rows=list.map((a,idx)=>`
      <div class="list-item work-item period-work-item">
        <div class="work-main"><b>${periodWorkNo(a,idx,list)}. ${escapeHtml(a.title)}</b><span>ห้อง ${escapeHtml(a.room||'-')} | ${periodLabel(a.period)} | ${escapeHtml(a.max_score)} คะแนน</span></div>
        <div class="table-actions">
          <button class="mini ghost" data-work-up="${a.id}" ${idx===0?'disabled':''}>↑</button>
          <button class="mini ghost" data-work-down="${a.id}" ${idx===list.length-1?'disabled':''}>↓</button>
          <button class="mini" data-work-edit="${a.id}">แก้ไข</button>
          <button class="mini danger" data-work-delete="${a.id}">ลบ</button>
        </div>
      </div>`).join('') || '<p class="hint">ยังไม่มีชิ้นงานในช่วงนี้</p>';
    return `<div class="period-work-group"><div class="section-head"><div><h3>${g.title}</h3><p class="hint">จำนวน ${list.length} งาน | คะแนนเต็มรวม ${total} คะแนน</p></div></div><div class="list period-list">${rows}</div></div>`;
  }).join('');
  document.querySelectorAll('[data-work-edit]').forEach(b=>b.onclick=()=>editAssignment(b.dataset.workEdit));
  document.querySelectorAll('[data-work-delete]').forEach(b=>b.onclick=()=>deleteAssignment(b.dataset.workDelete));
  document.querySelectorAll('[data-work-up]').forEach(b=>b.onclick=()=>moveAssignment(b.dataset.workUp,-1));
  document.querySelectorAll('[data-work-down]').forEach(b=>b.onclick=()=>moveAssignment(b.dataset.workDown,1));
}
async function addAssignment(){
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  const room=$('workRoomSelect')?.value || $('roomSelect')?.value || firstRoomName();
  const period=$('workPeriodSelect')?.value || 'pre';
  const title=$('newAssignmentName')?.value.trim();
  const max=Number($('newMaxScore')?.value||10);
  if(!room) return toast('กรุณาเลือกห้องของชิ้นงาน');
  if(!title) return toast('กรุณากรอกชื่องาน');
  const {data:orders,error:orderError}=await supabaseClient
    .from('assignments')
    .select('sort_order')
    .eq('room',room)
    .eq('period',period)
    .order('sort_order',{ascending:false})
    .limit(1);
  if(orderError) return toast(orderError.message);
  const nextOrder=((orders&&orders[0]&&Number(orders[0].sort_order))||0)+1;
  const {error}=await supabaseClient.from('assignments').insert({room,title,max_score:max,period,sort_order:nextOrder});
  if(error) return toast(error.message);
  $('newAssignmentName').value='';
  await loadAssignments(room);
  toast(`เพิ่มชิ้นงาน${periodLabel(period)} ลำดับที่ ${nextOrder} แล้ว`);
}
async function editAssignment(id){
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  const a=assignments.find(x=>x.id===id); if(!a) return;
  const title=prompt('แก้ไขชื่อชิ้นงาน', a.title); if(title===null) return;
  const maxRaw=prompt('แก้ไขคะแนนเต็ม', a.max_score); if(maxRaw===null) return;
  const periodRaw=prompt('ช่วงชิ้นงาน: pre = ก่อนกลางภาค, mid = กลางภาค, post = หลังกลางภาค, final = ปลายภาค', a.period || 'pre'); if(periodRaw===null) return;
  const periodInput=String(periodRaw).trim().toLowerCase();
  const period=['pre','mid','post','final'].includes(periodInput) ? periodInput : (a.period || 'pre');
  const max=Number(maxRaw); if(!title.trim() || Number.isNaN(max)) return toast('กรอกข้อมูลชิ้นงานไม่ถูกต้อง');
  const {error}=await supabaseClient.from('assignments').update({title:title.trim(),max_score:max,period}).eq('id',id);
  if(error) return toast(error.message);
  await loadAssignments($('workRoomSelect')?.value); toast('แก้ไขชิ้นงานแล้ว');
}
async function deleteAssignment(id){
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  const a=assignments.find(x=>x.id===id); if(!a) return;
  if(!confirm(`ยืนยันลบชิ้นงาน "${a.title}"?\nคะแนนของชิ้นงานนี้จะถูกลบตามไปด้วย`)) return;
  const {error}=await supabaseClient.from('assignments').delete().eq('id',id);
  if(error) return toast(error.message);
  await loadAssignments($('workRoomSelect')?.value); toast('ลบชิ้นงานแล้ว');
}
async function moveAssignment(id,dir){
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  const current=assignments.find(x=>x.id===id); if(!current) return;
  const list=(assignments||[]).filter(a=>(a.period||'pre')===(current.period||'pre')).sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0));
  const idx=list.findIndex(x=>x.id===id); const other=list[idx+dir];
  if(!other) return;
  const aOrder=Number(current.sort_order)||idx+1, bOrder=Number(other.sort_order)||idx+dir+1;
  const {error:e1}=await supabaseClient.from('assignments').update({sort_order:bOrder}).eq('id',current.id); if(e1) return toast(e1.message);
  const {error:e2}=await supabaseClient.from('assignments').update({sort_order:aOrder}).eq('id',other.id); if(e2) return toast(e2.message);
  await loadAssignments($('workRoomSelect')?.value); toast('เลื่อนลำดับชิ้นงานแล้ว');
}
function normalizeQR(text){return String(text||'').trim().replace(/^score:/i,'').replace(/^student:/i,'')}
async function startScan(){ if(!window.Html5Qrcode) return toast('โหลดระบบสแกน QR ไม่สำเร็จ'); if(html5QrCode) return; html5QrCode = new Html5Qrcode('reader'); scanState='student'; updateMode(); try{await html5QrCode.start({facingMode:'environment'},{fps:10,qrbox:{width:250,height:250}},onScan,()=>{});toast('เปิดกล้องแล้ว')}catch(e){toast('เปิดกล้องไม่ได้: '+e.message)} }
async function stopScan(){ if(!html5QrCode) return; await html5QrCode.stop().catch(()=>{}); await html5QrCode.clear().catch(()=>{}); html5QrCode=null; toast('ปิดกล้องแล้ว'); }
function updateMode(){ safe('scanModeBadge',el=>el.textContent = scanState==='student' ? 'พร้อมสแกนนักเรียน' : 'พร้อมสแกน QR คะแนน'); }
function showBigOverlay(kind, main, sub=''){
  const el=$('scanOverlay'); if(!el) return;
  el.className='scan-overlay show '+(kind||'');
  el.innerHTML=`<div class="scan-pop"><div class="scan-pop-label">${kind==='score'?'บันทึกคะแนนแล้ว':'พบนักเรียน'}</div><div class="scan-pop-main">${escapeHtml(main)}</div><div class="scan-pop-sub">${escapeHtml(sub)}</div></div>`;
  clearTimeout(window.__scanOverlayTimer);
  window.__scanOverlayTimer=setTimeout(()=>{el.className='scan-overlay'; el.innerHTML='';},1800);
}
async function onScan(decodedText){ const now=Date.now(); if(decodedText===lastText && now-lastAt<1600) return; lastText=decodedText; lastAt=now; const value=normalizeQR(decodedText); if(scanState==='student') await handleStudentCode(value); else await handleScore(value); }
async function handleStudentCode(code){ let stu = students.find(s=>String(s.student_code)===String(code)); if(!stu){const {data}=await supabaseClient.from('students').select('*').eq('student_code',code).maybeSingle(); stu=data} if(!stu) return toast('ไม่พบรหัสนักเรียน: '+code); selectedStudent=stu; safe('currentStudent',el=>{ el.classList.toggle('nonexistent-student-card',isNonexistentStudent(stu)); el.innerHTML=`<div class="student-name">${escapeHtml(stu.prefix||'')}${escapeHtml(stu.full_name)} ${nonexistentBadge(stu)}</div><div class="student-meta">ห้อง ${escapeHtml(stu.room)} เลขที่ ${escapeHtml(stu.number||'-')} | รหัส ${escapeHtml(stu.student_code)}</div>`; }); showBigOverlay('student', `${stu.prefix||''}${stu.full_name}${isNonexistentStudent(stu)?' [ไม่มีตัวตน]':''}`, `ห้อง ${stu.room} เลขที่ ${stu.number||'-'} | สแกนคะแนนต่อ`); scanState='score'; updateMode(); toast(isNonexistentStudent(stu)?'คำเตือน: นักเรียนคนนี้ตั้งค่าเป็น “ไม่มีตัวตน”':'พบนักเรียนแล้ว → สแกนคะแนนต่อ'); }
async function handleScore(raw){
  const score=Number(raw); if(Number.isNaN(score)) return toast('QR คะแนนต้องเป็นตัวเลขเท่านั้น'); if(!selectedStudent) return toast('กรุณาสแกนนักเรียนก่อน');
  const stu=selectedStudent; const result=await saveScore(stu.student_code, score);
  if(result?.saved) showBigOverlay('score', `${score} คะแนน`, `${stu.prefix||''}${stu.full_name}`);
  else if(result?.duplicate) showBigOverlay('warning', 'ลงคะแนนแล้ว', `${stu.prefix||''}${stu.full_name} | คะแนนเดิม ${result.oldScore}`);
  scanState='student'; selectedStudent=null; updateMode(); safe('currentStudent',el=>{el.classList.remove('nonexistent-student-card'); el.innerHTML='สแกนนักเรียนคนต่อไปได้เลย';});
}
async function getExistingScore(studentId, assignmentId){ const {data,error}=await supabaseClient.from('scores').select('id,score').eq('student_id',studentId).eq('assignment_id',assignmentId).maybeSingle(); if(error) throw error; return data || null; }
async function saveScore(studentCode, score){
  if(!supabaseClient){ toast('ยังไม่เชื่อมต่อ Supabase'); return {saved:false}; }
  const assignmentId=$('assignmentSelect')?.value; if(!assignmentId){ toast('กรุณาเลือกชิ้นงาน'); return {saved:false}; }
  let stu = students.find(s=>String(s.student_code)===String(studentCode)); if(!stu){const {data}=await supabaseClient.from('students').select('*').eq('student_code',studentCode).maybeSingle(); stu=data}
  if(!stu){ toast('ไม่พบนักเรียน'); return {saved:false}; }
  const ass=assignments.find(a=>a.id===assignmentId);
  let existing=null; try{ existing=await getExistingScore(stu.id, assignmentId); }catch(e){ toast(e.message); return {saved:false}; }
  const oldScore=Number(existing?.score ?? 0);
  if(existing && oldScore!==0){
    toast(`แจ้งเตือน: ${stu.full_name} ลงคะแนนงานนี้แล้ว (${oldScore} คะแนน)`);
    const ok=confirm(`นักเรียนคนนี้ลงคะแนนงานนี้แล้ว\n\nนักเรียน: ${(stu.prefix||'')}${stu.full_name}\nชิ้นงาน: ${ass?.title||''}\nคะแนนเดิม: ${oldScore}\nคะแนนใหม่: ${score}\n\nต้องการบันทึกทับคะแนนเดิมหรือไม่?`);
    if(!ok){ safe('lastSaved',el=>el.innerHTML=`<b class="warn-text">ยังไม่บันทึกทับ:</b> ${escapeHtml(stu.full_name)} | ${escapeHtml(ass?.title||'')} มีคะแนนเดิม <b>${escapeHtml(oldScore)}</b>`); return {saved:false, duplicate:true, oldScore}; }
  }
  const {error}=await supabaseClient.from('scores').upsert({student_id:stu.id,assignment_id:assignmentId,score,updated_at:new Date().toISOString()},{onConflict:'student_id,assignment_id'});
  if(error){ toast(error.message); return {saved:false}; }
  safe('lastSaved',el=>el.innerHTML=`บันทึกแล้ว: <b>${escapeHtml(stu.full_name)}</b> | ${escapeHtml(ass?.title||'')} = <b>${escapeHtml(score)}</b>`); toast(existing && oldScore!==0 ? 'บันทึกทับคะแนนเดิมแล้ว' : 'บันทึกคะแนนอัตโนมัติแล้ว'); return {saved:true};
}
async function manualSave(){ const code=$('manualCode')?.value.trim(); const score=Number($('manualScore')?.value); if(!code||Number.isNaN(score)) return toast('กรอกข้อมูล Manual ให้ครบ'); await saveScore(code,score); }
// ===== v20: โหลดคะแนนครบทุกแถวแบบ pagination =====
// Supabase มีเพดานจำนวนแถวต่อ request จึงต้องแบ่งโหลดเป็นหน้า ๆ
// และกรองทั้งนักเรียน + ชิ้นงานของห้อง เพื่อลดข้อมูลที่ไม่เกี่ยวข้อง
async function fetchAllScores(studentIds, assignmentIds){
  if(!supabaseClient || !studentIds?.length || !assignmentIds?.length) return [];

  const PAGE_SIZE = 500;
  const allRows = [];
  let from = 0;

  while(true){
    const {data,error}=await supabaseClient
      .from('scores')
      .select('id,student_id,assignment_id,score,updated_at')
      .in('student_id',studentIds)
      .in('assignment_id',assignmentIds)
      .order('updated_at',{ascending:true})
      .order('id',{ascending:true})
      .range(from, from + PAGE_SIZE - 1);

    if(error) throw error;
    const page = data || [];
    if(!page.length) break;

    allRows.push(...page);
    // ขยับตามจำนวนที่ server ส่งกลับจริง จึงรองรับแม้ตั้ง Max Rows ต่ำกว่า PAGE_SIZE
    from += page.length;
  }

  return allRows;
}

async function loadReport(){
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  const room=$('reportRoomSelect')?.value;
  const {data:roomAssignments,error:e0}=await supabaseClient.from('assignments').select('*').eq('room',room).order('sort_order',{ascending:true});
  if(e0) return toast(e0.message);
  const {data:stu,error:e1}=await supabaseClient.from('students').select('*').eq('room',room).order('number',{ascending:true});
  if(e1) return toast(e1.message);
  const ids=(stu||[]).map(s=>s.id);
  const assignmentIds=(roomAssignments||[]).map(a=>a.id);
  let scoreRows=[];
  try{ scoreRows=await fetchAllScores(ids, assignmentIds); }
  catch(error){ return toast(error.message); }
  const scoreMap={}; scoreRows.forEach(r=>scoreMap[`${r.student_id}_${r.assignment_id}`]=r.score);
  renderReportPeriod('pre', roomAssignments||[], stu||[], scoreMap);
  renderReportPeriod('mid', roomAssignments||[], stu||[], scoreMap);
  renderReportPeriod('post', roomAssignments||[], stu||[], scoreMap);
  renderReportPeriod('final', roomAssignments||[], stu||[], scoreMap);
  bindReportScoreInputs();
  toast('โหลดรายงานครบ 4 ช่วงแล้ว');
}
function reportPeriodInfo(period){
  const map={
    pre:{label:'ก่อนกลางภาค', tableId:'reportPreTable', summaryId:'reportPreSummary', captureId:'reportPreCapture'},
    mid:{label:'กลางภาค', tableId:'reportMidTable', summaryId:'reportMidSummary', captureId:'reportMidCapture'},
    post:{label:'หลังกลางภาค', tableId:'reportPostTable', summaryId:'reportPostSummary', captureId:'reportPostCapture'},
    final:{label:'ปลายภาค', tableId:'reportFinalTable', summaryId:'reportFinalSummary', captureId:'reportFinalCapture'}
  };
  return map[period] || map.pre;
}
function renderReportPeriod(period, allAssignments, stu, scoreMap){
  const info=reportPeriodInfo(period);
  const reportAssignments=(allAssignments||[]).filter(a=>(a.period||'pre')===period);
  const totalMax=reportAssignments.reduce((sum,a)=>sum+Number(a.max_score||0),0);
  safe(info.summaryId,el=>el.textContent=`จำนวนงาน ${reportAssignments.length} งาน | คะแนนเต็มรวม ${round2(totalMax)} คะแนน | นักเรียน ${stu.length} คน`);
  const table=$(info.tableId); if(!table) return;
  const thead='<tr><th>เลขที่</th><th>รหัส</th><th>ชื่อ-สกุล</th>'+reportAssignments.map((a,idx)=>`<th>${periodWorkNo(a,idx,reportAssignments)}. ${escapeHtml(a.title)}</th>`).join('')+'<th>รวม</th></tr>';
  const tbody=(stu||[]).map(s=>{
    let total=0;
    const tds=reportAssignments.map(a=>{
      const key=`${s.id}_${a.id}`; const has=scoreMap[key]!==undefined; const v=has ? Number(scoreMap[key]) : 0; total+=v;
      const cellClass = scoreCellClass(v, a.max_score);
      return `<td class="score-cell ${cellClass}"><input class="score-input" type="number" step="0.01" value="${escapeHtml(v)}" data-student-id="${s.id}" data-assignment-id="${a.id}" data-max-score="${escapeHtml(a.max_score)}" data-original="${escapeHtml(v)}" title="แก้ไขคะแนนแล้วกด Enter หรือคลิกออก" /></td>`;
    }).join('');
    return `<tr${nonexistentRowClass(s)}><td>${escapeHtml(s.number||'')}</td><td>${escapeHtml(s.student_code)}</td><td class="text-left">${escapeHtml(s.prefix||'')}${escapeHtml(s.full_name)} ${nonexistentBadge(s)}</td>${tds}<td><b class="row-total">${escapeHtml(round2(total))}</b></td></tr>`
  }).join('');
  table.querySelector('thead').innerHTML=thead;
  table.querySelector('tbody').innerHTML=tbody || `<tr><td colspan="4">ยังไม่มีข้อมูล${info.label}</td></tr>`;
}
function bindReportScoreInputs(){
  document.querySelectorAll('.score-input').forEach(inp=>{
    inp.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); } };
    inp.onchange=()=>updateReportScore(inp);
    inp.onblur=()=>{ if(inp.value!==inp.dataset.original) updateReportScore(inp); };
  });
}
async function updateReportScore(inp){
  if(inp.dataset.saving==='1') return;
  const score=Number(inp.value); const original=Number(inp.dataset.original || 0);
  if(Number.isNaN(score) || score<0){ toast('คะแนนต้องเป็นตัวเลข 0 ขึ้นไป'); inp.value=inp.dataset.original||0; return; }
  if(original!==0 && score!==original){ const ok=confirm(`คะแนนช่องนี้เคยลงไว้แล้ว (${original} คะแนน)\nต้องการแก้เป็น ${score} คะแนนหรือไม่?`); if(!ok){ inp.value=inp.dataset.original||0; return; } }
  inp.dataset.saving='1';
  const payload={student_id:inp.dataset.studentId, assignment_id:inp.dataset.assignmentId, score, updated_at:new Date().toISOString()};
  const {error}=await supabaseClient.from('scores').upsert(payload,{onConflict:'student_id,assignment_id'});
  inp.dataset.saving='0';
  if(error){ toast(error.message); inp.value=inp.dataset.original||0; return; }
  inp.dataset.original=String(score);
  const td=inp.closest('td'); if(td){ td.classList.remove('missing-score','zero-score','full-score'); const cls=scoreCellClass(score, inp.dataset.maxScore); if(cls) td.classList.add(cls); }
  recalcReportRow(inp.closest('tr'));
  toast(original!==0 ? 'แก้ไขคะแนนเดิมแล้ว' : 'อัปเดตคะแนนแล้ว');
}
function recalcReportRow(tr){
  if(!tr) return; let total=0;
  tr.querySelectorAll('.score-input').forEach(i=>{const n=Number(i.value); if(!Number.isNaN(n)) total+=n;});
  const el=tr.querySelector('.row-total'); if(el) el.textContent=String(round2(total));
}
function getReportAOAByTable(tableId){ const table=$(tableId); if(!table) return []; const aoa=[]; const head=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim()); if(head.length) aoa.push(head); table.querySelectorAll('tbody tr').forEach(tr=>{ const row=[...tr.children].map(td=>{ const input=td.querySelector('input'); if(input) return Number(input.value || 0); const txt=td.textContent.trim(); const n=Number(txt); return txt!=='' && !Number.isNaN(n) ? n : txt; }); if(row.length) aoa.push(row); }); return aoa; }
function exportReportExcel(period){ if(!window.XLSX) return toast('โหลด Excel library ไม่สำเร็จ'); const info=reportPeriodInfo(period); const aoa=getReportAOAByTable(info.tableId); if(!aoa.length) return toast('กรุณาโหลดรายงานก่อน'); const ws=XLSX.utils.aoa_to_sheet(aoa); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,info.label); XLSX.writeFile(wb,`รายงานคะแนน_${info.label}_${$('reportRoomSelect')?.value||''}.xlsx`); }
function cloneReportTableForExport(tableId){ const original=$(tableId); if(!original) return null; const clone=original.cloneNode(true); clone.querySelectorAll('input.score-input').forEach(inp=>{ const span=document.createElement('span'); span.className='export-score-value'; span.textContent=inp.value || '0'; inp.replaceWith(span); }); clone.classList.add('report-export-table'); return clone; }
async function exportReportImage(period){ if(!window.html2canvas) return toast('โหลดระบบส่งออกภาพไม่สำเร็จ'); const info=reportPeriodInfo(period); const table=$(info.tableId); if(!table || !table.querySelector('tbody tr')) return toast('กรุณาโหลดรายงานก่อน'); const holder=document.createElement('div'); holder.className='report-export-holder'; const title=document.createElement('div'); title.className='report-export-title'; title.textContent=`รายงานคะแนน${info.label} ห้อง ${$('reportRoomSelect')?.value || ''}`; const clone=cloneReportTableForExport(info.tableId); holder.appendChild(title); holder.appendChild(clone); document.body.appendChild(holder); try{ const width=holder.scrollWidth; const height=holder.scrollHeight; const canvas=await html2canvas(holder,{backgroundColor:'#ffffff',scale:2,width,height,windowWidth:width,windowHeight:height,scrollX:0,scrollY:0}); const a=document.createElement('a'); a.href=canvas.toDataURL('image/png'); a.download=`รายงานคะแนน_${info.label}_${$('reportRoomSelect')?.value||''}.png`; a.click(); toast('ส่งออกภาพรายงานแล้ว'); }catch(e){ toast('ส่งออกภาพไม่สำเร็จ: '+e.message); }finally{ holder.remove(); } }
// aliases for old code compatibility
function exportExcel(){ exportReportExcel('pre'); }
async function exportImage(){ await exportReportImage('pre'); }
async function loadManagedStudents(){ if(!supabaseClient) return; const room=currentRoom('studentRoomSelect'); if(!room) return; const {data,error}=await supabaseClient.from('students').select('*').eq('room',room).order('number',{ascending:true}); if(error) throw error; managedStudents=data||[]; renderStudentTable(); }
function renderStudentTable(){ if(!$('studentTable')) return; const q=($('studentSearchInput')?.value||'').trim().toLowerCase(); const rows=managedStudents.filter(s=>!q || [s.student_code,s.prefix,s.full_name,s.room,s.number].some(v=>String(v??'').toLowerCase().includes(q))); safe('studentCountBadge',el=>el.textContent=`${rows.length} คน`); $('studentTable').querySelector('thead').innerHTML='<tr><th>เลขที่</th><th>รหัส</th><th>คำนำหน้า</th><th>ชื่อ-สกุล</th><th>ห้อง</th><th>จัดการ</th></tr>'; $('studentTable').querySelector('tbody').innerHTML=rows.map(s=>`<tr${nonexistentRowClass(s)}><td>${escapeHtml(s.number??'')}</td><td>${escapeHtml(s.student_code)}</td><td>${escapeHtml(s.prefix??'')}</td><td class="text-left"><b>${escapeHtml(s.full_name)}</b> ${nonexistentBadge(s)}</td><td>${escapeHtml(s.room)}</td><td class="table-actions"><button class="mini" data-edit="${s.id}">แก้ไข</button><button class="mini danger" data-delete="${s.id}">ลบ</button></td></tr>`).join('') || '<tr><td colspan="6">ยังไม่มีนักเรียนในห้องนี้</td></tr>'; document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editStudent(b.dataset.edit)); document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteStudent(b.dataset.delete)); }
function clearStudentForm(){ ['studentId','studentCode','studentPrefix','studentFullName','studentNumber'].forEach(id=>safe(id,el=>el.value='')); safe('studentFormRoom',el=>el.value=currentRoom('studentRoomSelect') || ''); safe('studentFormTitle',el=>el.textContent='เพิ่มนักเรียน'); safe('saveStudentBtn',el=>el.textContent='บันทึกนักเรียน'); }
function editStudent(id){ const s=managedStudents.find(x=>x.id===id); if(!s) return; safe('studentId',el=>el.value=s.id); safe('studentCode',el=>el.value=s.student_code||''); safe('studentPrefix',el=>el.value=s.prefix||''); safe('studentFullName',el=>el.value=s.full_name||''); safe('studentNumber',el=>el.value=s.number??''); safe('studentFormRoom',el=>el.value=s.room||''); safe('studentFormTitle',el=>el.textContent='แก้ไขนักเรียน'); safe('saveStudentBtn',el=>el.textContent='อัปเดตข้อมูล'); window.scrollTo({top:0,behavior:'smooth'}); }
async function saveStudentForm(e){ e.preventDefault(); if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase'); const id=$('studentId')?.value; const payload={student_code:$('studentCode')?.value.trim(), prefix:$('studentPrefix')?.value.trim() || null, full_name:$('studentFullName')?.value.trim(), room:$('studentFormRoom')?.value, number:$('studentNumber')?.value==='' ? null : Number($('studentNumber')?.value)}; if(!payload.student_code || !payload.full_name || !payload.room) return toast('กรุณากรอก รหัส / ชื่อ / ห้อง ให้ครบ'); const query=id ? supabaseClient.from('students').update(payload).eq('id',id) : supabaseClient.from('students').insert(payload); const {error}=await query; if(error) return toast(error.message); toast(id?'อัปเดตนักเรียนแล้ว':'เพิ่มนักเรียนแล้ว'); safe('studentRoomSelect',el=>el.value=payload.room); clearStudentForm(); await Promise.all([loadManagedStudents(), loadStudents()]); }
async function deleteStudent(id){ if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase'); const s=managedStudents.find(x=>x.id===id); if(!s) return; if(!confirm(`ยืนยันลบ ${s.full_name}?\nคะแนนของนักเรียนคนนี้จะถูกลบตามไปด้วย`)) return; const {error}=await supabaseClient.from('students').delete().eq('id',id); if(error) return toast(error.message); toast('ลบนักเรียนแล้ว'); await Promise.all([loadManagedStudents(), loadStudents()]); }
function getImportRowsFromTextarea(){ const text=$('studentImportText')?.value.trim(); if(!text) return []; if(!window.XLSX){ toast('โหลด Excel library ไม่สำเร็จ'); return []; } const wb=XLSX.read(text,{type:'string'}); const ws=wb.Sheets[wb.SheetNames[0]]; return XLSX.utils.sheet_to_json(ws,{defval:''}); }
async function handleStudentFile(e){ const file=e.target.files?.[0]; if(!file) return; if(!window.XLSX) return toast('โหลด Excel library ไม่สำเร็จ'); const buf=await file.arrayBuffer(); const wb=XLSX.read(buf,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]]; const rows=XLSX.utils.sheet_to_json(ws,{defval:''}); safe('studentImportText',el=>el.value=rowsToTsv(rows)); previewImportStudents(); }
function rowsToTsv(rows){ const headers=['student_code','prefix','full_name','room','number']; const lines=[headers.join('\t')]; rows.forEach(r=>lines.push(headers.map(h=>r[h] ?? r[thaiHeader(h)] ?? '').join('\t'))); return lines.join('\n'); }
function thaiHeader(h){return {student_code:'รหัสนักเรียน',prefix:'คำนำหน้า',full_name:'ชื่อ-สกุล',room:'ห้อง',number:'เลขที่'}[h]}
function looksLikeExcelDateSerial(v){
  const t=String(v ?? '').trim();
  if(!t) return false;
  const n=Number(t);
  // Excel/Sheets มักแปลง 4/2 เป็น serial ประมาณ 36983.0000462963
  // เลข serial วันที่จะเป็นตัวเลขยาว 5 หลักขึ้นไป จึงไม่ควรเอาไปเป็นชื่อห้อง
  return Number.isFinite(n) && n > 20000 && n < 90000;
}
function cleanRoomValue(rawRoom, fallbackRoom){
  let room=String(rawRoom ?? '').trim();
  const fallback=String(fallbackRoom ?? '').trim();
  if(!room) return fallback;
  // แก้กรณี Excel/CSV แปลง 4/2 เป็น 36983.0000462963
  if(looksLikeExcelDateSerial(room)) return fallback;
  // ถ้า config มีรายชื่อห้อง และค่าที่อ่านมาไม่ตรงกับห้องใดเลย ให้ใช้ห้องที่เลือกไว้ด้านบนแทน
  const rooms=roomList.map(x=>String(x.name));
  if(rooms.length && !rooms.includes(room) && fallback) return fallback;
  return room;
}
function normalizeImportRow(r, fallbackRoom){
  const student_code=String(r.student_code ?? r['รหัสนักเรียน'] ?? r.code ?? r['รหัส'] ?? '').trim();
  const prefix=String(r.prefix ?? r['คำนำหน้า'] ?? '').trim();
  const full_name=String(r.full_name ?? r['ชื่อ-สกุล'] ?? r.name ?? r['ชื่อ'] ?? '').trim();
  const room=cleanRoomValue(r.room ?? r['ห้อง'] ?? '', fallbackRoom);
  const numberRaw=String(r.number ?? r['เลขที่'] ?? '').trim();
  return {student_code,prefix:prefix||null,full_name,room,number:numberRaw===''?null:Number(numberRaw)};
}
function getImportRows(){ const fallbackRoom=$('importRoomSelect')?.value; return getImportRowsFromTextarea().map(r=>normalizeImportRow(r,fallbackRoom)).filter(r=>r.student_code || r.full_name); }
function previewImportStudents(){ const rows=getImportRows(); const valid=rows.filter(r=>r.student_code && r.full_name && r.room && (r.number===null || !Number.isNaN(r.number))); safe('importSummary',el=>el.innerHTML=`ตรวจพบ <b>${rows.length}</b> แถว | พร้อมนำเข้า <b>${valid.length}</b> แถว`); if(!$('importPreview')) return; $('importPreview').querySelector('thead').innerHTML='<tr><th>เลขที่</th><th>รหัส</th><th>คำนำหน้า</th><th>ชื่อ-สกุล</th><th>ห้อง</th><th>สถานะ</th></tr>'; $('importPreview').querySelector('tbody').innerHTML=rows.slice(0,80).map(r=>{ const ok=r.student_code && r.full_name && r.room && (r.number===null || !Number.isNaN(r.number)); return `<tr><td>${escapeHtml(r.number??'')}</td><td>${escapeHtml(r.student_code)}</td><td>${escapeHtml(r.prefix??'')}</td><td class="text-left">${escapeHtml(r.full_name)}</td><td>${escapeHtml(r.room)}</td><td>${ok?'พร้อม':'ข้อมูลไม่ครบ'}</td></tr>` }).join('') || '<tr><td colspan="6">ยังไม่มีข้อมูลตัวอย่าง</td></tr>'; }
async function importStudents(){ if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase'); const rows=getImportRows().filter(r=>r.student_code && r.full_name && r.room && (r.number===null || !Number.isNaN(r.number))); if(!rows.length) return toast('ยังไม่มีข้อมูลที่พร้อมนำเข้า'); const {error}=await supabaseClient.from('students').upsert(rows,{onConflict:'student_code'}); if(error) return toast(error.message); toast(`นำเข้า/อัปเดตนักเรียนแล้ว ${rows.length} คน`); safe('studentRoomSelect',el=>el.value=$('importRoomSelect')?.value); await Promise.all([loadManagedStudents(), loadStudents()]); }
function downloadStudentTemplate(){ if(!window.XLSX) return toast('โหลด Excel library ไม่สำเร็จ'); const data=[{student_code:'40201',prefix:'นาย',full_name:'ตัวอย่าง นักเรียน',room:$('importRoomSelect')?.value||firstRoomName()||'',number:1}]; const ws=XLSX.utils.json_to_sheet(data,{header:['student_code','prefix','full_name','room','number']}); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'students'); XLSX.writeFile(wb,'student_import_template.xlsx'); }


// ===== Score import from external files =====
async function getRoomStudentsAndAssignments(room){
  if(!supabaseClient) throw new Error('ยังไม่เชื่อมต่อ Supabase');
  const [{data:stu,error:e1},{data:ass,error:e2}] = await Promise.all([
    supabaseClient.from('students').select('*').eq('room',room).order('number',{ascending:true}),
    supabaseClient.from('assignments').select('*').eq('room',room).order('sort_order',{ascending:true})
  ]);
  if(e1) throw e1; if(e2) throw e2;
  return {students:stu||[], assignments:ass||[]};
}
function readRowsFromTextArea(id){
  const text=$(id)?.value.trim();
  if(!text) return [];
  if(!window.XLSX){ toast('โหลด Excel library ไม่สำเร็จ'); return []; }
  const wb=XLSX.read(text,{type:'string'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws,{defval:''});
}
async function handleScoreFile(e){
  const file=e.target.files?.[0]; if(!file) return;
  if(!window.XLSX) return toast('โหลด Excel library ไม่สำเร็จ');
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(buf,{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
  safe('scoreImportText',el=>el.value=scoreRowsToTsv(rows));
  previewImportScores();
}
function scoreRowsToTsv(rows){
  if(!rows || !rows.length) return '';
  const keys=[];
  rows.forEach(r=>Object.keys(r).forEach(k=>{ if(!keys.includes(k)) keys.push(k); }));
  const lines=[keys.join('\t')];
  rows.forEach(r=>lines.push(keys.map(k=>r[k] ?? '').join('\t')));
  return lines.join('\n');
}
function normalizeHeader(v){
  return String(v??'').trim().toLowerCase().replace(/\s+/g,'').replace(/^\d+[.)\-_/]*/,'').replace(/^งานที่/,'งาน');
}
function rowGet(r, keys){
  for(const k of keys){ if(Object.prototype.hasOwnProperty.call(r,k) && String(r[k]).trim()!=='') return r[k]; }
  const lowKeys=Object.keys(r);
  for(const want of keys){
    const hit=lowKeys.find(k=>normalizeHeader(k)===normalizeHeader(want));
    if(hit && String(r[hit]).trim()!=='') return r[hit];
  }
  return '';
}
function assignmentValueFromWideRow(r, a, idx){
  const candidates=[a.title, `${idx+1}. ${a.title}`, `${idx+1} ${a.title}`, `งาน ${idx+1}`, `งานที่ ${idx+1}`, `งาน${idx+1}`, `score_${idx+1}`, `score${idx+1}`];
  // exact first
  for(const k of candidates){ if(Object.prototype.hasOwnProperty.call(r,k) && String(r[k]).trim()!=='') return r[k]; }
  // normalized headers
  const headers=Object.keys(r);
  const aNorms=candidates.map(normalizeHeader);
  for(const h of headers){ if(aNorms.includes(normalizeHeader(h)) && String(r[h]).trim()!=='') return r[h]; }
  return '';
}
async function buildScoreImportRecords(){
  const room=currentRoom('reportRoomSelect');
  const mode=$('scoreImportMode')?.value || 'wide';
  const rawRows=readRowsFromTextArea('scoreImportText');
  const {students:roomStudents, assignments:roomAssignments}=await getRoomStudentsAndAssignments(room);
  const stuMap={}; roomStudents.forEach(s=>stuMap[String(s.student_code)]=s);
  const assByNorm={}; roomAssignments.forEach((a,idx)=>{
    [a.title, `${idx+1}. ${a.title}`, `${idx+1} ${a.title}`, `งาน ${idx+1}`, `งานที่ ${idx+1}`, `งาน${idx+1}`].forEach(k=>assByNorm[normalizeHeader(k)]=a);
  });
  const records=[];
  rawRows.forEach((r, rowIndex)=>{
    const code=String(rowGet(r,['student_code','รหัสนักเรียน','รหัส','code']) ?? '').trim();
    const name=String(rowGet(r,['full_name','ชื่อ-สกุล','ชื่อ']) ?? '').trim();
    const fileRoom=cleanRoomValue(rowGet(r,['room','ห้อง']), room);
    if(mode==='long'){
      const assName=String(rowGet(r,['assignment','assignment_title','ชิ้นงาน','งาน','ชื่อชิ้นงาน']) ?? '').trim();
      const scoreRaw=rowGet(r,['score','คะแนน']);
      const a=assByNorm[normalizeHeader(assName)];
      records.push(makeScoreRecord({rowIndex, code, name, fileRoom, assignment:a, assignmentName:assName, scoreRaw, room, stuMap}));
    }else{
      roomAssignments.forEach((a,idx)=>{
        const scoreRaw=assignmentValueFromWideRow(r,a,idx);
        if(String(scoreRaw).trim()==='') return; // blank = no import/change
        records.push(makeScoreRecord({rowIndex, code, name, fileRoom, assignment:a, assignmentName:a.title, scoreRaw, room, stuMap}));
      });
    }
  });
  return {records, rawRows, roomStudents, roomAssignments};
}
function makeScoreRecord({rowIndex, code, name, fileRoom, assignment, assignmentName, scoreRaw, room, stuMap}){
  const score=Number(scoreRaw);
  const stu=stuMap[String(code)];
  let status='พร้อม';
  if(!code) status='ไม่มีรหัสนักเรียน';
  else if(!stu) status='ไม่พบนักเรียนในห้องนี้';
  else if(!assignment) status='ไม่พบชิ้นงานนี้ในห้อง';
  else if(String(fileRoom||room)!==String(room)) status='ห้องไม่ตรง';
  else if(Number.isNaN(score) || score<0) status='คะแนนไม่ถูกต้อง';
  return {rowIndex:rowIndex+1, student_code:code, full_name:name || stu?.full_name || '', room:fileRoom||room, student_id:stu?.id, assignment_id:assignment?.id, assignment_title:assignment?.title || assignmentName || '', score, status, ok:status==='พร้อม'};
}
async function previewImportScores(){
  try{
    const {records, rawRows}=await buildScoreImportRecords();
    const valid=records.filter(r=>r.ok);
    safe('scoreImportSummary',el=>el.innerHTML=`ตรวจพบไฟล์ <b>${rawRows.length}</b> แถว | คะแนนที่พร้อมนำเข้า <b>${valid.length}</b> รายการ`);
    const tbl=$('scoreImportPreview'); if(!tbl) return;
    tbl.querySelector('thead').innerHTML='<tr><th>แถว</th><th>รหัส</th><th>ชื่อ-สกุล</th><th>ห้อง</th><th>ชิ้นงาน</th><th>คะแนน</th><th>สถานะ</th></tr>';
    tbl.querySelector('tbody').innerHTML=records.slice(0,160).map(r=>`<tr><td>${r.rowIndex}</td><td>${escapeHtml(r.student_code)}</td><td class="text-left">${escapeHtml(r.full_name)}</td><td>${escapeHtml(r.room)}</td><td class="text-left">${escapeHtml(r.assignment_title)}</td><td><b>${escapeHtml(Number.isNaN(r.score)?'':r.score)}</b></td><td class="${r.ok?'ok-text':'bad-text'}">${escapeHtml(r.status)}</td></tr>`).join('') || '<tr><td colspan="7">ยังไม่มีข้อมูลคะแนนตัวอย่าง</td></tr>';
  }catch(e){ toast(e.message); safe('scoreImportSummary',el=>el.textContent='ตรวจสอบไม่สำเร็จ: '+e.message); }
}
async function importScores(){
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  try{
    const {records}=await buildScoreImportRecords();
    const rows=records.filter(r=>r.ok).map(r=>({student_id:r.student_id, assignment_id:r.assignment_id, score:r.score, updated_at:new Date().toISOString()}));
    if(!rows.length) return toast('ยังไม่มีคะแนนที่พร้อมนำเข้า');
    const {error}=await supabaseClient.from('scores').upsert(rows,{onConflict:'student_id,assignment_id'});
    if(error) return toast(error.message);
    toast(`นำเข้า/อัปเดตคะแนนแล้ว ${rows.length} รายการ`);
    await loadReport();
  }catch(e){ toast(e.message); }
}
async function downloadScoreTemplate(){
  if(!window.XLSX) return toast('โหลด Excel library ไม่สำเร็จ');
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  const room=currentRoom('reportRoomSelect');
  try{
    const {students:stu, assignments:ass}=await getRoomStudentsAndAssignments(room);
    if(!ass.length) return toast('ห้องนี้ยังไม่มีชิ้นงาน ให้เพิ่มชิ้นงานก่อน');
    const rows=(stu||[]).map(s=>{
      const row={'เลขที่':s.number??'', 'รหัสนักเรียน':s.student_code, 'คำนำหน้า':s.prefix??'', 'ชื่อ-สกุล':s.full_name, 'ห้อง':room};
      ass.forEach((a,idx)=>{ row[`${workNo(a,idx)}. ${a.title}`]=''; });
      return row;
    });
    const ws=XLSX.utils.json_to_sheet(rows,{skipHeader:false});
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,`scores_${room.replace('/','-')}`);
    XLSX.writeFile(wb,`score_import_template_${room.replace('/','-')}.xlsx`);
    toast('ดาวน์โหลด Template คะแนนแล้ว');
  }catch(e){ toast(e.message); }
}


// ===== Real score / grade =====
const realGroups = [
  {key:'pre', label:'ก่อนกลางภาค', maxId:'realMaxPre', selectId:'realJobsPre'},
  {key:'mid', label:'กลางภาค', maxId:'realMaxMid', selectId:'realJobsMid'},
  {key:'post', label:'หลังกลางภาค', maxId:'realMaxPost', selectId:'realJobsPost'},
  {key:'final', label:'ปลายภาค', maxId:'realMaxFinal', selectId:'realJobsFinal'}
];
function gradeFromScore(total){
  const s=Number(total)||0;
  if(s>=80) return '4.0'; if(s>=75) return '3.5'; if(s>=70) return '3.0'; if(s>=65) return '2.5';
  if(s>=60) return '2.0'; if(s>=55) return '1.5'; if(s>=50) return '1.0'; return '0';
}
function selectedValues(id){ return [...($(id)?.selectedOptions||[])].map(o=>o.value); }
function round2(n){ return Math.round((Number(n)||0)*100)/100; }

// v31: ปัดคะแนนจริงขึ้นเป็นขั้นละ 0.5 คะแนน
// จำนวนเต็มคงเดิม, ถ้ามีเศษ 0.01-.50 -> .5, เศษ .51-.99 -> จำนวนเต็มถัดไป
// ตัวอย่าง 29.20 -> 29.5, 29.50 -> 29.5, 29.51 -> 30
function roundRealScore(n){
  const v=Number(n)||0;
  return Math.ceil((v-1e-9)*2)/2;
}
async function loadRealScoreConfig(){
  if(!supabaseClient) return;
  const room=currentRoom('realRoomSelect');
  const {data,error}=await supabaseClient.from('assignments').select('*').eq('room',room).order('sort_order',{ascending:true});
  if(error) return toast(error.message);
  const ass=data||[];
  realGroups.forEach(g=>{
    const sel=$(g.selectId); if(!sel) return;
    const old=selectedValues(g.selectId);
    const wanted=g.key;
    const filtered=ass.filter(a=>(a.period||'pre')===wanted);
    sel.innerHTML=filtered.map((a,idx)=>`<option value="${a.id}" ${old.includes(a.id)?'selected':''}>${workNo(a,idx)}. ${escapeHtml(a.title)} (${escapeHtml(a.max_score)} คะแนน)</option>`).join('');
  });
  safe('realScoreTable',tbl=>{tbl.querySelector('thead').innerHTML=''; tbl.querySelector('tbody').innerHTML='';});
}
async function loadRealScore(){
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  const room=currentRoom('realRoomSelect');
  const [{data:stu,error:e1},{data:ass,error:e2}] = await Promise.all([
    supabaseClient.from('students').select('*').eq('room',room).order('number',{ascending:true}),
    supabaseClient.from('assignments').select('*').eq('room',room).order('sort_order',{ascending:true})
  ]);
  if(e1) return toast(e1.message); if(e2) return toast(e2.message);
  const students2=stu||[], assignments2=ass||[], assignmentMap={}; assignments2.forEach(a=>assignmentMap[a.id]=a);
  const ids=students2.map(s=>s.id);
  const assignmentIds=assignments2.map(a=>a.id);
  let scoreRows=[];
  try{ scoreRows=await fetchAllScores(ids, assignmentIds); }
  catch(error){ return toast(error.message); }
  const scoreMap={}; scoreRows.forEach(r=>scoreMap[`${r.student_id}_${r.assignment_id}`]=Number(r.score)||0);
  const thead='<tr><th>เลขที่</th><th>รหัส</th><th>ชื่อ-สกุล</th>'+realGroups.map(g=>`<th>${g.label}</th>`).join('')+'<th>รวม</th><th>เกรด</th></tr>';
  const tbody=students2.map(s=>{
    let total=0;
    const cells=realGroups.map(g=>{
      const max=Number($(g.maxId)?.value||0); const jobIds=selectedValues(g.selectId);
      let got=0, full=0;
      jobIds.forEach(id=>{ const a=assignmentMap[id]; if(!a) return; got+=scoreMap[`${s.id}_${id}`]||0; full+=Number(a.max_score)||0; });
      const real=full>0 ? roundRealScore((got/full)*max) : 0; total+=real;
      return `<td><b>${real}</b><div class="real-sub">${round2(got)} / ${round2(full)}</div></td>`;
    }).join('');
    total=round2(total);
    return `<tr${nonexistentRowClass(s)}><td>${escapeHtml(s.number||'')}</td><td>${escapeHtml(s.student_code)}</td><td class="text-left">${escapeHtml(s.prefix||'')}${escapeHtml(s.full_name)} ${nonexistentBadge(s)}</td>${cells}<td><b>${total}</b></td><td><b>${gradeFromScore(total)}</b></td></tr>`;
  }).join('');
  const table=$('realScoreTable'); table.querySelector('thead').innerHTML=thead; table.querySelector('tbody').innerHTML=tbody;
  toast('คำนวณคะแนนจริงแล้ว');
}
function exportRealExcel(){
  if(!window.XLSX) return toast('โหลด Excel library ไม่สำเร็จ');
  const table=$('realScoreTable');
  if(!table || !table.querySelector('tbody tr')) return toast('กรุณาโหลดคะแนนจริงก่อน');

  // Export เฉพาะค่าคะแนนจริง ไม่เอาข้อความคะแนนดิบ / คะแนนเต็ม (.real-sub) ไปใน Excel
  const headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
  const rows=[...table.querySelectorAll('tbody tr')].map(tr=>{
    return [...tr.querySelectorAll('td')].map((td,colIndex)=>{
      // คอลัมน์คะแนนจริง: เอาเฉพาะตัวเลขตัวใหญ่ใน <b>
      if(colIndex>=3 && colIndex<headers.length-2){
        const scoreText=td.querySelector('b')?.textContent?.trim() ?? '';
        const n=Number(scoreText);
        return scoreText!=='' && Number.isFinite(n) ? n : scoreText;
      }

      // คอลัมน์รวม: เก็บเป็นตัวเลขจริง
      if(colIndex===headers.length-2){
        const totalText=td.querySelector('b')?.textContent?.trim() ?? td.textContent.trim();
        const n=Number(totalText);
        return totalText!=='' && Number.isFinite(n) ? n : totalText;
      }

      // เลขที่ / รหัส / ชื่อ / เกรด
      const text=td.textContent.trim();
      if(colIndex===0){
        const n=Number(text);
        return text!=='' && Number.isFinite(n) ? n : text;
      }
      return text;
    });
  });

  const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'RealScore');
  XLSX.writeFile(wb,`คะแนนจริง_${$('realRoomSelect')?.value||''}.xlsx`);
  toast('ดาวน์โหลด Excel คะแนนจริงแล้ว');
}
async function exportRealImage(){
  if(!window.html2canvas) return toast('โหลดระบบส่งออกภาพไม่สำเร็จ');
  const table=$('realScoreTable'); if(!table || !table.querySelector('tbody tr')) return toast('กรุณาโหลดคะแนนจริงก่อน');
  const holder=document.createElement('div'); holder.className='report-export-holder';
  const title=document.createElement('div'); title.className='report-export-title'; title.textContent=`คะแนนจริงและเกรด ห้อง ${$('realRoomSelect')?.value||''}`;
  const clone=table.cloneNode(true); clone.classList.add('report-export-table');
  holder.appendChild(title); holder.appendChild(clone); document.body.appendChild(holder);
  try{ const width=holder.scrollWidth, height=holder.scrollHeight; const canvas=await html2canvas(holder,{backgroundColor:'#ffffff',scale:2,width,height,windowWidth:width,windowHeight:height}); const a=document.createElement('a'); a.href=canvas.toDataURL('image/png'); a.download=`คะแนนจริง_${$('realRoomSelect')?.value||''}.png`; a.click(); toast('โหลดภาพคะแนนจริงแล้ว'); }catch(e){ toast('ส่งออกภาพไม่สำเร็จ: '+e.message); }finally{ holder.remove(); }
}


document.addEventListener('DOMContentLoaded', init);



// ===========================================
// v35 นักเรียนไม่มีตัวตน
// ===========================================
async function loadNonexistentStudents(){
  if(!supabaseClient) return;
  const room=currentRoom('nonexistentRoomSelect');
  if(!room) return toast('กรุณาเลือกห้อง');
  const {data,error}=await supabaseClient.from('students').select('*').eq('room',room).order('number',{ascending:true});
  if(error) return toast(error.message);
  nonexistentStudents=data||[];
  renderNonexistentStudents();
}
function renderNonexistentStudents(){
  const table=$('nonexistentStudentTable'); if(!table) return;
  const rows=nonexistentStudents||[];
  const inactiveCount=rows.filter(isNonexistentStudent).length;
  safe('nonexistentCountBadge',el=>el.textContent=`ไม่มีตัวตน ${inactiveCount} คน / ทั้งหมด ${rows.length} คน`);
  table.querySelector('tbody').innerHTML=rows.map(s=>{
    const inactive=isNonexistentStudent(s);
    return `<tr${nonexistentRowClass(s)}>
      <td>${escapeHtml(s.number??'')}</td>
      <td>${escapeHtml(s.student_code||'')}</td>
      <td class="text-left">${escapeHtml([s.prefix,s.full_name].filter(Boolean).join(' '))} ${nonexistentBadge(s)}</td>
      <td>${inactive ? '<span class="nonexistent-badge">ไม่มีตัวตน</span>' : '<span class="normal-student-badge">นักเรียนปกติ</span>'}</td>
      <td>
        <button type="button" class="mini ${inactive?'ghost':'danger'}" data-toggle-nonexistent="${s.id}" data-next-nonexistent="${inactive?'false':'true'}">
          ${inactive?'คืนเป็นนักเรียนปกติ':'ตั้งเป็นไม่มีตัวตน'}
        </button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5">ยังไม่มีนักเรียนในห้องนี้</td></tr>';

  document.querySelectorAll('[data-toggle-nonexistent]').forEach(btn=>{
    btn.onclick=()=>toggleNonexistentStudent(btn.dataset.toggleNonexistent,btn.dataset.nextNonexistent==='true');
  });
}
async function toggleNonexistentStudent(studentId,nextValue){
  const student=nonexistentStudents.find(s=>s.id===studentId);
  if(!student) return;
  const action=nextValue?'ตั้งเป็นนักเรียนไม่มีตัวตน':'คืนเป็นนักเรียนปกติ';
  if(!confirm(`${action}\n${student.prefix||''}${student.full_name||''} รหัส ${student.student_code}\n\nยืนยันหรือไม่?`)) return;
  const {error}=await supabaseClient.from('students').update({is_nonexistent:nextValue}).eq('id',studentId);
  if(error) return toast(error.message);

  student.is_nonexistent=nextValue;
  [students,managedStudents,attendanceStudents].forEach(list=>{
    const x=(list||[]).find(s=>s.id===studentId);
    if(x) x.is_nonexistent=nextValue;
  });
  renderNonexistentStudents();
  if($('studentTable')) renderStudentTable();
  if($('attendanceTable')) renderAttendanceTable();
  toast(nextValue?'ตั้งค่าเป็น “ไม่มีตัวตน” แล้ว':'คืนเป็นนักเรียนปกติแล้ว');
}

// ==============================
// v34 Attendance / เช็คเวลาเรียน
// ==============================
function localDateISO(d=new Date()){
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function attendanceStatusLabel(v){
  return {present:'มา',late:'สาย',leave:'ลา',absent:'ขาด'}[v] || 'ขาด';
}
function attendanceStatusShort(v){
  return {present:'ม',late:'ส',leave:'ล',absent:'ข'}[v] || 'ข';
}
function attendanceStatusChip(v){
  const st=['present','late','leave','absent'].includes(v)?v:'absent';
  return `<span class="att-code ${st}" title="${attendanceStatusLabel(st)}">${attendanceStatusShort(st)}</span>`;
}
function formatAttendanceDateShort(iso){
  const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}` : String(iso||'');
}
function attendanceStatusOrder(){
  return ['present','late','leave','absent'];
}
function initAttendanceDefaults(){
  const today=localDateISO();
  safe('attendanceDate',el=>{ if(!el.value) el.value=today; });
  safe('attendanceReportTo',el=>{ if(!el.value) el.value=today; });
  safe('attendanceReportFrom',el=>{
    if(!el.value){
      const d=new Date(); d.setDate(1); el.value=localDateISO(d);
    }
  });
}
async function loadTeacherAttendance(){
  if(!supabaseClient) return;
  initAttendanceDefaults();
  const room=currentRoom('attendanceRoomSelect');
  const date=$('attendanceDate')?.value || localDateISO();
  if(!room) return toast('กรุณาเลือกห้อง');

  const {data:stu,error:stuErr}=await supabaseClient.from('students').select('*').eq('room',room).order('number',{ascending:true});
  if(stuErr) return toast(stuErr.message);
  attendanceStudents=stu||[];

  if(!attendanceStudents.length){
    attendanceRows=[];
    renderAttendanceTable();
    return toast('ห้องนี้ยังไม่มีนักเรียน');
  }

  const {data:existing,error:attErr}=await supabaseClient.from('attendance').select('*').eq('room',room).eq('attendance_date',date);
  if(attErr) return toast(attErr.message);
  const existingMap=new Map((existing||[]).map(r=>[r.student_id,r]));

  const missing=attendanceStudents
    .filter(s=>!existingMap.has(s.id))
    .map(s=>({
      student_id:s.id,
      room,
      attendance_date:date,
      status:'absent',
      source:'teacher'
    }));

  if(missing.length){
    const {error}=await supabaseClient.from('attendance').upsert(missing,{onConflict:'student_id,attendance_date'});
    if(error) return toast(error.message);
  }

  const {data:rows,error}=await supabaseClient.from('attendance').select('*').eq('room',room).eq('attendance_date',date);
  if(error) return toast(error.message);
  attendanceRows=rows||[];
  renderAttendanceTable();
}
function renderAttendanceTable(){
  const tbody=$('attendanceTable')?.querySelector('tbody');
  if(!tbody) return;
  const map=new Map((attendanceRows||[]).map(r=>[r.student_id,r]));
  tbody.innerHTML=(attendanceStudents||[]).map(s=>{
    const r=map.get(s.id) || {status:'absent'};
    const status=r.status||'absent';
    const time=r.checked_at ? new Date(r.checked_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}) : '-';
    const buttons=attendanceStatusOrder().map(st=>`<button type="button" class="attendance-status-btn ${st} ${status===st?'active':''}" data-att-student="${s.id}" data-att-status="${st}">${attendanceStatusLabel(st)}</button>`).join('');
    return `<tr${nonexistentRowClass(s)}>
      <td>${escapeHtml(s.number??'')}</td>
      <td>${escapeHtml(s.student_code||'')}</td>
      <td class="text-left">${escapeHtml([s.prefix,s.full_name].filter(Boolean).join(' '))} ${nonexistentBadge(s)}</td>
      <td><div class="attendance-status-group">${buttons}</div></td>
      <td>${escapeHtml(time)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5">ยังไม่มีรายชื่อนักเรียน</td></tr>';

  document.querySelectorAll('[data-att-student]').forEach(btn=>{
    btn.onclick=()=>setAttendanceStatus(btn.dataset.attStudent,btn.dataset.attStatus,'teacher');
  });
  renderAttendanceSummary();
}
function renderAttendanceSummary(){
  const counts={present:0,late:0,leave:0,absent:0};
  const map=new Map((attendanceRows||[]).map(r=>[r.student_id,r.status||'absent']));
  (attendanceStudents||[]).forEach(s=>counts[map.get(s.id)||'absent']++);
  safe('attendancePresentCount',el=>el.textContent=counts.present);
  safe('attendanceLateCount',el=>el.textContent=counts.late);
  safe('attendanceLeaveCount',el=>el.textContent=counts.leave);
  safe('attendanceAbsentCount',el=>el.textContent=counts.absent);
}
async function setAttendanceStatus(studentId,status,source='teacher'){
  const room=currentRoom('attendanceRoomSelect');
  const date=$('attendanceDate')?.value || localDateISO();
  if(!['present','late','leave','absent'].includes(status)) status='absent';
  const checked=status==='absent' ? null : new Date().toISOString();
  const payload={
    student_id:studentId,
    room,
    attendance_date:date,
    status,
    source,
    checked_at:checked
  };
  const {data,error}=await supabaseClient.from('attendance').upsert(payload,{onConflict:'student_id,attendance_date'}).select('*').single();
  if(error) return toast(error.message);
  const idx=attendanceRows.findIndex(r=>r.student_id===studentId);
  if(idx>=0) attendanceRows[idx]=data; else attendanceRows.push(data);
  renderAttendanceTable();
}
function focusAttendanceBarcode(){
  const el=$('attendanceBarcodeInput');
  if(!el) return;
  el.focus(); el.select?.();
  toast('พร้อมรับรหัสนักเรียน');
}
async function handleAttendanceBarcodeKeydown(e){
  if(e.key!=='Enter' && e.key!=='Tab') return;
  e.preventDefault();
  const code=String(e.currentTarget.value||'').trim();
  e.currentTarget.value='';
  if(!code) return;
  await markAttendanceByCode(code);
  e.currentTarget.focus();
}
async function markAttendanceByCode(code){
  if(!attendanceStudents.length) await loadTeacherAttendance();
  const clean=normalizeQR(String(code||'').trim());
  const student=attendanceStudents.find(s=>String(s.student_code)===String(clean));
  if(!student){
    safe('attendanceScanStatus',el=>el.textContent=`ไม่พบรหัส ${clean} ในห้องนี้`);
    return toast('ไม่พบนักเรียนรหัส '+clean);
  }
  if(isNonexistentStudent(student)){
    safe('attendanceScanStatus',el=>el.textContent=`${student.full_name} ถูกตั้งค่าเป็น “ไม่มีตัวตน”`);
    return toast('นักเรียนคนนี้ถูกตั้งค่าเป็น “ไม่มีตัวตน”');
  }
  await setAttendanceStatus(student.id,'present','scanner');
  safe('attendanceScanStatus',el=>el.textContent=`บันทึก “มา” : ${student.prefix||''}${student.full_name||''} (${student.student_code})`);
  toast(`เช็คชื่อ ${student.full_name} = มา`);
}
function randomAttendanceToken(){
  if(window.crypto?.getRandomValues){
    const a=new Uint8Array(16); crypto.getRandomValues(a);
    return Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');
  }
  return Date.now().toString(36)+Math.random().toString(36).slice(2);
}
async function openAttendanceSelfSession(){
  if(!supabaseClient) return;
  await loadTeacherAttendance();
  const room=currentRoom('attendanceRoomSelect');
  const date=$('attendanceDate')?.value || localDateISO();

  // ปิดรอบเก่าของห้อง/วันที่ก่อน
  await supabaseClient.from('attendance_sessions').update({active:false}).eq('room',room).eq('attendance_date',date).eq('active',true);

  const token=randomAttendanceToken();
  const {data,error}=await supabaseClient.from('attendance_sessions').insert({
    token,room,attendance_date:date,active:true
  }).select('*').single();
  if(error) return toast(error.message);
  attendanceSession=data;

  const url=new URL(window.location.href);
  url.search='';
  url.hash='';
  url.searchParams.set('attendance_self',token);
  const selfUrl=url.toString();

  safe('attendanceSelfUrl',el=>el.value=selfUrl);
  safe('attendanceQrInfo',el=>el.textContent=`ห้อง ${room} • วันที่ ${date} • เปิดรับเช็คอินอยู่`);
  safe('attendanceQrPanel',el=>el.classList.remove('hidden'));

  const qrBox=$('attendanceQrCanvas');
  if(qrBox && typeof window.QRCode==='function'){
    try{
      qrBox.innerHTML='';
      new QRCode(qrBox,{
        text:selfUrl,
        width:260,
        height:260,
        colorDark:'#000000',
        colorLight:'#ffffff',
        correctLevel:QRCode.CorrectLevel.H
      });
      toast('สร้าง QR เช็คชื่อแล้ว');
    }catch(e){
      console.error(e);
      toast('สร้าง QR ไม่สำเร็จ: '+e.message);
    }
  }else{
    toast('โหลดไลบรารี QR ไม่สำเร็จ กรุณารีเฟรชหน้าเว็บ');
  }
}
async function closeAttendanceSelfSession(){
  if(!supabaseClient) return;
  const room=currentRoom('attendanceRoomSelect');
  const date=$('attendanceDate')?.value || localDateISO();
  const {error}=await supabaseClient.from('attendance_sessions').update({active:false}).eq('room',room).eq('attendance_date',date).eq('active',true);
  if(error) return toast(error.message);
  attendanceSession=null;
  safe('attendanceQrPanel',el=>el.classList.add('hidden'));
  toast('ปิดรับเช็คอินแล้ว');
}
async function initAttendanceSelfMode(){
  const token=new URLSearchParams(location.search).get('attendance_self');
  if(!token) return;
  const shell=$('attendanceSelfShell');
  if(shell) shell.classList.remove('hidden');
  document.querySelector('.sidebar')?.classList.add('hidden');
  document.querySelector('main.app')?.classList.add('hidden');

  const {data:session,error}=await supabaseClient.from('attendance_sessions').select('*').eq('token',token).maybeSingle();
  if(error || !session || !session.active){
    safe('attendanceSelfSessionInfo',el=>el.textContent='QR นี้หมดอายุหรือปิดรับเช็คอินแล้ว');
    safe('attendanceSelfSubmitBtn',el=>el.disabled=true);
    return;
  }
  attendanceSession=session;
  const {data:stu,error:stuErr}=await supabaseClient.from('students').select('*').eq('room',session.room).order('number',{ascending:true});
  if(stuErr) return safe('attendanceSelfSessionInfo',el=>el.textContent='โหลดรายชื่อนักเรียนไม่สำเร็จ');

  const selfSelect=$('attendanceSelfStudent');
  if(selfSelect){
    selfSelect.innerHTML='';
    (stu||[]).forEach(s=>{
      const o=document.createElement('option');
      o.value=s.id;
      o.textContent=`${s.number??'-'} | ${[s.prefix,s.full_name].filter(Boolean).join(' ')}${isNonexistentStudent(s)?' [ไม่มีตัวตน]':''}`;
      if(isNonexistentStudent(s)) o.disabled=true;
      selfSelect.appendChild(o);
    });
  }
  safe('attendanceSelfSessionInfo',el=>el.textContent=`ห้อง ${session.room} • วันที่ ${session.attendance_date}`);
}
async function submitAttendanceSelfCheck(){
  if(!attendanceSession?.active) return toast('รอบเช็คชื่อนี้ปิดแล้ว');
  const studentId=$('attendanceSelfStudent')?.value;
  const status=$('attendanceSelfStatus')?.value || 'present';
  if(!studentId) return toast('กรุณาเลือกชื่อ');

  // ตรวจ session ซ้ำก่อนบันทึก
  const {data:session,error:sErr}=await supabaseClient.from('attendance_sessions').select('*').eq('id',attendanceSession.id).maybeSingle();
  if(sErr || !session?.active){
    safe('attendanceSelfResult',el=>el.textContent='รอบเช็คชื่อนี้ปิดแล้ว');
    return;
  }

  const {data:student,error:stErr}=await supabaseClient.from('students').select('*').eq('id',studentId).eq('room',session.room).maybeSingle();
  if(stErr || !student) return toast('ไม่พบข้อมูลนักเรียนในห้องนี้');
  if(isNonexistentStudent(student)) return toast('รายชื่อนี้ถูกตั้งค่าเป็น “ไม่มีตัวตน” ไม่สามารถเช็คอินได้');

  const payload={
    student_id:student.id,
    room:session.room,
    attendance_date:session.attendance_date,
    status,
    source:'self',
    checked_at:new Date().toISOString()
  };
  const {error}=await supabaseClient.from('attendance').upsert(payload,{onConflict:'student_id,attendance_date'});
  if(error) return toast(error.message);

  safe('attendanceSelfResult',el=>el.innerHTML=`เช็คอินสำเร็จ<br><b>${escapeHtml([student.prefix,student.full_name].filter(Boolean).join(' '))}</b><br>สถานะ: ${attendanceStatusLabel(status)}`);
  safe('attendanceSelfSubmitBtn',el=>el.disabled=true);
}
async function loadAttendanceReport(){
  if(!supabaseClient) return;
  initAttendanceDefaults();
  const room=currentRoom('attendanceRoomSelect');
  const from=$('attendanceReportFrom')?.value;
  const to=$('attendanceReportTo')?.value;
  if(!from || !to) return toast('กรุณาเลือกช่วงวันที่');
  if(from>to) return toast('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');

  const [stuRes,attRes]=await Promise.all([
    supabaseClient.from('students').select('*').eq('room',room).order('number',{ascending:true}),
    supabaseClient.from('attendance').select('*').eq('room',room).gte('attendance_date',from).lte('attendance_date',to).order('attendance_date',{ascending:true})
  ]);
  if(stuRes.error) return toast(stuRes.error.message);
  if(attRes.error) return toast(attRes.error.message);

  const stu=stuRes.data||[], rows=attRes.data||[];
  const dates=[...new Set(rows.map(r=>r.attendance_date))].sort();
  const byStudent=new Map();
  stu.forEach(s=>byStudent.set(s.id,{student:s,present:0,late:0,leave:0,absent:0,total:dates.length,details:{}}));
  rows.forEach(r=>{
    const x=byStudent.get(r.student_id); if(!x) return;
    const st=['present','late','leave','absent'].includes(r.status)?r.status:'absent';
    x[st]++; x.details[r.attendance_date]=st;
  });

  // ถ้ามีวันเรียนแล้ว แต่บางนักเรียนไม่มี record ในวันนั้น ให้ถือว่าขาด
  byStudent.forEach(x=>{
    const recorded=x.present+x.late+x.leave+x.absent;
    if(recorded<dates.length) x.absent += (dates.length-recorded);
  });

  attendanceReportRows=[...byStudent.values()];
  attendanceReportRows._dates=dates;
  attendanceReportRows._room=room;
  attendanceReportRows._from=from;
  attendanceReportRows._to=to;
  renderAttendanceReport();
}
function renderAttendanceReport(){
  const table=$('attendanceReportTable'); if(!table) return;
  const rows=attendanceReportRows||[];
  const dates=rows._dates||[];
  const room=rows._room||currentRoom('attendanceRoomSelect');
  const from=rows._from||'', to=rows._to||'';

  const dailyHeaders=dates.map(d=>`<th class="attendance-date-head" title="${escapeHtml(d)}">${escapeHtml(formatAttendanceDateShort(d))}</th>`).join('');
  table.querySelector('thead').innerHTML=`<tr>
    <th>เลขที่</th>
    <th>รหัส</th>
    <th>ชื่อ-สกุล</th>
    ${dailyHeaders}
    <th class="sum-head present">ม</th>
    <th class="sum-head late">ส</th>
    <th class="sum-head leave">ล</th>
    <th class="sum-head absent">ข</th>
    <th>รวมวัน</th>
  </tr>`;

  let overall={present:0,late:0,leave:0,absent:0};
  rows.forEach(x=>{
    overall.present+=Number(x.present)||0;
    overall.late+=Number(x.late)||0;
    overall.leave+=Number(x.leave)||0;
    overall.absent+=Number(x.absent)||0;
  });

  const bodyRows=rows.map(x=>{
    const daily=dates.map(d=>`<td class="attendance-day-cell">${attendanceStatusChip(x.details[d]||'absent')}</td>`).join('');
    return `<tr${nonexistentRowClass(x.student)}>
      <td>${escapeHtml(x.student.number??'')}</td>
      <td>${escapeHtml(x.student.student_code||'')}</td>
      <td class="text-left attendance-name-cell">${escapeHtml([x.student.prefix,x.student.full_name].filter(Boolean).join(' '))} ${nonexistentBadge(x.student)}</td>
      ${daily}
      <td><span class="summary-num present">${x.present}</span></td>
      <td><span class="summary-num late">${x.late}</span></td>
      <td><span class="summary-num leave">${x.leave}</span></td>
      <td><span class="summary-num absent">${x.absent}</span></td>
      <td><b>${x.total}</b></td>
    </tr>`;
  }).join('');

  const colspanBase=3+dates.length;
  const totalRow=rows.length ? `<tr class="attendance-total-row">
    <td colspan="${colspanBase}" class="text-right"><b>รวมสถานะทั้งห้อง</b></td>
    <td><b class="summary-num present">${overall.present}</b></td>
    <td><b class="summary-num late">${overall.late}</b></td>
    <td><b class="summary-num leave">${overall.leave}</b></td>
    <td><b class="summary-num absent">${overall.absent}</b></td>
    <td><b>${overall.present+overall.late+overall.leave+overall.absent}</b></td>
  </tr>` : '';

  table.querySelector('tbody').innerHTML=bodyRows+totalRow || `<tr><td colspan="${8+dates.length}">ไม่มีข้อมูลในช่วงวันที่ที่เลือก</td></tr>`;

  safe('attendanceReportMeta',el=>el.textContent=`ห้อง ${room} • ${from} ถึง ${to} • จำนวนวันที่มีการเช็คชื่อ ${dates.length} วัน`);
  safe('attendanceReportOverall',el=>el.innerHTML=`
    <span><b class="att-overall present">ม ${overall.present}</b> มา</span>
    <span><b class="att-overall late">ส ${overall.late}</b> สาย</span>
    <span><b class="att-overall leave">ล ${overall.leave}</b> ลา</span>
    <span><b class="att-overall absent">ข ${overall.absent}</b> ขาด</span>
  `);
}
function exportAttendanceExcel(){
  const rows=attendanceReportRows||[];
  if(!rows.length) return toast('กรุณาโหลดรายงานก่อน');
  const dates=rows._dates||[];
  const summary=[
    ['รายงานสรุปเวลาเรียน'],
    [`ห้อง ${rows._room||''}`,`ช่วง ${rows._from||''} ถึง ${rows._to||''}`,`จำนวนวัน ${dates.length}`],
    ['คำย่อ','ม = มา','ส = สาย','ล = ลา','ข = ขาด'],
    [],
    ['เลขที่','รหัสนักเรียน','ชื่อ-สกุล',...dates.map(formatAttendanceDateShort),'ม','ส','ล','ข','รวมวัน']
  ];

  let overall={present:0,late:0,leave:0,absent:0};
  rows.forEach(x=>{
    overall.present+=x.present; overall.late+=x.late; overall.leave+=x.leave; overall.absent+=x.absent;
    summary.push([
      x.student.number??'',
      x.student.student_code||'',
      [x.student.prefix,x.student.full_name].filter(Boolean).join(' ')+(isNonexistentStudent(x.student)?' [ไม่มีตัวตน]':''),
      ...dates.map(d=>attendanceStatusShort(x.details[d]||'absent')),
      x.present,x.late,x.leave,x.absent,x.total
    ]);
  });
  summary.push(['','','รวมทั้งห้อง',...dates.map(()=>''),overall.present,overall.late,overall.leave,overall.absent,overall.present+overall.late+overall.leave+overall.absent]);

  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet(summary);
  ws['!cols']=[
    {wch:7},{wch:12},{wch:28},
    ...dates.map(()=>({wch:6})),
    {wch:7},{wch:7},{wch:7},{wch:7},{wch:9}
  ];
  XLSX.utils.book_append_sheet(wb,ws,'รายงานเวลาเรียน');
  XLSX.writeFile(wb,`Attendance_${rows._room||'room'}_${rows._from||''}_${rows._to||''}.xlsx`);
}
async function exportAttendancePdf(){
  const rows=attendanceReportRows||[];
  if(!rows.length) return toast('กรุณาโหลดรายงานก่อน');
  const el=$('attendanceReportCapture');
  if(!el) return toast('ไม่พบพื้นที่รายงาน');
  if(!window.html2canvas) return toast('โหลดระบบสร้างภาพรายงานไม่สำเร็จ');
  if(!window.jspdf?.jsPDF) return toast('โหลดระบบ PDF ไม่สำเร็จ กรุณารีเฟรชหน้าเว็บ');

  const filename=`Attendance_${rows._room||'room'}_${rows._from||''}_${rows._to||''}.pdf`;
  const wrap=el.querySelector('.table-wrap');
  const oldOverflow=wrap?.style.overflow;
  const oldMaxHeight=wrap?.style.maxHeight;
  const oldWidth=el.style.width;

  try{
    toast('กำลังสร้าง PDF...');
    await document.fonts?.ready;

    if(wrap){
      wrap.style.overflow='visible';
      wrap.style.maxHeight='none';
    }

    // ขยายพื้นที่ capture ให้เห็นตารางทุกคอลัมน์ ไม่ตัดเฉพาะส่วนที่มองเห็น
    const table=$('attendanceReportTable');
    const targetWidth=Math.max(el.scrollWidth,table?.scrollWidth||0,1100);
    el.style.width=`${targetWidth}px`;

    const canvas=await html2canvas(el,{
      scale:2,
      useCORS:true,
      backgroundColor:'#ffffff',
      scrollX:0,
      scrollY:0,
      windowWidth:targetWidth,
      logging:false
    });

    const {jsPDF}=window.jspdf;
    const pdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    const pageW=pdf.internal.pageSize.getWidth();
    const pageH=pdf.internal.pageSize.getHeight();
    const margin=6;
    const usableW=pageW-margin*2;
    const usableH=pageH-margin*2;

    // ตัด canvas ตามความสูงของ A4 เพื่อให้ข้อมูลทุกแถวขึ้นจริง
    const pxPerMm=canvas.width/usableW;
    const sliceHeightPx=Math.max(1,Math.floor(usableH*pxPerMm));
    let y=0, page=0;

    while(y<canvas.height){
      const h=Math.min(sliceHeightPx,canvas.height-y);
      const slice=document.createElement('canvas');
      slice.width=canvas.width;
      slice.height=h;
      const ctx=slice.getContext('2d');
      ctx.fillStyle='#ffffff';
      ctx.fillRect(0,0,slice.width,slice.height);
      ctx.drawImage(canvas,0,y,canvas.width,h,0,0,canvas.width,h);

      if(page>0) pdf.addPage('a4','landscape');
      const imgData=slice.toDataURL('image/jpeg',0.96);
      const imgH=h/pxPerMm;
      pdf.addImage(imgData,'JPEG',margin,margin,usableW,imgH,'FAST');
      y+=h;
      page++;
    }

    pdf.save(filename);
    toast('สร้าง PDF เรียบร้อยแล้ว');
  }catch(e){
    console.error(e);
    toast('สร้าง PDF ไม่สำเร็จ: '+e.message);
  }finally{
    if(wrap){
      wrap.style.overflow=oldOverflow||'';
      wrap.style.maxHeight=oldMaxHeight||'';
    }
    el.style.width=oldWidth||'';
  }
}

})();
