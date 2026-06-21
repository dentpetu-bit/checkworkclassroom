const cfg = window.APP_CONFIG || {};
let supabase = null;
let assignments = [], students = [], managedStudents = [], scanState = 'student', selectedStudent = null, html5QrCode = null, lastText = '', lastAt = 0;
const $ = id => document.getElementById(id);

function toast(msg){const el=document.createElement('div');el.className='toast';el.textContent=msg;$('toast').appendChild(el);setTimeout(()=>el.remove(),3200)}
function setStatus(msg, ok=true){$('connectionStatus').textContent=msg;$('connectionStatus').style.color=ok?'#9fffe7':'#fecaca'}
function fillSelect(el, items, getVal=x=>x, getText=x=>x){if(!el)return;el.innerHTML='';items.forEach(i=>{const o=document.createElement('option');o.value=getVal(i);o.textContent=getText(i);el.appendChild(o)})}
function escapeHtml(v){return String(v ?? '').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}

async function init(){
  bindEvents();
  fillSelect($('roomSelect'), cfg.ROOMS||[]);
  fillSelect($('reportRoomSelect'), cfg.ROOMS||[]);
  fillSelect($('studentRoomSelect'), cfg.ROOMS||[]);
  fillSelect($('importRoomSelect'), cfg.ROOMS||[]);
  fillSelect($('studentFormRoom'), cfg.ROOMS||[]);

  if(!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.includes('YOUR_PROJECT')){
    setStatus('ยังไม่ได้ตั้งค่า config.js',false);
    toast('กรุณาสร้าง/อัปโหลดไฟล์ config.js');
    return;
  }

  try{
    supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }catch(e){
    setStatus('ตั้งค่า Supabase ไม่ถูกต้อง',false);
    toast('สร้าง Supabase client ไม่สำเร็จ: '+e.message);
    return;
  }

  await Promise.all([loadAssignments(), loadStudents(), loadManagedStudents()]);
  setStatus('เชื่อมต่อ Supabase แล้ว');
}

function bindEvents(){
  document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.nav,.page').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $(b.dataset.page).classList.add('active');
    if(b.dataset.page==='studentPage') loadManagedStudents();
  });
  $('roomSelect').onchange=loadStudents;
  $('startScanBtn').onclick=startScan;
  $('stopScanBtn').onclick=stopScan;
  $('manualSaveBtn').onclick=manualSave;
  $('addAssignmentBtn').onclick=addAssignment;
  $('loadReportBtn').onclick=loadReport;
  $('exportExcelBtn').onclick=exportExcel;
  $('exportImageBtn').onclick=exportImage;

  $('studentRoomSelect').onchange=loadManagedStudents;
  $('studentSearchInput').oninput=renderStudentTable;
  $('clearStudentFormBtn').onclick=clearStudentForm;
  $('studentForm').onsubmit=saveStudentForm;
  $('studentFileInput').onchange=handleStudentFile;
  $('previewImportBtn').onclick=previewImportStudents;
  $('confirmImportBtn').onclick=importStudents;
  $('downloadTemplateBtn').onclick=downloadStudentTemplate;
}

async function loadAssignments(){
  const {data,error}=await supabase.from('assignments').select('*').order('sort_order',{ascending:true});
  if(error){toast(error.message);return}
  assignments=data||[];
  fillSelect($('assignmentSelect'),assignments,a=>a.id,a=>`${a.sort_order}. ${a.title} (${a.max_score} คะแนน)`);
  renderAssignmentList();
}

async function loadStudents(){
  const room=$('roomSelect').value || (cfg.ROOMS||[])[0]; if(!room) return;
  const {data,error}=await supabase.from('students').select('*').eq('room',room).order('number',{ascending:true});
  if(error){toast(error.message);return}
  students=data||[];
}

function renderAssignmentList(){
  $('assignmentList').innerHTML=assignments.map(a=>`<div class="list-item"><b>${escapeHtml(a.sort_order)}. ${escapeHtml(a.title)}</b><span>${escapeHtml(a.max_score)} คะแนน</span></div>`).join('') || '<p class="hint">ยังไม่มีชิ้นงาน</p>';
}

async function addAssignment(){
  const title=$('newAssignmentName').value.trim(); const max=Number($('newMaxScore').value||10); if(!title) return toast('กรุณากรอกชื่องาน');
  const {error}=await supabase.from('assignments').insert({title,max_score:max}); if(error) return toast(error.message);
  $('newAssignmentName').value=''; await loadAssignments(); toast('เพิ่มชิ้นงานแล้ว');
}

