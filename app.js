(() => {
'use strict';
const cfg = window.APP_CONFIG || {};
let supabaseClient = null;
let assignments = [], students = [], managedStudents = [];
let scanState = 'student', selectedStudent = null, html5QrCode = null, lastText = '', lastAt = 0;
const $ = id => document.getElementById(id);
const safe = (id, fn) => { const el = $(id); if (el && typeof fn === 'function') fn(el); return el; };
function toast(msg){ const box=$('toast'); if(!box){ console.log(msg); return; } const el=document.createElement('div'); el.className='toast'; el.textContent=msg; box.appendChild(el); setTimeout(()=>el.remove(),3500); }
function setStatus(msg, ok=true){ const el=$('connectionStatus'); if(!el) return; el.textContent=msg; el.style.color=ok?'#9fffe7':'#fecaca'; }
function fillSelect(el, items, getVal=x=>x, getText=x=>x){ if(!el) return; el.innerHTML=''; (items||[]).forEach(i=>{ const o=document.createElement('option'); o.value=getVal(i); o.textContent=getText(i); el.appendChild(o); }); }
function escapeHtml(v){ return String(v ?? '').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])); }
function workNo(a, idx){ const n=Number(a?.sort_order); return Number.isFinite(n) && n>0 ? n : idx+1; }
function scoreCellClass(score, maxScore){ const v=Number(score); const max=Number(maxScore); if(v===0) return 'zero-score'; if(Number.isFinite(max) && max>0 && v===max) return 'full-score'; return ''; }
async function withTimeout(promise, ms=12000, label='เชื่อมต่อช้าเกินไป'){ let t; const timeout=new Promise((_,rej)=>{t=setTimeout(()=>rej(new Error(label)),ms)}); try{return await Promise.race([promise,timeout]);} finally{clearTimeout(t);} }
window.addEventListener('error', e => { setStatus('JavaScript error: '+(e.message||'ไม่ทราบสาเหตุ'), false); console.error(e.error||e.message); });
window.addEventListener('unhandledrejection', e => { setStatus('Supabase/Network error: '+(e.reason?.message||e.reason||'ไม่ทราบสาเหตุ'), false); console.error(e.reason); });

function bindEvents(){
  document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{ document.querySelectorAll('.nav,.page').forEach(x=>x.classList.remove('active')); b.classList.add('active'); const page=$(b.dataset.page); if(page) page.classList.add('active'); if(b.dataset.page==='scorePage' && supabaseClient) loadAssignments($('roomSelect')?.value); if(b.dataset.page==='workPage' && supabaseClient) loadAssignments($('workRoomSelect')?.value); if(b.dataset.page==='studentPage' && supabaseClient) loadManagedStudents(); });
  safe('roomSelect',el=>el.onchange=async()=>{ await loadStudents(); await loadAssignments($('roomSelect')?.value); }); safe('workRoomSelect',el=>el.onchange=()=>loadAssignments(el.value)); safe('reportRoomSelect',el=>el.onchange=()=>{}); safe('startScanBtn',el=>el.onclick=startScan); safe('stopScanBtn',el=>el.onclick=stopScan); safe('manualSaveBtn',el=>el.onclick=manualSave);
  safe('addAssignmentBtn',el=>el.onclick=addAssignment); safe('loadReportBtn',el=>el.onclick=loadReport); safe('exportExcelBtn',el=>el.onclick=exportExcel); safe('exportImageBtn',el=>el.onclick=exportImage);
  safe('studentRoomSelect',el=>el.onchange=loadManagedStudents); safe('studentSearchInput',el=>el.oninput=renderStudentTable); safe('clearStudentFormBtn',el=>el.onclick=clearStudentForm);
  safe('studentForm',el=>el.onsubmit=saveStudentForm); safe('studentFileInput',el=>el.onchange=handleStudentFile); safe('previewImportBtn',el=>el.onclick=previewImportStudents);
  safe('confirmImportBtn',el=>el.onclick=importStudents); safe('downloadTemplateBtn',el=>el.onclick=downloadStudentTemplate); safe('scoreFileInput',el=>el.onchange=handleScoreFile); safe('previewScoreImportBtn',el=>el.onclick=previewImportScores); safe('confirmScoreImportBtn',el=>el.onclick=importScores); safe('downloadScoreTemplateBtn',el=>el.onclick=downloadScoreTemplate);
}

