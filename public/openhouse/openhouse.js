(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const th = document.documentElement.lang === 'th';
  const text = (a,b) => th ? a : b;
  const names = ['3D Printing','Interactive Paper-maker','Digital Arts'];
  const form = $('booking-form');
  const config = window.ARCKO_PAYMENT || {};
  let qrReady = false;
  const prices = {single:399,double:798,bundle:1000};
  const selected = s => s.ticket === 'bundle' ? [0,1,2] : s.ticket === 'double' ? s.pair.split(',').map(Number) : [s.subject];
  const key = 'arcko-openhouse-2026-selection';
  const money = n => '฿' + n.toLocaleString('en-US');
  function read() {
    return {date:form.elements.date.value,ticket:form.elements.ticket.value,subject:Number($('subject').value),quantity:Number($('quantity').value),pair:$('pair').value,ages:Array.from(document.querySelectorAll('.child-age')).map(el=>el.value),times:names.map((_,i)=>$('time-'+i).value)};
  }
  function update() {
    const s = read();
    $('subject-wrap').hidden = s.ticket !== 'single';
    $('pair-wrap').hidden = s.ticket !== 'double';
    const existing=s.ages;
    $('ages').replaceChildren();
    for(let i=0;i<s.quantity;i++){
      const label=document.createElement('label');label.htmlFor='age-'+i;label.textContent=text('อายุเด็กคนที่ ','Child ')+(i+1)+text(' (ปี)',' age (years)');
      const select=document.createElement('select');select.id='age-'+i;select.className='child-age';select.required=true;
      const empty=new Option(text('เลือกอายุ','Select age'),'');select.add(empty);
      for(let age=4;age<=10;age++)select.add(new Option(String(age),String(age)));
      select.value=existing[i]||'';$('ages').append(label,select);
    }
    document.querySelectorAll('.time-row').forEach((r,i) => r.hidden = !selected(s).includes(i));
    $('total').textContent = money(prices[s.ticket] * s.quantity);
    $('error').hidden = true;
    try {localStorage.setItem(key,JSON.stringify({at:Date.now(),value:{...s,ages:undefined}}));} catch {}
  }
  function summary() {
    const s = read();
    const date = new Date(s.date+'T12:00:00+07:00').toLocaleDateString(th?'th-TH':'en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Bangkok'});
    return ['ARCKO OPEN HOUSE',date,...names.flatMap((name,i)=>selected(s).includes(i) ? [name+' · '+s.times[i]+'–'+s.times[i].slice(0,2)+':50'] : []),text('จำนวนเด็ก: ','Children: ')+s.quantity,text('อายุเด็ก: ','Child ages: ')+s.ages.join(', '),text('ยอดรวม: ','Total: ')+$('total').textContent].join('\n');
  }
  function setLine() {
    const intro = qrReady ? text('ชำระเงินแล้ว ขอส่งสลิปเพื่อให้ทีมงานตรวจสอบและยืนยันการจอง','I have paid. Please verify my slip and confirm my booking.') : text('ขอ QR ชำระเงินและตรวจสอบรอบกิจกรรม','Please send the payment QR and check availability for these sessions.');
    const message = intro+'\n\n'+summary();
    $('message').value = message;
    $('line').href = 'https://line.me/R/oaMessage/'+encodeURIComponent('@arcko.creative')+'/?'+encodeURIComponent(message);
    $('line-label').textContent = qrReady ? text('ยืนยันผ่าน LINE','Confirm via LINE') : text('แอดไลน์','Add LINE');
    $('slip-note').hidden = !qrReady;
  }
  function openPayment() {
    const s = read();
    if(selected(s).includes(0) && selected(s).includes(2) && s.times[0] === s.times[2]) {
      $('error').textContent = text('รอบ 3D Printing และ Digital Arts ตรงกัน กรุณาเลือกรอบเวลาที่ต่างกัน','3D Printing and Digital Arts overlap. Please choose different times.');
      $('error').hidden = false;
      $('time-2').focus();return;
    }
    $('summary').textContent=summary();$('pay-total').textContent=$('total').textContent;
    setLine();$('selection').hidden=true;$('payment').hidden=false;
    $('step-one').removeAttribute('aria-current');$('step-two').setAttribute('aria-current','step');
    $('payment').focus();$('booking').scrollIntoView({block:'start'});
  }
  form.addEventListener('change',update);
  form.addEventListener('submit',e=>{e.preventDefault();openPayment();});
  $('edit').addEventListener('click',()=>{
    $('payment').hidden=true;$('selection').hidden=false;
    $('step-two').removeAttribute('aria-current');$('step-one').setAttribute('aria-current','step');
    form.elements.date[0].focus();
  });
  $('copy').addEventListener('click',async()=>{
    try {await navigator.clipboard.writeText($('message').value);$('copy-status').textContent=text('คัดลอกแล้ว','Copied.');}
    catch {$('message').focus();$('message').select();$('copy-status').textContent=text('เลือกข้อความแล้ว กรุณาคัดลอก','Text selected. Please copy it.');}
  });
  try {
    const saved=JSON.parse(localStorage.getItem(key));
    if(saved && Date.now()-saved.at<86400000 && saved.value){
      const s=saved.value;
      if(['2026-12-12','2026-12-13'].includes(s.date))form.elements.date.value=s.date;
      if(['single','double','bundle'].includes(s.ticket))form.elements.ticket.value=s.ticket;
      if(['0,1','0,2','1,2'].includes(s.pair))$('pair').value=s.pair;
      if([0,1,2].includes(s.subject))$('subject').value=s.subject;
      if([1,2,3,4].includes(s.quantity))$('quantity').value=s.quantity;
      if(Array.isArray(s.times))s.times.forEach((time,i)=>{const select=$('time-'+i);if(select&&Array.from(select.options).some(o=>o.value===time))select.value=time;});
    }
  } catch {}
  if(config.enabled && config.qrImage && config.recipient) {
    const qr=$('qr');
    qr.onload=()=>{qrReady=true;$('qr-missing').hidden=true;$('qr-ready').hidden=false;setLine();};
    qr.onerror=()=>{qrReady=false;$('qr-missing').hidden=false;$('qr-ready').hidden=true;setLine();};
    $('recipient').textContent=config.recipient;
    $('save-qr').href=config.qrImage;qr.src=config.qrImage;
  }
  update();
})();