function normalizeQR(text){return String(text||'').trim().replace(/^score:/i,'').replace(/^student:/i,'')}
async function startScan(){
  if(html5QrCode) return;
  html5QrCode = new Html5Qrcode('reader');
  scanState='student'; updateMode();
  try{await html5QrCode.start({facingMode:'environment'},{fps:10,qrbox:{width:250,height:250}},onScan,()=>{});toast('เปิดกล้องแล้ว')}catch(e){toast('เปิดกล้องไม่ได้: '+e.message)}
}
async function stopScan(){ if(!html5QrCode) return; await html5QrCode.stop().catch(()=>{}); await html5QrCode.clear().catch(()=>{}); html5QrCode=null; toast('ปิดกล้องแล้ว') }
function updateMode(){ $('scanModeBadge').textContent = scanState==='student' ? 'พร้อมสแกนนักเรียน' : 'พร้อมสแกน QR คะแนน'; }
async function onScan(decodedText){
  const now=Date.now(); if(decodedText===lastText && now-lastAt<1600) return; lastText=decodedText; lastAt=now;
  const value=normalizeQR(decodedText);
  if(scanState==='student') await handleStudentCode(value); else await handleScore(value);
}
async function handleStudentCode(code){
  let stu = students.find(s=>String(s.student_code)===String(code));
  if(!stu){const {data}=await supabase.from('students').select('*').eq('student_code',code).maybeSingle(); stu=data}
  if(!stu) return toast('ไม่พบรหัสนักเรียน: '+code);
  selectedStudent=stu; $('currentStudent').innerHTML=`<div class="student-name">${escapeHtml(stu.prefix||'')}${escapeHtml(stu.full_name)}</div><div class="student-meta">ห้อง ${escapeHtml(stu.room)} เลขที่ ${escapeHtml(stu.number||'-')} | รหัส ${escapeHtml(stu.student_code)}</div>`;
  scanState='score'; updateMode(); toast('พบนักเรียนแล้ว → สแกนคะแนนต่อ');
}
async function handleScore(raw){
  const score=Number(raw); if(Number.isNaN(score)) return toast('QR คะแนนต้องเป็นตัวเลขเท่านั้น');
  await saveScore(selectedStudent.student_code, score); scanState='student'; selectedStudent=null; updateMode(); $('currentStudent').innerHTML='สแกนนักเรียนคนต่อไปได้เลย';
}
async function saveScore(studentCode, score){
  const assignmentId=$('assignmentSelect').value; if(!assignmentId) return toast('กรุณาเลือกชิ้นงาน');
  let stu = students.find(s=>String(s.student_code)===String(studentCode));
  if(!stu){const {data}=await supabase.from('students').select('*').eq('student_code',studentCode).maybeSingle(); stu=data}
  if(!stu) return toast('ไม่พบนักเรียน');
  const {error}=await supabase.from('scores').upsert({student_id:stu.id,assignment_id:assignmentId,score,updated_at:new Date().toISOString()},{onConflict:'student_id,assignment_id'});
  if(error) return toast(error.message);
  const ass=assignments.find(a=>a.id===assignmentId);
  $('lastSaved').innerHTML=`บันทึกแล้ว: <b>${escapeHtml(stu.full_name)}</b> | ${escapeHtml(ass?.title||'')} = <b>${escapeHtml(score)}</b>`; toast('บันทึกคะแนนอัตโนมัติแล้ว');
}
async function manualSave(){ const code=$('manualCode').value.trim(); const score=Number($('manualScore').value); if(!code||Number.isNaN(score)) return toast('กรอกข้อมูล Manual ให้ครบ'); await saveScore(code,score); }

async function loadReport(){
  const room=$('reportRoomSelect').value; const {data:stu,error:e1}=await supabase.from('students').select('*').eq('room',room).order('number',{ascending:true}); if(e1) return toast(e1.message);
  const ids=(stu||[]).map(s=>s.id); let scoreRows=[]; if(ids.length){const {data,error}=await supabase.from('scores').select('student_id,assignment_id,score').in('student_id',ids); if(error) return toast(error.message); scoreRows=data||[]}
  const scoreMap={}; scoreRows.forEach(r=>scoreMap[`${r.student_id}_${r.assignment_id}`]=r.score);
  const thead='<tr><th>เลขที่</th><th>รหัส</th><th>ชื่อ-สกุล</th>'+assignments.map(a=>`<th>${escapeHtml(a.sort_order)}. ${escapeHtml(a.title)}</th>`).join('')+'<th>รวม</th></tr>';
  const tbody=(stu||[]).map(s=>{let total=0; const tds=assignments.map(a=>{const v=scoreMap[`${s.id}_${a.id}`]; if(v!==undefined) total+=Number(v); return `<td>${escapeHtml(v??'')}</td>`}).join(''); return `<tr><td>${escapeHtml(s.number||'')}</td><td>${escapeHtml(s.student_code)}</td><td>${escapeHtml(s.prefix||'')}${escapeHtml(s.full_name)}</td>${tds}<td><b>${escapeHtml(total)}</b></td></tr>`}).join('');
  $('reportTable').querySelector('thead').innerHTML=thead; $('reportTable').querySelector('tbody').innerHTML=tbody; toast('โหลดรายงานแล้ว');
}
function exportExcel(){ const wb=XLSX.utils.table_to_book($('reportTable'),{sheet:'Report'}); XLSX.writeFile(wb,`รายงานคะแนน_${$('reportRoomSelect').value}.xlsx`); }
async function exportImage(){ const canvas=await html2canvas($('reportCapture'),{backgroundColor:'#ffffff',scale:2}); const a=document.createElement('a'); a.href=canvas.toDataURL('image/png'); a.download=`รายงานคะแนน_${$('reportRoomSelect').value}.png`; a.click(); }