async function init(){
  setStatus('กำลังเริ่มระบบ...');
  bindEvents();
  fillSelect($('roomSelect'), cfg.ROOMS||[]); fillSelect($('workRoomSelect'), cfg.ROOMS||[]); fillSelect($('reportRoomSelect'), cfg.ROOMS||[]); fillSelect($('studentRoomSelect'), cfg.ROOMS||[]); fillSelect($('importRoomSelect'), cfg.ROOMS||[]); fillSelect($('studentFormRoom'), cfg.ROOMS||[]);
  if(!window.supabase){ setStatus('โหลดไลบรารี Supabase ไม่สำเร็จ ให้เช็คอินเทอร์เน็ต/CDN', false); toast('โหลด Supabase JS ไม่สำเร็จ'); return; }
  if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || String(cfg.SUPABASE_URL).includes('YOUR_PROJECT')){ setStatus('ยังไม่ได้ตั้งค่า config.js', false); toast('ต้องมีไฟล์ config.js ใน GitHub root'); return; }
  try{ supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY); }
  catch(e){ setStatus('ตั้งค่า Supabase ไม่ถูกต้อง', false); toast(e.message); return; }
  setStatus('กำลังเชื่อมต่อ Supabase...');
  try{
    await withTimeout(Promise.all([loadAssignments($('roomSelect')?.value || (cfg.ROOMS||[])[0]), loadStudents(), loadManagedStudents()]),15000,'เชื่อมต่อ Supabase ไม่สำเร็จใน 15 วินาที');
    setStatus('เชื่อมต่อ Supabase แล้ว');
    toast('ระบบพร้อมใช้งาน');
  }catch(e){ setStatus('เชื่อมต่อไม่สำเร็จ: '+e.message, false); toast('เช็ค config.js / RLS / อินเทอร์เน็ต'); }
}

