let classGroupFilter='Active';
const groupDays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function groupDefaultEnd(t){const [h,m]=t.slice(0,5).split(':').map(Number),n=(h*60+m+90)%1440;return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')}
function groupClock(t){if(!t)return '';const [h,m]=t.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`}
function classGroupsPage(){
 if(db.classGroupsError)return classesTabs()+head('Classes','Fixed weekly classes, connected to your calendar.')+'<div class="card pad"><p>Could not load class groups. Check that the class-group SQL migration has been run.</p>'+btn('Retry',"loadAll().then(render).catch(()=>toast('Could not reload groups'))",'')+'</div>';
 const all=db.classGroups||[],list=all.filter(g=>(classGroupFilter==='All'||g.active===(classGroupFilter==='Active'))&&JSON.stringify({...g,teacher:teacherName(g.teacher_id)}).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>((a.weekday+6)%7)-((b.weekday+6)%7)||a.start_time.localeCompare(b.start_time));
 return classesTabs()+head('Classes','Your regular classes, organised by subject, day and time.',btn('+ Create group','classGroupForm()'))+
 `<div class="pill" style="margin-bottom:16px">${['Active','Archived','All'].map(x=>btn(x,`classGroupFilter='${x}';render()`,classGroupFilter===x?'active':'')).join('')}</div>`+filter('Search group, subject or teacher…')+
 (list.length?`<div class="class-group-grid">${list.map(g=>`<article class="card pad class-group-card"><div class="cardhead"><span class="badge ${g.active?'blue':''}">${esc(g.subject)}</span>${badge(g.active?'Active':'Archived')}</div><h2>${esc(g.name)}</h2><p class="class-group-time">${groupClock(g.start_time)} – ${groupClock(g.end_time)}</p><p class="sub">Every ${groupDays[g.weekday]}</p><dl class="class-group-meta"><div><dt>Teacher</dt><dd>${esc(teacherName(g.teacher_id))}</dd></div><div><dt>Venue</dt><dd>${esc(g.room||'Not set')}</dd></div><div><dt>Students</dt><dd>${g.student_ids.length} / 8</dd></div></dl><div class="class-group-names">${g.student_ids.slice(0,4).map(id=>`<span>${esc(student(id).name)}</span>`).join('')}${g.student_ids.length>4?`<span>+${g.student_ids.length-4} more</span>`:''}</div><div class="class-group-actions">${btn('View group',`classGroupDetail('${g.id}')`,'')}${btn('Edit',`classGroupForm('${g.id}')`,'')}${g.active?btn('Schedule lessons',`classGroupSchedule('${g.id}')`):''}</div></article>`).join('')}</div>`:'<div class="card empty"><h2>No class groups yet</h2><p>Create a weekly group such as “Saturday 3D Printing” with a fixed time and student roster.</p></div>');
}
function classGroupForm(id){
 const g=(db.classGroups||[]).find(x=>x.id===id)||{};let submitting=false;
 const selected=g.student_ids||[];const students=db.students.filter(s=>s.status==='Active'&&(s.sessions>0||selected.includes(s.id))).sort((a,b)=>a.name.localeCompare(b.name));
 modal(id?'Edit class group':'Create a class group','Set the weekly time, subject and students. Saving a group does not charge a family or add sessions.',`<div class="formgrid">${field('Group name','name',g.name||'')}${sel('Subject','subject',subjects,g.subject||subjects[0])}${sel('Every week on','weekday',groupDays.map((name,i)=>({id:i,name})),g.weekday??6)}${field('Start time','start_time',(g.start_time||'09:00').slice(0,5),'time')}${field('End time','end_time',(g.end_time||'10:30').slice(0,5),'time')}${sel('Teacher','teacher_id',teacherOptions(),g.teacher_id||'')}${field('Venue','room',g.room||'','text',false)}${sel('Status','active',[{id:'true',name:'Active'},{id:'false',name:'Archived'}],String(g.active??true))}<div class="field full"><b>Group students · maximum 8</b><p class="sub">Choose students enrolled for this subject. New members need sessions remaining.</p><div class="class-group-student-picker">${students.map(s=>`<label class="checkrow"><input type="checkbox" name="member_${s.id}" ${selected.includes(s.id)?'checked':''}><span>${esc(s.name)}<small>${esc(s.subject)} · ${s.sessions} classes left</small></span></label>`).join('')||'<p>No active students with sessions yet. Confirm payment and enrol students first.</p>'}</div></div></div><p class="note">Changes apply when scheduling new lessons. Existing calendar lessons keep their saved time and roster; edit those lessons separately.</p><p id="class-group-error" role="alert" class="class-group-error"></p>`,async v=>{
  if(submitting)return;const errorEl=$('#class-group-error');errorEl.textContent='';
  try{const ids=students.filter(s=>v['member_'+s.id]).map(s=>s.id);validateClassGroup(v,ids);submitting=true;$('#modalform button[type=submit]').disabled=true;await syncChain;if(pending||syncFailed)throw Error('Wait for other changes to save, then try again.');
   const {error}=await sb.rpc('save_class_group',{p_group_id:id||null,p_branch_id:activeBranch,p_name:v.name.trim(),p_subject:v.subject,p_weekday:Number(v.weekday),p_start_time:v.start_time,p_end_time:v.end_time,p_teacher_id:v.teacher_id||null,p_room:v.room||'',p_active:v.active==='true',p_student_ids:ids});if(error)throw Error(error.message);
   try{await loadAll()}catch{closeModal();toast('Group saved. Reload to see the latest roster.');return}closeModal();render();toast('Class group saved');
  }catch(e){errorEl.textContent=e.message}finally{submitting=false;const b=$('#modalform button[type=submit]');if(b)b.disabled=false}
 });
}
function validateClassGroup(v,ids){if(!v.name.trim())throw Error('Enter a group name.');if(!v.subject)throw Error('Choose a subject.');if(!v.start_time||!v.end_time||v.end_time<=v.start_time)throw Error('End time must be after start time.');if(ids.length>8)throw Error('Choose no more than 8 students.');if(!Number.isInteger(Number(v.weekday))||Number(v.weekday)<0||Number(v.weekday)>6)throw Error('Choose a weekday.')}
function classGroupDetail(id){
 const g=(db.classGroups||[]).find(x=>x.id===id);if(!g)return;const upcoming=db.lessons.filter(l=>l.class_group_id===id&&l.date>=todayStr()).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
 $('#modal').innerHTML=`<button class="close" onclick="closeModal()" aria-label="Close">×</button><div class="eyebrow">${esc(g.subject)}</div><h2>${esc(g.name)}</h2><p class="class-group-time">${groupClock(g.start_time)} – ${groupClock(g.end_time)}</p><p class="sub">Every ${groupDays[g.weekday]} · ${esc(teacherName(g.teacher_id))}<br>${esc(g.room||'Venue not set')}</p><h3 style="margin-top:24px">Group roster · ${g.student_ids.length}/8</h3>${g.student_ids.map(sid=>{const s=student(sid);return `<div class="todo"><div><strong>${esc(s.name)}</strong><small>${esc(s.studentCode||'')} · ${s.sessions} classes left</small></div></div>`}).join('')||'<p>No students added yet.</p>'}<h3 style="margin-top:24px">Scheduled lessons</h3>${upcoming.slice(0,12).map(l=>`<button class="todo" style="width:100%;text-align:left" onclick="closeModal();lessonDetail(${l.id})"><span>${esc(l.date)} · ${groupClock(l.time)}${l.end_time?' – '+groupClock(l.end_time):''}</span><small>Open attendance →</small></button>`).join('')||'<p>No upcoming lessons. Use Schedule lessons to add this group to the calendar.</p>'}<div class="formfoot">${btn('Edit group',`closeModal();classGroupForm('${id}')`,'')}${g.active?btn('Schedule lessons',`closeModal();classGroupSchedule('${id}')`):''}</div>`;$('#modal').showModal();
}
function classGroupSchedule(id){const g=(db.classGroups||[]).find(x=>x.id===id);if(!g)return;let submitting=false;
 modal('Schedule group lessons',`${esc(g.name)} · Every ${groupDays[g.weekday]} · ${groupClock(g.start_time)} – ${groupClock(g.end_time)}`,`<div class="formgrid">${field('Starting on or after','from',todayStr(),'date')}<label class="field">Number of weeks<input name="weeks" type="number" value="4" min="1" max="52" required></label></div><p class="note">Adds the next weekly dates with this group’s current roster. Existing group dates are left unchanged, holidays are skipped, and scheduling does not deduct sessions.</p><p id="class-group-error" role="alert" class="class-group-error"></p>`,async v=>{if(submitting)return;const e=$('#class-group-error');e.textContent='';try{const weeks=Number(v.weeks);if(!Number.isInteger(weeks)||weeks<1||weeks>52||!v.from||v.from<todayStr())throw Error('Choose today or a future date and 1–52 weeks.');submitting=true;$('#modalform button[type=submit]').disabled=true;await syncChain;if(pending||syncFailed)throw Error('Wait for other changes to save first.');const {data,error}=await sb.rpc('schedule_class_group',{p_group_id:id,p_from:v.from,p_weeks:weeks});if(error)throw Error(error.message);try{await loadAll()}catch{closeModal();toast('Lessons saved. Reload to see the calendar.');return}closeModal();render();toast(`${data.created} lessons added · ${data.holidays_skipped} holidays skipped · ${data.already_scheduled} already scheduled`)}catch(err){e.textContent=err.message}finally{submitting=false;const b=$('#modalform button[type=submit]');if(b)b.disabled=false}});
 $('#modalform button[type=submit]').textContent='Add weekly lessons';
}

function classesTabs(){
 return '<div class="pill" style="margin-bottom:20px">'
 +btn('Groups',"go('Class groups')",page==='Class groups'?'active':'')
 +btn('Sessions',"go('Lessons')",page==='Lessons'?'active':'')
 +'</div>';
}
const originalClassesSidebar=sidebar;
sidebar=function(){
 originalClassesSidebar();
 document.querySelectorAll('#sidebar button').forEach(b=>{
  if(b.textContent.trim()==='Class groups'){
   for(const node of b.childNodes){
    if(node.nodeType===3)node.textContent=node.textContent.replace('Class groups','Classes');
   }
   b.querySelectorAll('span').forEach(s=>{
    if(s.textContent.trim()==='Class groups')s.textContent='Classes';
   });
  }
 });
};