// ---------------- Student Management ----------------
async function loadManagedStudents(){
  const room=$('studentRoomSelect').value || (cfg.ROOMS||[])[0]; if(!room) return;
  const {data,error}=await supabase.from('students').select('*').eq('room',room).order('number',{ascending:true});
  if(error) return toast(error.message);
  managedStudents=data||[];
  renderStudentTable();
}

function renderStudentTable(){
  const q=($('studentSearchInput').value||'').trim().toLowerCase();
  const rows=managedStudents.filter(s=>!q || [s.student_code,s.prefix,s.full_name,s.room,s.number].some(v=>String(v??'').toLowerCase().includes(q)));
  $('studentCountBadge').textContent=`${rows.length} คน`;
  $('studentTable').querySelector('thead').innerHTML='<tr><th>เลขที่</th><th>รหัส</th><th>คำนำหน้า</th><th>ชื่อ-สกุล</th><th>ห้อง</th><th>จัดการ</th></tr>';
  $('studentTable').querySelector('tbody').innerHTML=rows.map(s=>`
    <tr>
      <td>${escapeHtml(s.number??'')}</td>
      <td>${escapeHtml(s.student_code)}</td>
      <td>${escapeHtml(s.prefix??'')}</td>
      <td class="text-left"><b>${escapeHtml(s.full_name)}</b></td>
      <td>${escapeHtml(s.room)}</td>
      <td class="table-actions"><button class="mini" onclick="editStudent('${s.id}')">แก้ไข</button><button class="mini danger" onclick="deleteStudent('${s.id}')">ลบ</button></td>
    </tr>`).join('') || '<tr><td colspan="6">ยังไม่มีนักเรียนในห้องนี้</td></tr>';
}

function clearStudentForm(){
  $('studentId').value=''; $('studentCode').value=''; $('studentPrefix').value=''; $('studentFullName').value=''; $('studentNumber').value='';
  $('studentFormRoom').value=$('studentRoomSelect').value || (cfg.ROOMS||[])[0] || '';
  $('studentFormTitle').textContent='เพิ่มนักเรียน';
  $('saveStudentBtn').textContent='บันทึกนักเรียน';
}

function editStudent(id){
  const s=managedStudents.find(x=>x.id===id); if(!s) return;
  $('studentId').value=s.id; $('studentCode').value=s.student_code||''; $('studentPrefix').value=s.prefix||''; $('studentFullName').value=s.full_name||''; $('studentNumber').value=s.number??''; $('studentFormRoom').value=s.room||'';
  $('studentFormTitle').textContent='แก้ไขนักเรียน'; $('saveStudentBtn').textContent='อัปเดตข้อมูล';
  window.scrollTo({top:0,behavior:'smooth'});
}

async function saveStudentForm(e){
  e.preventDefault();
  const id=$('studentId').value;
  const payload={
    student_code:$('studentCode').value.trim(),
    prefix:$('studentPrefix').value.trim() || null,
    full_name:$('studentFullName').value.trim(),
    room:$('studentFormRoom').value,
    number:$('studentNumber').value==='' ? null : Number($('studentNumber').value)
  };
  if(!payload.student_code || !payload.full_name || !payload.room) return toast('กรุณากรอก รหัส / ชื่อ / ห้อง ให้ครบ');
  const query=id ? supabase.from('students').update(payload).eq('id',id) : supabase.from('students').insert(payload);
  const {error}=await query;
  if(error) return toast(error.message);
  toast(id?'อัปเดตนักเรียนแล้ว':'เพิ่มนักเรียนแล้ว');
  $('studentRoomSelect').value=payload.room;
  clearStudentForm();
  await Promise.all([loadManagedStudents(), loadStudents()]);
}