async function loadAssignments(roomArg){
  if(!supabaseClient) return;
  const room = roomArg || $('workRoomSelect')?.value || $('roomSelect')?.value || (cfg.ROOMS||[])[0];
  if($('workRoomSelect') && roomArg) $('workRoomSelect').value = roomArg;
  let query = supabaseClient.from('assignments').select('*').order('sort_order',{ascending:true});
  if(room) query = query.eq('room', room);
  const {data,error}=await query;
  if(error) throw error;
  assignments=data||[];
  fillSelect($('assignmentSelect'),assignments,a=>a.id,(a,idx)=>`${workNo(a,idx)}. ${a.title} (${a.max_score} คะแนน)`);
  renderAssignmentList();
}
async function loadStudents(){ if(!supabaseClient) return; const room=$('roomSelect')?.value || (cfg.ROOMS||[])[0]; if(!room) return; const {data,error}=await supabaseClient.from('students').select('*').eq('room',room).order('number',{ascending:true}); if(error) throw error; students=data||[]; }
function renderAssignmentList(){
  const el=$('assignmentList'); if(!el) return;
  el.innerHTML=assignments.map((a,idx)=>`
    <div class="list-item work-item">
      <div class="work-main"><b>${workNo(a,idx)}. ${escapeHtml(a.title)}</b><span>ห้อง ${escapeHtml(a.room||'-')} | ${escapeHtml(a.max_score)} คะแนน</span></div>
      <div class="table-actions">
        <button class="mini ghost" data-work-up="${a.id}" ${idx===0?'disabled':''}>↑</button>
        <button class="mini ghost" data-work-down="${a.id}" ${idx===assignments.length-1?'disabled':''}>↓</button>
        <button class="mini" data-work-edit="${a.id}">แก้ไข</button>
        <button class="mini danger" data-work-delete="${a.id}">ลบ</button>
      </div>
    </div>`).join('') || '<p class="hint">ยังไม่มีชิ้นงาน</p>';
  document.querySelectorAll('[data-work-edit]').forEach(b=>b.onclick=()=>editAssignment(b.dataset.workEdit));
  document.querySelectorAll('[data-work-delete]').forEach(b=>b.onclick=()=>deleteAssignment(b.dataset.workDelete));
  document.querySelectorAll('[data-work-up]').forEach(b=>b.onclick=()=>moveAssignment(b.dataset.workUp,-1));
  document.querySelectorAll('[data-work-down]').forEach(b=>b.onclick=()=>moveAssignment(b.dataset.workDown,1));
}
async function addAssignment(){
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  const room=$('workRoomSelect')?.value || $('roomSelect')?.value || (cfg.ROOMS||[])[0];
  const title=$('newAssignmentName')?.value.trim();
  const max=Number($('newMaxScore')?.value||10);
  if(!room) return toast('กรุณาเลือกห้องของชิ้นงาน');
  if(!title) return toast('กรุณากรอกชื่องาน');

  // v8: ให้เลขลำดับเป็นของแต่ละห้อง ไม่ใช้ identity global ของฐานข้อมูล
  const {data:orders,error:orderError}=await supabaseClient
    .from('assignments')
    .select('sort_order')
    .eq('room',room)
    .order('sort_order',{ascending:false})
    .limit(1);
  if(orderError) return toast(orderError.message);
  const nextOrder = ((orders && orders[0] && Number(orders[0].sort_order)) || 0) + 1;

  const {error}=await supabaseClient.from('assignments').insert({room,title,max_score:max,sort_order:nextOrder});
  if(error) return toast(error.message);
  $('newAssignmentName').value='';
  await loadAssignments(room);
  if($('roomSelect')?.value===room) await loadAssignments(room);
  toast('เพิ่มชิ้นงานของห้อง '+room+' แล้ว');
}
async function editAssignment(id){
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  const a=assignments.find(x=>x.id===id); if(!a) return;
  const title=prompt('แก้ไขชื่อชิ้นงาน', a.title); if(title===null) return;
  const maxRaw=prompt('แก้ไขคะแนนเต็ม', a.max_score); if(maxRaw===null) return;
  const max=Number(maxRaw); if(!title.trim() || Number.isNaN(max)) return toast('กรอกข้อมูลชิ้นงานไม่ถูกต้อง');
  const {error}=await supabaseClient.from('assignments').update({title:title.trim(),max_score:max}).eq('id',id);
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
  const idx=assignments.findIndex(x=>x.id===id); const other=assignments[idx+dir]; const current=assignments[idx];
  if(!current || !other) return;
  const aOrder=current.sort_order, bOrder=other.sort_order;
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
async function handleStudentCode(code){ let stu = students.find(s=>String(s.student_code)===String(code)); if(!stu){const {data}=await supabaseClient.from('students').select('*').eq('student_code',code).maybeSingle(); stu=data} if(!stu) return toast('ไม่พบรหัสนักเรียน: '+code); selectedStudent=stu; safe('currentStudent',el=>el.innerHTML=`<div class="student-name">${escapeHtml(stu.prefix||'')}${escapeHtml(stu.full_name)}</div><div class="student-meta">ห้อง ${escapeHtml(stu.room)} เลขที่ ${escapeHtml(stu.number||'-')} | รหัส ${escapeHtml(stu.student_code)}</div>`); showBigOverlay('student', `${stu.prefix||''}${stu.full_name}`, `ห้อง ${stu.room} เลขที่ ${stu.number||'-'} | สแกนคะแนนต่อ`); scanState='score'; updateMode(); toast('พบนักเรียนแล้ว → สแกนคะแนนต่อ'); }
async function handleScore(raw){
  const score=Number(raw);
  if(Number.isNaN(score)) return toast('QR คะแนนต้องเป็นตัวเลขเท่านั้น');
  if(!selectedStudent) return toast('กรุณาสแกนนักเรียนก่อน');
  const stu=selectedStudent;
  const result=await saveScore(stu.student_code, score, {source:'scan'});
  if(result?.saved){
    showBigOverlay('score', `${score} คะแนน`, `${stu.prefix||''}${stu.full_name}`);
  }else if(result?.duplicate){
    showBigOverlay('warning', 'ลงคะแนนแล้ว', `${stu.prefix||''}${stu.full_name} | คะแนนเดิม ${result.oldScore}`);
  }
  scanState='student'; selectedStudent=null; updateMode(); safe('currentStudent',el=>el.innerHTML='สแกนนักเรียนคนต่อไปได้เลย');
}
async function getExistingScore(studentId, assignmentId){
  const {data,error}=await supabaseClient.from('scores').select('id,score').eq('student_id',studentId).eq('assignment_id',assignmentId).maybeSingle();
  if(error) throw error;
  return data || null;
}
function confirmOverwriteScore({stu, ass, oldScore, newScore}){
  return confirm(`นักเรียนคนนี้ลงคะแนนงานนี้แล้ว\n\nนักเรียน: ${(stu.prefix||'')}${stu.full_name}\nชิ้นงาน: ${ass?.title||''}\nคะแนนเดิม: ${oldScore}\nคะแนนใหม่: ${newScore}\n\nต้องการบันทึกทับคะแนนเดิมหรือไม่?`);
}
async function saveScore(studentCode, score, opts={}){
  if(!supabaseClient){ toast('ยังไม่เชื่อมต่อ Supabase'); return {saved:false}; }
  const assignmentId=$('assignmentSelect')?.value;
  if(!assignmentId){ toast('กรุณาเลือกชิ้นงาน'); return {saved:false}; }
  let stu = students.find(s=>String(s.student_code)===String(studentCode));
  if(!stu){const {data}=await supabaseClient.from('students').select('*').eq('student_code',studentCode).maybeSingle(); stu=data}
  if(!stu){ toast('ไม่พบนักเรียน'); return {saved:false}; }
  const ass=assignments.find(a=>a.id===assignmentId);
  let existing=null;
  try{ existing=await getExistingScore(stu.id, assignmentId); }catch(e){ toast(e.message); return {saved:false}; }
  const oldScore=Number(existing?.score ?? 0);
  const hasRealScore=existing && Number.isFinite(oldScore) && oldScore!==0;
  if(hasRealScore){
    toast(`แจ้งเตือน: ${stu.full_name} ลงคะแนนงานนี้แล้ว (${oldScore} คะแนน)`);
    const ok=confirmOverwriteScore({stu, ass, oldScore, newScore:score});
    if(!ok){
      safe('lastSaved',el=>el.innerHTML=`<b class="warn-text">ยังไม่บันทึกทับ:</b> ${escapeHtml(stu.full_name)} | ${escapeHtml(ass?.title||'')} มีคะแนนเดิม <b>${escapeHtml(oldScore)}</b>`);
      return {saved:false, duplicate:true, oldScore, stu, ass};
    }
  }
  const {error}=await supabaseClient.from('scores').upsert({student_id:stu.id,assignment_id:assignmentId,score,updated_at:new Date().toISOString()},{onConflict:'student_id,assignment_id'});
  if(error){ toast(error.message); return {saved:false}; }
  safe('lastSaved',el=>el.innerHTML=`บันทึกแล้ว: <b>${escapeHtml(stu.full_name)}</b> | ${escapeHtml(ass?.title||'')} = <b>${escapeHtml(score)}</b>`);
  toast(hasRealScore ? 'บันทึกทับคะแนนเดิมแล้ว' : 'บันทึกคะแนนอัตโนมัติแล้ว');
  return {saved:true, duplicate:hasRealScore, oldScore, stu, ass};
}
async function manualSave(){ const code=$('manualCode')?.value.trim(); const score=Number($('manualScore')?.value); if(!code||Number.isNaN(score)) return toast('กรอกข้อมูล Manual ให้ครบ'); await saveScore(code,score,{source:'manual'}); }
async function loadReport(){
  if(!supabaseClient) return toast('ยังไม่เชื่อมต่อ Supabase');
  const room=$('reportRoomSelect')?.value;
  const {data:roomAssignments,error:e0}=await supabaseClient.from('assignments').select('*').eq('room',room).order('sort_order',{ascending:true});
  if(e0) return toast(e0.message);
  const reportAssignments=roomAssignments||[];
  const {data:stu,error:e1}=await supabaseClient.from('students').select('*').eq('room',room).order('number',{ascending:true});
  if(e1) return toast(e1.message);
  const ids=(stu||[]).map(s=>s.id); let scoreRows=[];
  if(ids.length){const {data,error}=await supabaseClient.from('scores').select('student_id,assignment_id,score').in('student_id',ids); if(error) return toast(error.message); scoreRows=data||[]}
  const scoreMap={}; scoreRows.forEach(r=>scoreMap[`${r.student_id}_${r.assignment_id}`]=r.score);
  const thead='<tr><th>เลขที่</th><th>รหัส</th><th>ชื่อ-สกุล</th>'+reportAssignments.map((a,idx)=>`<th>${workNo(a,idx)}. ${escapeHtml(a.title)}</th>`).join('')+'<th>รวม</th></tr>';
  const tbody=(stu||[]).map(s=>{
    let total=0;
    const tds=reportAssignments.map(a=>{
      const key=`${s.id}_${a.id}`; const has=scoreMap[key]!==undefined; const v=has ? Number(scoreMap[key]) : 0; total+=v;
      const cellClass = scoreCellClass(v, a.max_score);
      return `<td class="score-cell ${cellClass}"><input class="score-input" type="number" step="0.01" value="${escapeHtml(v)}" data-student-id="${s.id}" data-assignment-id="${a.id}" data-max-score="${escapeHtml(a.max_score)}" data-original="${escapeHtml(v)}" title="แก้ไขคะแนนแล้วกด Enter หรือคลิกออก" /></td>`;
    }).join('');
    return `<tr><td>${escapeHtml(s.number||'')}</td><td>${escapeHtml(s.student_code)}</td><td class="text-left">${escapeHtml(s.prefix||'')}${escapeHtml(s.full_name)}</td>${tds}<td><b class="row-total">${escapeHtml(total)}</b></td></tr>`
  }).join('');
  $('reportTable').querySelector('thead').innerHTML=thead;
  $('reportTable').querySelector('tbody').innerHTML=tbody;
  bindReportScoreInputs();
  toast('โหลดรายงานแล้ว');
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
  const score=Number(inp.value);
  const original=Number(inp.dataset.original || 0);
  if(Number.isNaN(score) || score<0){ toast('คะแนนต้องเป็นตัวเลข 0 ขึ้นไป'); inp.value=inp.dataset.original||0; return; }
  if(original!==0 && score!==original){
    const ok=confirm(`คะแนนช่องนี้เคยลงไว้แล้ว (${original} คะแนน)\nต้องการแก้เป็น ${score} คะแนนหรือไม่?`);
    if(!ok){ inp.value=inp.dataset.original||0; return; }
  }
  inp.dataset.saving='1';
  const payload={student_id:inp.dataset.studentId, assignment_id:inp.dataset.assignmentId, score, updated_at:new Date().toISOString()};
  const {error}=await supabaseClient.from('scores').upsert(payload,{onConflict:'student_id,assignment_id'});
  inp.dataset.saving='0';
  if(error){ toast(error.message); inp.value=inp.dataset.original||0; return; }
  inp.dataset.original=String(score);
  const td=inp.closest('td');
  if(td){
    td.classList.remove('missing-score','zero-score','full-score');
    const cls=scoreCellClass(score, inp.dataset.maxScore);
    if(cls) td.classList.add(cls);
  }
  recalcReportRow(inp.closest('tr'));
  toast(original!==0 ? 'แก้ไขคะแนนเดิมแล้ว' : 'อัปเดตคะแนนแล้ว');
}
function recalcReportRow(tr){
  if(!tr) return; let total=0;
  tr.querySelectorAll('.score-input').forEach(i=>{const n=Number(i.value); if(!Number.isNaN(n)) total+=n;});
  const el=tr.querySelector('.row-total'); if(el) el.textContent=String(total);
}
function getReportAOA(){
  const table=$('reportTable');
  if(!table) return [];
  const aoa=[];
  const head=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
  if(head.length) aoa.push(head);
  table.querySelectorAll('tbody tr').forEach(tr=>{
    const row=[...tr.children].map(td=>{
      const input=td.querySelector('input');
      if(input) return Number(input.value || 0);
      const txt=td.textContent.trim();
      const n=Number(txt);
      return txt!=='' && !Number.isNaN(n) ? n : txt;
    });
    if(row.length) aoa.push(row);
  });
  return aoa;
}
function exportExcel(){
  if(!window.XLSX) return toast('โหลด Excel library ไม่สำเร็จ');
  const aoa=getReportAOA();
  if(!aoa.length) return toast('กรุณาโหลดรายงานก่อน');
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Report');
  XLSX.writeFile(wb,`รายงานคะแนน_${$('reportRoomSelect')?.value||''}.xlsx`);
}
function cloneReportTableForExport(){
  const original=$('reportTable');
  if(!original) return null;
  const clone=original.cloneNode(true);
  clone.querySelectorAll('input.score-input').forEach(inp=>{
    const span=document.createElement('span');
    span.className='export-score-value';
    span.textContent=inp.value || '0';
    inp.replaceWith(span);
  });
  clone.classList.add('report-export-table');
  return clone;
}
async function exportImage(){
  if(!window.html2canvas) return toast('โหลดระบบส่งออกภาพไม่สำเร็จ');
  const table=$('reportTable');
  if(!table || !table.querySelector('tbody tr')) return toast('กรุณาโหลดรายงานก่อน');
  const holder=document.createElement('div');
  holder.className='report-export-holder';
  const title=document.createElement('div');
  title.className='report-export-title';
  title.textContent=`รายงานคะแนน ห้อง ${$('reportRoomSelect')?.value || ''}`;
  const clone=cloneReportTableForExport();
  holder.appendChild(title);
  holder.appendChild(clone);
  document.body.appendChild(holder);
  try{
    const width=holder.scrollWidth;
    const height=holder.scrollHeight;
    const canvas=await html2canvas(holder,{backgroundColor:'#ffffff',scale:2,width,height,windowWidth:width,windowHeight:height,scrollX:0,scrollY:0});
    const a=document.createElement('a');
    a.href=canvas.toDataURL('image/png');
    a.download=`รายงานคะแนน_${$('reportRoomSelect')?.value||''}.png`;
    a.click();
    toast('ส่งออกภาพรายงานแล้ว');
  }catch(e){
    toast('ส่งออกภาพไม่สำเร็จ: '+e.message);
  }finally{
    holder.remove();
  }
}
async function loadManagedStudents(){ if(!supabaseClient) return; const room=$('studentRoomSelect')?.value || (cfg.ROOMS||[])[0]; if(!room) return; const {data,error}=await supabaseClient.from('students').select('*').eq('room',room).order('number',{ascending:true}); if(error) throw error; managedStudents=data||[]; renderStudentTable(); }
function renderStudentTable(){ if(!$('studentTable')) return; const q=($('studentSearchInput')?.value||'').trim().toLowerCase(); const rows=managedStudents.filter(s=>!q || [s.student_code,s.prefix,s.full_name,s.room,s.number].some(v=>String(v??'').toLowerCase().includes(q))); safe('studentCountBadge',el=>el.textContent=`${rows.length} คน`); $('studentTable').querySelector('thead').innerHTML='<tr><th>เลขที่</th><th>รหัส</th><th>คำนำหน้า</th><th>ชื่อ-สกุล</th><th>ห้อง</th><th>จัดการ</th></tr>'; $('studentTable').querySelector('tbody').innerHTML=rows.map(s=>`<tr><td>${escapeHtml(s.number??'')}</td><td>${escapeHtml(s.student_code)}</td><td>${escapeHtml(s.prefix??'')}</td><td class="text-left"><b>${escapeHtml(s.full_name)}</b></td><td>${escapeHtml(s.room)}</td><td class="table-actions"><button class="mini" data-edit="${s.id}">แก้ไข</button><button class="mini danger" data-delete="${s.id}">ลบ</button></td></tr>`).join('') || '<tr><td colspan="6">ยังไม่มีนักเรียนในห้องนี้</td></tr>'; document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editStudent(b.dataset.edit)); document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteStudent(b.dataset.delete)); }
function clearStudentForm(){ ['studentId','studentCode','studentPrefix','studentFullName','studentNumber'].forEach(id=>safe(id,el=>el.value='')); safe('studentFormRoom',el=>el.value=$('studentRoomSelect')?.value || (cfg.ROOMS||[])[0] || ''); safe('studentFormTitle',el=>el.textContent='เพิ่มนักเรียน'); safe('saveStudentBtn',el=>el.textContent='บันทึกนักเรียน'); }
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
  const rooms=(cfg.ROOMS||[]).map(x=>String(x));
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
function downloadStudentTemplate(){ if(!window.XLSX) return toast('โหลด Excel library ไม่สำเร็จ'); const data=[{student_code:'40201',prefix:'นาย',full_name:'ตัวอย่าง นักเรียน',room:$('importRoomSelect')?.value||'4/2',number:1}]; const ws=XLSX.utils.json_to_sheet(data,{header:['student_code','prefix','full_name','room','number']}); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'students'); XLSX.writeFile(wb,'student_import_template.xlsx'); }


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
  const room=$('reportRoomSelect')?.value || (cfg.ROOMS||[])[0];
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
  const room=$('reportRoomSelect')?.value || (cfg.ROOMS||[])[0];
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


document.addEventListener('DOMContentLoaded', init);
})();
