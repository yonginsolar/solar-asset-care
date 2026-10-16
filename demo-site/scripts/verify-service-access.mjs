// Explicit isolated real-Auth regression; never sends email or changes existing users.
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {randomUUID} from 'node:crypto';import {createClient} from '@supabase/supabase-js';
if(process.env.SOLAR_SERVICE_QA!=='1')throw new Error('SOLAR_SERVICE_QA=1 required');
const ui=process.env.SOLAR_SERVICE_UI_QA==='1';if(ui&&!process.stdin.isTTY)throw new Error('UI fixture needs a retained TTY');
const project='vzgmryqglptxowbdewkf';const url=`https://${project}.supabase.co`;
let keyRows=JSON.parse(execFileSync('npx',['--yes','supabase@2.121.0','projects','api-keys','--project-ref',project,'--reveal','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(!Array.isArray(keyRows))keyRows=keyRows.keys;
const secret=keyRows.find(k=>k.api_key?.startsWith('sb_secret_'))?.api_key;const pub=keyRows.find(k=>k.api_key?.startsWith('sb_publishable_'))?.api_key;
assert.ok(secret&&pub,'modern keys only');const options={auth:{persistSession:false,autoRefreshToken:false}};const admin=createClient(url,secret,options);
const users=[],orgs=[];let checks=0;const cleanup=[];
async function need(req){const r=await req;if(r.error)throw new Error(r.error.message);return r.data;}
function pass(label){checks++;console.log('PASS '+label)}
async function denied(req,pattern,label){const r=await req;assert.ok(r.error,label);assert.match(r.error.message,pattern);pass(label)}
const uiPassword=ui?process.env.SOLAR_SERVICE_UI_PASSWORD:null;if(ui)assert.ok(uiPassword?.length>16);
async function user(role){const email=`portal-${role}-${randomUUID()}@example.invalid`;const password=uiPassword??`Qa-${randomUUID()}!9`;
 const u=(await need(admin.auth.admin.createUser({email,password,email_confirm:true}))).user;
 const actor={id:u.id,email,role,client:createClient(url,pub,options)};users.push(actor);await need(actor.client.auth.signInWithPassword({email,password}));return actor;}
async function org(owner){const r=await need(admin.from('organizations').insert({name:'[가상] 포털·동의 검수',slug:`portal-qa-${randomUUID()}`,is_primary_operator:false}).select().single());orgs.push(r.id);await need(admin.from('organization_members').insert({organization_id:r.id,user_id:owner.id,role:'owner',status:'active'}));return r;}
let failure;
try{
 const owner=await user('owner'),expert=await user('expert'),a=await user('client'),b=await user('client'),foreign=await user('foreign');
 const o=await org(owner);const other=await org(foreign);
 await need(admin.from('organization_members').insert([expert,a,b].map(u=>({organization_id:o.id,user_id:u.id,role:u.role,status:'active'}))));
 const action=(who,name,payload={})=>who.client.rpc('service_admin_action',{p_org:o.id,p_action:name,p_payload:payload});
 const profile=(who,policy=null,accept=false)=>who.client.rpc('complete_service_profile',{p_org:o.id,p_details:{name:'가상 '+who.role,phone:'01012345678',...(who.role==='client'?{kind:'individual'}:{})},p_policy_id:policy,p_accept:accept});
 assert.equal((await need(a.client.rpc('get_service_onboarding',{p_org:o.id}))).ready,false);pass('verified customer still needs profile');
 await denied(a.client.rpc('create_requester_plant',{p_name:'가상 우회',p_address:'가상',p_capacity_kw:10,p_commissioned_on:null}),/기본정보/,'old plant RPC cannot bypass onboarding');
 await need(profile(a));await need(profile(b));
 await denied(action(expert,'settings.read'),/관리자/,'expert cannot inspect private operator draft');
 await denied(action(foreign,'customers.read'),/관리자/,'foreign administrator cannot list customers');
 await denied(action(a,'customers.create',{kind:'individual',name:'가상'}),/관리자/,'customer cannot self-approve shared business access');
 const plant=await need(owner.client.from('plants').insert({organization_id:o.id,name:'[가상] 공동 담당 발전소',capacity_kw:10,address:'검수용 가상 주소'}).select().single());
 const i=await need(owner.client.from('inspections').insert({organization_id:o.id,plant_id:plant.id,inspection_code:'PORTAL-QA',purpose:'가상 포털 화면 검수',assigned_expert_user_id:expert.id,status:'expert_review'}).select().single());
 await need(action(owner,'customers.create',{kind:'corporation',name:'[가상] 고객사업자',business_number:'1234567891',representative:'가상 대표'}));
 const customers=await need(action(owner,'customers.read'));const c=customers.customers[0];
 await need(action(owner,'customers.link_contact',{customer_id:c.id,revision:1,user_id:a.id}));
 await denied(action(owner,'customers.link_contact',{customer_id:c.id,revision:1,user_id:b.id}),/변경/,'stale customer revision rejected');
 await need(action(owner,'customers.link_contact',{customer_id:c.id,revision:2,user_id:b.id}));
 await need(action(owner,'customers.link_plant',{customer_id:c.id,revision:3,plant_id:plant.id}));
 for(const actor of[a,b]){assert.equal((await need(actor.client.from('plants').select('id').eq('id',plant.id))).length,1);pass('separate named login can read approved shared plant');}
 await need(action(owner,'customers.unlink_contact',{customer_id:c.id,revision:4,user_id:b.id}));
 assert.equal((await need(b.client.from('plants').select('id').eq('id',plant.id))).length,0);pass('same existing token loses shared access after unlink');
 assert.equal((await need(a.client.from('plants').select('id').eq('id',plant.id))).length,1);pass('other contact retains access');
 const content={operator_name:'[가상] 격리 검수 운영자',contact_email:'portal@example.invalid',privacy_contact:'가상 검수 담당 portal@example.invalid',terms:'격리 시험 전용 문안입니다. 실제 운영약관이 아니며 실제 고객에게 적용하지 않습니다. '.repeat(3),privacy:'격리 시험 전용 개인정보 문안입니다. 실제 수집·이용 동의문이 아니며 실제 고객에게 적용하지 않습니다. '.repeat(3)};
 await denied(action(owner,'settings.publish',{revision:0,confirm:'APPLY'}),/확정/,'incomplete policy cannot activate');
 await need(action(owner,'settings.save',{revision:0,content}));
 await denied(action(owner,'settings.save',{revision:0,content}),/변경/,'stale settings save cannot overwrite newer draft');
 await need(action(owner,'settings.publish',{revision:1,confirm:'APPLY'}));
 let cfg=await need(action(owner,'settings.read'));const policy=cfg.active_id;
 for(const actor of[owner,expert,a]){assert.equal((await need(actor.client.from('plants').select('id').eq('id',plant.id))).length,0);pass('policy gate blocks existing '+actor.role+' token');}
 await denied(action(owner,'customers.read'),/기본정보/,'definer customer endpoint also enforces current consent');
 await denied(profile(owner,policy,false),/동의/,'unchecked agreement rejected server-side');
 await denied(profile(owner,randomUUID(),true),/변경/,'outdated or forged policy identifier rejected');
 for(const actor of[owner,expert,a])await need(profile(actor,policy,true));
 for(const actor of[owner,expert,a]){assert.equal((await need(actor.client.from('plants').select('id').eq('id',plant.id))).length,1);pass(actor.role+' can resume only after own consent');}
 assert.equal((await need(foreign.client.from('plants').select('id').eq('id',plant.id))).length,0);pass('cross-workspace isolation remains');
 cfg=await need(action(owner,'settings.read'));assert.equal(cfg.members.filter(m=>m.accepted_at).length,3);pass('only explicit current acceptances appear in admin list');
 await need(admin.auth.admin.updateUserById(b.id,{user_metadata:{consent:true,policy_version_id:policy,role:'owner'}}));
 assert.equal((await need(b.client.rpc('get_service_onboarding',{p_org:o.id}))).ready,false);pass('user-editable metadata cannot forge consent or role');
 await need(admin.from('organization_members').update({status:'suspended'}).eq('organization_id',o.id).eq('user_id',b.id));
 await denied(b.client.rpc('register_requester'),/초대|중지|역할/,'suspended customer cannot self-reactivate');
 // A second publication must require new acceptance, while preserving v1.
 await need(action(owner,'settings.save',{revision:cfg.revision,content:{...content,terms:content.terms+' 수정판'}}));
 await need(action(owner,'settings.publish',{revision:cfg.revision+1,confirm:'APPLY'}));
 cfg=await need(action(owner,'settings.read'));const policy2=cfg.active_id;
 assert.notEqual(policy2,policy);assert.equal(cfg.versions.length,2);pass('published versions remain immutable and separately retained');
 await denied(profile(a,policy,true),/변경/,'old acceptance cannot satisfy a newly published version');
 for(const actor of[owner,expert,a])await need(profile(actor,policy2,true));
 assert.equal((await need(a.client.rpc('get_service_onboarding',{p_org:o.id}))).consents.length,2);pass('individual consent history retains both versions');
 if(ui){console.log('UI_FIXTURES '+JSON.stringify({organizationId:o.id,owner:owner.email,expert:expert.email,client:a.email}));console.log('QA_READY: press Enter after browser checks to remove every synthetic fixture.');await new Promise(resolve=>process.stdin.once('data',resolve));}
}catch(e){failure=e;}finally{
 for(const id of orgs){for(const table of['inspections','plants','audit_events']){const r=await admin.from(table).delete().eq('organization_id',id);if(r.error)cleanup.push(table+': '+r.error.message);}const r=await admin.from('organizations').delete().eq('id',id);if(r.error)cleanup.push(r.error.message);}
 for(const u of users){await u.client.auth.signOut({scope:'global'});const r=await admin.auth.admin.deleteUser(u.id);if(r.error)cleanup.push(r.error.message);}
 console.log('CLEANUP '+JSON.stringify({users:users.length,organizations:orgs.length,errors:cleanup}));
}if(cleanup.length)throw new Error('Incomplete cleanup');if(failure)throw failure;console.log('PASS actual Auth/RLS checks: '+checks);
