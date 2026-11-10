const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
Deno.serve(async req => {
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const admin={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
 try {
  const auth=await fetch(url+'/auth/v1/user',{headers:{apikey:key,Authorization:req.headers.get('Authorization')||''}});
  if(!auth.ok)return reply({error:'Sign in required'},401);
  const user=await auth.json();
  const pr=await fetch(url+'/rest/v1/profiles?id=eq.'+encodeURIComponent(user.id)+'&select=role',{headers:admin});
  const profiles=await pr.json();
  if(!pr.ok||profiles[0]?.role!=='owner')return reply({error:'Owner access required'},403);
  const {name,email,password,branch_id}=await req.json();
  if(typeof name!=='string'||!name.trim()||typeof email!=='string'||!email.includes('@')||typeof password!=='string'||password.length<12||!Number.isSafeInteger(branch_id))return reply({error:'Enter a name, valid email, branch and password of at least 12 characters'},400);
  const br=await fetch(url+'/rest/v1/branches?id=eq.'+branch_id+'&select=id',{headers:admin});
  if(!br.ok||!(await br.json()).length)return reply({error:'Unknown branch'},400);
  const created=await fetch(url+'/auth/v1/admin/users',{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{full_name:name.trim()}})});
  const account=await created.json();
  if(!created.ok)return reply({error:'Account could not be created; the email may already be in use'},400);
  const profile=await fetch(url+'/rest/v1/profiles?on_conflict=id',{method:'POST',headers:{...admin,Prefer:'resolution=merge-duplicates'},body:JSON.stringify({id:account.id,full_name:name.trim(),role:'teacher',branch_id})});
  if(!profile.ok){await fetch(url+'/auth/v1/admin/users/'+account.id,{method:'DELETE',headers:admin});return reply({error:'Teacher profile could not be saved. Check the database schema.'},500)}
  return reply({id:account.id});
 }catch{return reply({error:'Could not create teacher'},500)}
});
