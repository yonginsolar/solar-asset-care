// Uses only local Postgres and synthetic data. No production connections or mail.
import {execFileSync} from 'node:child_process';import {readFileSync,readdirSync,mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {randomUUID} from 'node:crypto';
if(process.env.SOLAR_LOCAL_QA!=='1')throw new Error('Explicit SOLAR_LOCAL_QA=1 required');
const pg='/opt/homebrew/opt/postgresql@17/bin/';const root=resolve(import.meta.dirname,'../..');
const conn=['-h','/tmp','-p',process.env.SOLAR_LOCAL_PG_PORT||'55439','-U',process.env.SOLAR_LOCAL_PG_USER||'solar_test'];
const name='solar_service_qa_'+randomUUID().replaceAll('-','').slice(0,12);const restored=name+'_restored';const created=[];
const artifact=mkdtempSync(join(tmpdir(),'solar-service-restore-'));const dump=join(artifact,'synthetic.dump');
function run(tool,args,input){try{return execFileSync(pg+tool,[...conn,...args],{input,encoding:'utf8',maxBuffer:8e6,stdio:['pipe','pipe','pipe']});}catch(e){throw new Error(e.stderr?.toString()||e.message);}}
function sql(db,input){return run('psql',['-d',db,'-v','ON_ERROR_STOP=1','-X'],input);}
try{
 run('createdb',[name]);created.push(name);
 sql(name,readFileSync(resolve(root,'supabase/tests/local_auth_storage_fixture.sql'),'utf8'));
 for(const file of readdirSync(resolve(root,'supabase/migrations')).sort()){
  if(file.includes('keepalive'))continue;
  sql(name,readFileSync(resolve(root,'supabase/migrations',file),'utf8'));
 }
 console.log('PASS full migration history restored on isolated local Postgres');
 const result=run('psql',['-d',name,'-v','ON_ERROR_STOP=1','-X','-f',resolve(root,'supabase/tests/service_access.sql')]);
 console.log('PASS synthetic profile / consent / customer contact / tenant / stale-version tests');
 run('pg_dump',['-d',name,'-Fc','--file',dump]);run('createdb',[restored]);created.push(restored);run('pg_restore',['-d',restored,'--no-owner',dump]);
 const check="select public.qa_assert((select count(*)=5 from auth.users),'restored synthetic Auth rows');select public.qa_assert((select count(*)=2 from private.service_consents),'restored consent history');select public.qa_assert((select count(*)=1 from private.customer_accounts),'restored customer');select public.qa_assert((select count(*)=1 from private.customer_plants),'restored plant link');";
 sql(restored,check);console.log('PASS synthetic full-schema/data backup and isolated restore');console.log('Synthetic backup artifact:',dump);
}finally{for(const db of created.reverse()){if(!/^solar_service_qa_[a-f0-9]{12}(_restored)?$/.test(db))throw new Error('Invalid cleanup target');run('dropdb',[db]);}console.log('CLEANED isolated QA databases; no production data changed');}
