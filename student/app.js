'use strict';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let currentId='',record=null,busy=false,requestNo=0;
const validId=s=>/^AR[0-9]{7,16}$/.test(s);
function normalizeJourney(r){
 if(r===null)return null;
 if(!r||!['attended','classes_left','coins','undated_attended'].every(k=>Number.isSafeInteger(Number(r[k])))||!Array.isArray(r.programmes))throw Error('Your record could not be read. Please contact Arcko.');
 if(!r.programmes.every(p=>typeof p.subject==='string'&&Array.isArray(p.dates)&&p.dates.every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d))))throw Error('Attendance dates could not be read. Please contact Arcko.');
 return {attended:Number(r.attended),classes_left:Number(r.classes_left),coins:Number(r.coins),undated_attended:Number(r.undated_attended),programmes:r.programmes.map(p=>({subject:p.subject,dates:[...p.dates]}))};
}
async function lookup(value){
 const cfg=window.ARCKO_CONFIG||{};if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)throw Error('Academy connection is not configured. Please contact Arcko.');
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),12000);
 try{const res=await fetch(cfg.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/lookup_student_journey_v2',{method:'POST',headers:{apikey:cfg.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_student_code:value}),signal:abort.signal,cache:'no-store'});if(!res.ok)throw Error('Could not load your records. Please try again or contact Arcko.');return normalizeJourney(await res.json())}finally{clearTimeout(timer)}
}
function displayDate(s){return new Date(s+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}
function pointsFor(cols){return Array.from({length:52},(_,i)=>{const row=Math.floor(i/cols),col=row%2?cols-1-i%cols:i%cols;return {x:5+col*90/(cols-1),y:95-row*90/(Math.ceil(52/cols)-1)}})}
function mapHtml(p,index){
 const points=pointsFor(innerWidth<=760?4:8),path=points.map((v,i)=>`${i?'L':'M'}${v.x},${v.y}`).join(' ');
 return `<section class="subject-journey" id="subject-${index}" aria-label="${esc(p.subject)} journey"><div class="mapheading"><div><small class="eyebrow">YOUR SUBJECT JOURNEY</small><h2>${esc(p.subject)}</h2><p>${p.dates.length} ${p.dates.length===1?'class':'classes'} attended</p></div><span class="subject-level">Level ${Math.min(7,Math.floor(p.dates.length/8)+1)}</span></div><div class="map"><div class="cloud c1"></div><div class="cloud c2"></div><div class="mountains"></div><div class="hill h1"></div><div class="hill h2"></div><div class="journey-board"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" fill="none" stroke="#b5d8a7" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="${path}" fill="none" stroke="#f8fff0" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>${points.map((v,i)=>{const n=i+1,complete=i<p.dates.length,active=i===p.dates.length,gold=n%8===0;return `<button type="button" class="stone ${gold?'golden ':''}${complete?'completed':active?'active':'locked'}" style="left:${v.x}%;top:${v.y}%" data-subject="${index}" data-step="${n}" aria-label="${esc(p.subject)}, class ${n}, ${complete?'completed '+displayDate(p.dates[i]):'not attended'}">${n}${gold?'<span class="star">★</span>':''}${complete?'<span class="tick">✓</span>':active?'<span class="you">YOU ARE HERE</span>':''}</button>`}).join('')}</div><div class="start">YOUR JOURNEY STARTS HERE</div></div></section>`;
}
function render(){
 $('#studentLabel').textContent=record?currentId:'Your adventure starts here';$('#coins').textContent=record?record.coins:'—';$('#remaining').textContent=record?record.classes_left:'—';$('#attended').textContent=record?record.attended:'—';
 $('#subjectTabs').innerHTML=record?record.programmes.map((p,i)=>`<a href="#subject-${i}">${esc(p.subject)} <span>${p.dates.length}</span></a>`).join(''):'';
 $('#maps').innerHTML=record?(record.programmes.length?record.programmes.map(mapHtml).join(''):'<div class="empty-state">Your journey will appear after you enrol in a subject.</div>'):'<div class="empty-state">Enter your student ID to see your subject journeys.</div>';
 $('#historyNote').textContent=record?.undated_attended?`${record.undated_attended} earlier attended ${record.undated_attended===1?'class has':'classes have'} no dated lesson record yet. Ask Arcko to complete the history.`:'';
}
function openStep(index,step){
 const p=record?.programmes[index];if(!p)return;const date=p.dates[step-1];$('#detailSubject').textContent=p.subject;$('#detailTitle').textContent=date?'✓ Completed':'Not attended yet';$('#detailDate').textContent=date?displayDate(date):'';$('#detailClass').textContent='Class '+step;$('#detail').showModal();
}
async function loadJourney(value,refresh=false){
 if(busy)return;value=value.trim().toUpperCase();if(!validId(value)){$('#error').textContent='Enter your full student ID, for example AR0011126.';return}
 const req=++requestNo;busy=true;$('#submit').disabled=true;$('#refresh').disabled=true;if(!refresh)$('#error').textContent='Finding your journeys…';
 try{const next=await lookup(value);if(req!==requestNo)return;if(!next){record=null;currentId='';render();if(!$('#login').open)$('#login').showModal();$('#error').textContent='We couldn’t find an active student with that ID. Check the ID or ask Arcko.';return}record=next;currentId=value;$('#error').textContent='';$('#login').close();render();$('#syncStatus').textContent='Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
 catch(e){const msg=e.name==='AbortError'?'Connection timed out. Please try again.':e.message;if(refresh)$('#syncStatus').textContent='Could not refresh — showing last loaded values.';else $('#error').textContent=msg}
 finally{busy=false;$('#submit').disabled=false;$('#refresh').disabled=false}
}
$('#form').onsubmit=e=>{e.preventDefault();loadJourney($('#studentId').value)};
$('#refresh').onclick=()=>currentId&&loadJourney(currentId,true);
$('#switch').onclick=()=>{if(busy)return;requestNo++;record=null;currentId='';render();$('#studentId').value='';$('#error').textContent='';$('#syncStatus').textContent='Enter your ID';$('#login').showModal()};
$('#closeLogin').onclick=()=>$('#login').close();$('#closeDetail').onclick=()=>$('#detail').close();
$('#maps').onclick=e=>{const stone=e.target.closest('button[data-step]');if(stone)openStep(Number(stone.dataset.subject),Number(stone.dataset.step))};
addEventListener('resize',render);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentId)loadJourney(currentId,true)});setInterval(()=>{if(!document.hidden&&currentId)loadJourney(currentId,true)},60000);render();$('#login').showModal();
