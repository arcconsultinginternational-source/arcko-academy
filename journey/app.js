'use strict';
const $=s=>document.querySelector(s),gold=[8,16,24,32,40,48];
let id=null,profile=null,busy=false,requestNumber=0;
const missions=[['Make someone smile','Design something that makes a person’s day better.'],['Give it a second life','Turn an everyday material into something useful.'],['Solve a little problem','Find a small problem and create your own solution.'],['Make it move','Create something with a moving or interactive part.'],['Create for someone else','Listen to another person’s needs and design for them.'],['Your big idea','Combine your favourite skills into a creation that matters.']];
const themes=['Explore a new idea','Look a little closer','Sketch your possibilities','Choose your tools','Make your first version','Test and discover','Improve and share'];
async function lookup(value){
 const cfg=window.ARCKO_CONFIG||{};
 if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)throw Error('The academy connection is not configured yet. Please contact Arcko.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
 const response=await fetch(cfg.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/lookup_student_journey',{method:'POST',headers:{'Content-Type':'application/json',apikey:cfg.SUPABASE_ANON_KEY},body:JSON.stringify({p_student_code:value}),signal:controller.signal,cache:'no-store'});
 if(!response.ok)throw Error('We couldn’t connect to your academy records. Please try again or contact Arcko.');
 const rows=await response.json();if(!Array.isArray(rows)||!rows.length)return null;
 const r=rows[0];if(!['attended','classes_left','coins'].every(k=>Number.isSafeInteger(Number(r[k]))))throw Error('Your record could not be read. Please contact Arcko.');
 return {completed:Math.max(0,Number(r.attended)),classes_left:Number(r.classes_left),coins:Number(r.coins)};
 }finally{clearTimeout(timer)}
}
async function login(value){
 if(busy)return;value=value.trim().toUpperCase();
 if(!/^AR[0-9]{8,16}$/.test(value)){$('#error').textContent='Enter your full student ID, for example AR00121126.';return}
 const request=++requestNumber;busy=true;$('#form button').disabled=true;$('#error').textContent='Finding your journey…';
 try{const result=await lookup(value);if(request!==requestNumber)return;if(!result){$('#error').textContent='We couldn’t find an active student with that ID. Check the ID or ask Arcko.';return}id=value;profile=result;$('#error').textContent='';$('#login').close();render();$('#syncStatus').textContent='Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
 catch(e){if(request===requestNumber)$('#error').textContent=e.name==='AbortError'?'Connection timed out. Please try again.':e.message}
 finally{busy=false;$('#form button').disabled=false}
}
async function refresh(){if(!id||busy)return;busy=true;$('#refresh').disabled=true;const current=id,request=++requestNumber;try{const result=await lookup(current);if(request!==requestNumber)return;if(!result){profile=null;id=null;render();$('#login').showModal();$('#error').textContent='This student ID is no longer active.';return}profile=result;render();$('#syncStatus').textContent='Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}catch{$('#syncStatus').textContent='Could not refresh — showing the last loaded values.'}finally{busy=false;$('#refresh').disabled=false}}
function render(){let p=profile;$('#name').textContent=p?id:'Your adventure starts here';$('#coins').textContent=p?p.coins:'—';$('#remaining').textContent=p?p.classes_left:'—';$('#count').textContent=`${p?p.completed:0} / 52 classes`;$('#level').textContent=p?`Level ${Math.min(7,Math.floor(p.completed/8)+1)} · ${p.completed>=52?'Champion!':'Class '+(Math.min(52,p.completed+1))}`:'Find your journey';$('#bar').style.width=(Math.min(52,p?p.completed:0)/52*100)+'%';const cols=innerWidth<=760?4:8,rows=Math.ceil(52/cols),points=[];for(let n=1;n<=52;n++){let r=Math.floor((n-1)/cols),c=(n-1)%cols;if(r%2)c=cols-1-c;points.push({x:5+c*90/(cols-1),y:95-r*90/(rows-1)})}const route=points.map((q,i)=>`${i?'L':'M'}${q.x},${q.y}`).join(' ');$('#board').innerHTML=`<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${route}" fill="none" stroke="#b5d8a7" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="${route}" fill="none" stroke="#f8fff0" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;points.forEach((q,i)=>{let n=i+1,complete=p&&n<=p.completed,active=p&&n===p.completed+1,b=document.createElement('button');b.className='stone '+(gold.includes(n)?'golden ':'')+(complete?'completed':active?'active':'locked');b.style.left=q.x+'%';b.style.top=q.y+'%';b.setAttribute('aria-label',`Class ${n}${gold.includes(n)?', gold mission':''}, ${complete?'completed':active?'unlocked':'locked'}`);b.innerHTML=n+(gold.includes(n)?'<span class="star">★</span>':'')+(complete?'<span class="tick">✓</span>':active?'<span class="you">YOU ARE HERE</span>':'');b.onclick=()=>show(n);$('#board').appendChild(b)})}

function show(n){if(!profile){$('#login').showModal();return}const complete=n<=profile.completed,locked=n>profile.completed+1,isGold=gold.includes(n),m=isGold?missions[gold.indexOf(n)]:[n===52?'Celebrate your creative journey':themes[(n-1)%8%7],n===52?'Share your proudest creation and how you grew.':'Explore, create and reflect with your teacher.'];
 $('#content').innerHTML=`<small class="eyebrow">CLASS ${n} · ${isGold?'GOLD MISSION':'CREATIVE STEP'}</small><h2>${m[0]}</h2><p>${m[1]}</p><ol class="tasks"><li>Explore the idea with your teacher.</li><li>Make it, test it and improve one thing.</li><li>Share what you created and learned.</li></ol><p class="status">${complete?'✓ Class attended.':locked?'Keep attending classes to reach this step.':'Your next creative step is ready!'}</p><div class="reward">${isGold?'★ Gold mission':'✦ Creative step'}</div><p>Your teacher records attendance and awards coins in Arcko OS. Your coin balance shows those awards; opening a mission does not change it.</p>`;
 $('#detail').showModal();}
$('#form').onsubmit=e=>{e.preventDefault();login($('#studentId').value)};
$('#switch').onclick=()=>{requestNumber++;id=null;profile=null;render();$('#error').textContent='';$('#studentId').value='';$('#syncStatus').textContent='Enter your ID to load your records';$('#login').showModal()};
$('#closeLogin').onclick=()=>$('#login').close();$('#closeDetail').onclick=()=>$('#detail').close();
$('#next').onclick=()=>profile?show(Math.min(52,profile.completed+1)):$('#login').showModal();
$('#missions').onclick=()=>profile?show(gold.find(n=>n>profile.completed)||48):$('#login').showModal();
$('#refresh').onclick=refresh;document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});setInterval(()=>{if(!document.hidden)refresh()},60000);addEventListener('resize',render);render();$('#login').showModal();