async function deleteStudent(id){
  const s=managedStudents.find(x=>x.id===id); if(!s) return;
  if(!confirm(`ยืนยันลบ ${s.full_name}?\nคะแนนของนักเรียนคนนี้จะถูกลบตามไปด้วย`)) return;
  const {error}=await supabase.from('students').delete().eq('id',id);
  if(error) return toast(error.message);
  toast('ลบนักเรียนแล้ว');
  await Promise.all([loadManagedStudents(), loadStudents()]);
}

function getImportRowsFromTextarea(){
  const text=$('studentImportText').value.trim(); if(!text) return [];
  const wb=XLSX.read(text,{type:'string'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws,{defval:''});
}

async function handleStudentFile(e){
  const file=e.target.files?.[0]; if(!file) return;
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(buf,{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
  $('studentImportText').value=rowsToTsv(rows);
  previewImportStudents();
}

function rowsToTsv(rows){
  const headers=['student_code','prefix','full_name','room','number'];
  const lines=[headers.join('\t')];
  rows.forEach(r=>lines.push(headers.map(h=>r[h] ?? r[thaiHeader(h)] ?? '').join('\t')));
  return lines.join('\n');
}
function thaiHeader(h){return {student_code:'รหัสนักเรียน',prefix:'คำนำหน้า',full_name:'ชื่อ-สกุล',room:'ห้อง',number:'เลขที่'}[h]}

function normalizeImportRow(r, fallbackRoom){
  const student_code=String(r.student_code ?? r['รหัสนักเรียน'] ?? r.code ?? r['รหัส'] ?? '').trim();
  const prefix=String(r.prefix ?? r['คำนำหน้า'] ?? '').trim();
  const full_name=String(r.full_name ?? r['ชื่อ-สกุล'] ?? r.name ?? r['ชื่อ'] ?? '').trim();
  const room=String(r.room ?? r['ห้อง'] ?? fallbackRoom ?? '').trim();
  const numberRaw=String(r.number ?? r['เลขที่'] ?? '').trim();
  return {student_code,prefix:prefix||null,full_name,room,number:numberRaw===''?null:Number(numberRaw)};
}

function getImportRows(){
  const fallbackRoom=$('importRoomSelect').value;
  return getImportRowsFromTextarea().map(r=>normalizeImportRow(r,fallbackRoom)).filter(r=>r.student_code || r.full_name);
}

function previewImportStudents(){
  const rows=getImportRows();
  const valid=rows.filter(r=>r.student_code && r.full_name && r.room && (r.number===null || !Number.isNaN(r.number)));
  $('importSummary').innerHTML=`ตรวจพบ <b>${rows.length}</b> แถว | พร้อมนำเข้า <b>${valid.length}</b> แถว`;
  $('importPreview').querySelector('thead').innerHTML='<tr><th>เลขที่</th><th>รหัส</th><th>คำนำหน้า</th><th>ชื่อ-สกุล</th><th>ห้อง</th><th>สถานะ</th></tr>';
  $('importPreview').querySelector('tbody').innerHTML=rows.slice(0,80).map(r=>{
    const ok=r.student_code && r.full_name && r.room && (r.number===null || !Number.isNaN(r.number));
    return `<tr><td>${escapeHtml(r.number??'')}</td><td>${escapeHtml(r.student_code)}</td><td>${escapeHtml(r.prefix??'')}</td><td class="text-left">${escapeHtml(r.full_name)}</td><td>${escapeHtml(r.room)}</td><td>${ok?'พร้อม':'ข้อมูลไม่ครบ'}</td></tr>`
  }).join('') || '<tr><td colspan="6">ยังไม่มีข้อมูลตัวอย่าง</td></tr>';
}

async function importStudents(){
  const rows=getImportRows().filter(r=>r.student_code && r.full_name && r.room && (r.number===null || !Number.isNaN(r.number)));
  if(!rows.length) return toast('ยังไม่มีข้อมูลที่พร้อมนำเข้า');
  const {error}=await supabase.from('students').upsert(rows,{onConflict:'student_code'});
  if(error) return toast(error.message);
  toast(`นำเข้า/อัปเดตนักเรียนแล้ว ${rows.length} คน`);
  $('studentRoomSelect').value=$('importRoomSelect').value;
  await Promise.all([loadManagedStudents(), loadStudents()]);
}

function downloadStudentTemplate(){
  const data=[{student_code:'40201',prefix:'นาย',full_name:'ตัวอย่าง นักเรียน',room:$('importRoomSelect').value||'4/2',number:1}];
  const ws=XLSX.utils.json_to_sheet(data,{header:['student_code','prefix','full_name','room','number']});
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'students');
  XLSX.writeFile(wb,'student_import_template.xlsx');
}

init();
