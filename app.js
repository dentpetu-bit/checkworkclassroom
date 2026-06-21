const cfg = window.APP_CONFIG || {};
const supabase = window.supabase?.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
let assignments = [], students = [], scanState = 'student', selectedStudent = null, html5QrCode = null, lastText = '', lastAt = 0;
const $ = id => document.getElementById(id);
function toast(msg){const el=document.createElement('div');el.className='toast';el.textContent=msg;$('toast').appendChild(el);setTimeout(()=>el.remove(),3000)}
function setStatus(msg, ok=true){$('connectionStatus').textContent=msg;$('connectionStatus').style.color=ok?'#9fffe7':'#fecaca'}
function fillSelect(el, items, getVal=x=>x, getText=x=>x){el.innerHTML='';items.forEach(i=>{const o=document.createElement('option');o.value=getVal(i);o.textContent=getText(i);el.appendChild(o)})}
async function init(){
  if(!supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR_PROJECT')){setStatus('ยังไม่ได้ตั้งค่า config.js',false);toast('กรุณาสร้าง config.js จาก config.example.js');return}
  fillSelect($('roomSelect'), cfg.ROOMS||[]); fillSelect($('reportRoomSelect'), cfg.ROOMS||[]);
  await Promise.all([loadAssignments(), loadStudents()]); setStatus('เชื่อมต่อ Supabase แล้ว'); bindEvents();
}
function bindEvents(){
  document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav,.page').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.page).classList.add('active')});
  $('roomSelect').onchange=loadStudents; $('startScanBtn').onclick=startScan; $('stopScanBtn').onclick=stopScan; $('manualSaveBtn').onclick=manualSave; $('addAssignmentBtn').onclick=addAssignment; $('loadReportBtn').onclick=loadReport; $('exportExcelBtn').onclick=exportExcel; $('exportImageBtn').onclick=exportImage;
}
async function loadAssignments(){
  const {data,error}=await supabase.from('assignments').select('*').order('sort_order',{ascending:true}); if(error){toast(error.message);return}
  assignments=data||[]; fillSelect($('assignmentSelect'),assignments,a=>a.id,a=>`${a.sort_order}. ${a.title} (${a.max_score} คะแนน)`); renderAssignmentList();
}
async function loadStudents(){
  const room=$('roomSelect').value || (cfg.ROOMS||[])[0]; if(!room) return;
  const {data,error}=await supabase.from('students').select('*').eq('room',room).order('number',{ascending:true}); if(error){toast(error.message);return}
  students=data||[];
}
function renderAssignmentList(){
  $('assignmentList').innerHTML=assignments.map(a=>`<div class="list-item"><b>${a.sort_order}. ${a.title}</b><span>${a.max_score} คะแนน</span></div>`).join('') || '<p class="hint">ยังไม่มีชิ้นงาน</p>';
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
  selectedStudent=stu; $('currentStudent').innerHTML=`<div class="student-name">${stu.prefix||''}${stu.full_name}</div><div class="student-meta">ห้อง ${stu.room} เลขที่ ${stu.number||'-'} | รหัส ${stu.student_code}</div>`;
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
  $('lastSaved').innerHTML=`บันทึกแล้ว: <b>${stu.full_name}</b> | ${ass?.title||''} = <b>${score}</b>`; toast('บันทึกคะแนนอัตโนมัติแล้ว');
}
async function manualSave(){ const code=$('manualCode').value.trim(); const score=Number($('manualScore').value); if(!code||Number.isNaN(score)) return toast('กรอกข้อมูล Manual ให้ครบ'); await saveScore(code,score); }
async function loadReport(){
  const room=$('reportRoomSelect').value; const {data:stu,error:e1}=await supabase.from('students').select('*').eq('room',room).order('number',{ascending:true}); if(e1) return toast(e1.message);
  const ids=(stu||[]).map(s=>s.id); let scoreRows=[]; if(ids.length){const {data,error}=await supabase.from('scores').select('student_id,assignment_id,score').in('student_id',ids); if(error) return toast(error.message); scoreRows=data||[]}
  const scoreMap={}; scoreRows.forEach(r=>scoreMap[`${r.student_id}_${r.assignment_id}`]=r.score);
  const thead='<tr><th>เลขที่</th><th>รหัส</th><th>ชื่อ-สกุล</th>'+assignments.map(a=>`<th>${a.sort_order}. ${a.title}</th>`).join('')+'<th>รวม</th></tr>';
  const tbody=(stu||[]).map(s=>{let total=0; const tds=assignments.map(a=>{const v=scoreMap[`${s.id}_${a.id}`]; if(v!==undefined) total+=Number(v); return `<td>${v??''}</td>`}).join(''); return `<tr><td>${s.number||''}</td><td>${s.student_code}</td><td>${s.prefix||''}${s.full_name}</td>${tds}<td><b>${total}</b></td></tr>`}).join('');
  $('reportTable').querySelector('thead').innerHTML=thead; $('reportTable').querySelector('tbody').innerHTML=tbody; toast('โหลดรายงานแล้ว');
}
function exportExcel(){ const wb=XLSX.utils.table_to_book($('reportTable'),{sheet:'Report'}); XLSX.writeFile(wb,`รายงานคะแนน_${$('reportRoomSelect').value}.xlsx`); }
async function exportImage(){ const canvas=await html2canvas($('reportCapture'),{backgroundColor:'#ffffff',scale:2}); const a=document.createElement('a'); a.href=canvas.toDataURL('image/png'); a.download=`รายงานคะแนน_${$('reportRoomSelect').value}.png`; a.click(); }
init();
