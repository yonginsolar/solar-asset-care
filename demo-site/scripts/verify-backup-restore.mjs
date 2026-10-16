// Read-only production snapshot; restores ONLY into a new, Unix-socket-only local cluster.
// No production DDL/DML, Auth changes, email, Storage uploads or retained plaintext backups.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { sealBackup, openBackup } from './backup-archive.mjs';

assert.equal(process.env.SOLAR_BACKUP_RESTORE_CHECK, '1', 'Explicit backup drill opt-in required');
const project = 'vzgmryqglptxowbdewkf';
const pg = process.env.SOLAR_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
const work = mkdtempSync('/tmp/solar-restore-'); chmodSync(work, 0o700);
const source = join(work, 'source'), restored = join(work, 'restored');
mkdirSync(source, {mode: 0o700}); mkdirSync(restored, {mode: 0o700});
const key = randomBytes(32), digest = b => createHash('sha256').update(b).digest('hex');
const qi = s => '"' + s.replaceAll('"', '""') + '"';
const cli = args => execFileSync('npx', ['--yes','supabase@2.121.0',...args], {encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4e6});
let stage = 'configuration', cluster = false, connection, report;
function run(tool, args, env = {}, input) {
  try { return execFileSync(join(pg, tool), args, {env: {...process.env,...env},input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32e6}); }
  catch(e) {
    // Do not emit connection strings, tokens, COPY rows or sensitive SQL from stderr.
    const errors = String(e.stderr || '').split('\n').filter(l => /ERROR:|FATAL:/.test(l)).map(l => l.replace(/"[^"]*"|'[^']*'/g,'[name]')).slice(0,3);
    throw new Error(`${tool} failed during ${stage}${errors.length ? ': '+errors.join(' / ') : ''}`);
  }
}
function remoteSession(env) {
  const child = spawn(join(pg,'psql'), ['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'], {env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
  let pending, out = '', closed = false, diagnostic = '';
  child.stderr.on('data', b => {
    // Keep only a sanitized first error line, never the SQL/COPY context or credentials.
    const line=b.toString().split('\n').find(l=>/ERROR:|FATAL:|psql: error:/.test(l));
    if(line)diagnostic=line.replace(/"[^"]*"|'[^']*'|sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g,'[redacted]');
  });
  child.stdout.on('data', b => {
    out += b.toString();
    if (pending && out.includes(pending.marker)) {
      const p = pending; pending = null; clearTimeout(p.timer);
      const result = out.slice(0,out.indexOf(p.marker)).trim(); out = '';
      p.resolve(result);
    }
  });
  child.on('error', () => { if(pending){clearTimeout(pending.timer);pending.reject(new Error('Snapshot connection failed'));pending=null;} });
  child.on('exit', () => {closed=true;if(pending){clearTimeout(pending.timer);pending.reject(new Error('Snapshot query failed during '+stage+(diagnostic?' — '+diagnostic:'')));pending=null;} });
  return {
    query(sql) {
      assert.ok(!pending && !closed);
      return new Promise((resolve,reject) => {
        const marker='END_'+randomUUID().replaceAll('-','');
        pending={marker,resolve,reject,timer:setTimeout(()=>{child.kill();},60000)};
        child.stdin.write(sql+'\n\\echo '+marker+'\n');
      });
    },
    close(){child.stdin.end('ROLLBACK;\n\\q\n');},
    kill(){child.kill();},
  };
}
const localEnv = {PGHOST:work,PGPORT:'55440',PGUSER:'solar_restore',PGDATABASE:'solar_restore_check',PGPASSWORD:'',PGSSLMODE:'disable',PGOPTIONS:'-c timezone=UTC'};
const local = sql => run('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],localEnv,sql).trim();
const securitySql = `select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,'permissions',
  (select jsonb_agg(jsonb_build_object('role',r,'privilege',p,'allowed',has_table_privilege(r,c.oid,p)) order by r,p)
   from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p))
  order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and c.relkind='r';`;
const policySql = "select coalesce(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname),'[]') from pg_policies p where schemaname in ('public','private','storage');";
try {
  const dry = cli(['db','dump','--project-ref',project,'--schema','public,private,auth,storage,supabase_migrations','--dry-run']);
  const remote = {};
  for(const line of dry.split('\n')) {
    const m=line.match(/^export (PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)="([^"]*)"$/);
    if(m)remote[m[1]]=m[2];
  }
  assert.equal(Object.keys(remote).length,5,'Normal CLI must provide its short-lived connection');
  assert.ok(remote.PGUSER.includes(project));
  assert.match(remote.PGHOST,/\.pooler\.supabase\.com$|^db\.vzgmryqglptxowbdewkf\.supabase\.co$/);
  // This public CA link is provided by this project's normal Database > Settings UI.
  // Keep verification enabled; do not trust a certificate obtained from the failing DB socket.
  const ca=await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt',{redirect:'error',signal:AbortSignal.timeout(15000)});
  assert.equal(ca.status,200);const pem=await ca.text();assert.match(pem,/^-----BEGIN CERTIFICATE-----/);
  const caPath=join(work,'supabase-ca.crt');writeFileSync(caPath,pem,{mode:0o600});
  remote.PGSSLMODE='verify-full'; remote.PGSSLROOTCERT=caPath; remote.PGCONNECT_TIMEOUT='15';
  remote.PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000';
  connection=remoteSession(remote);
  stage='consistent read-only snapshot';
  // Same existing database role as the official CLI's pg_dump --role postgres.
  const snapshot=await connection.query("SET ROLE postgres; SET timezone='UTC'; BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();");
  assert.match(snapshot,/^[A-Fa-f0-9-]+$/);
  const tables=JSON.parse(await connection.query("select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname) order by n.nspname,c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth','storage','supabase_migrations') and c.relkind='r';"));
  const fingerprints=[];
  for(const t of tables) {
    const sql=`select jsonb_build_object('rows',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))) from ${qi(t.schema)}.${qi(t.table)} t;`;
    fingerprints.push({...t,sql,...JSON.parse(await connection.query(sql))});
  }
  const roles=JSON.parse(await connection.query("select jsonb_agg(rolname) from pg_roles where rolname !~ '^pg_';"));
  const permissions=JSON.parse(await connection.query(securitySql));
  const policies=JSON.parse(await connection.query(policySql));
  const objects=JSON.parse(await connection.query("select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name,'bytes',(metadata->>'size')::bigint) order by bucket_id,name),'[]') from storage.objects;"));
  const refs=JSON.parse(await connection.query("select coalesce(jsonb_agg(r),'[]') from (select storage_bucket bucket,storage_path path,sha256 hash from public.inspection_files union all select 'report-images',storage_path,sha256 from public.report_images union all select 'reports',storage_path,pdf_sha256 from public.report_documents union all select 'recycling-certificates',storage_path,sha256 from public.recycling_certificates) r;"));
  const bytes=objects.reduce((s,o)=>s+Number(o.bytes||0),0);
  assert.ok(objects.length<=1000 && bytes<=250e6,'Review the volume before expanding a backup drill');
  stage='remote logical backup';
  const dump=join(source,'database.dump');
  run('pg_dump',['--format=custom','--role=postgres','--snapshot='+snapshot,...['public','private','auth','storage','supabase_migrations'].map(s=>'--schema='+s),'--file='+dump],remote);
  chmodSync(dump,0o600);
  stage='private Storage read-only backup';
  const keys=JSON.parse(cli(['projects','api-keys','--project-ref',project,'--reveal','--output','json']));
  const secret=(Array.isArray(keys)?keys:keys.keys).find(k=>k.api_key?.startsWith('sb_secret_'))?.api_key;
  assert.ok(secret);
  const api=createClient(`https://${project}.supabase.co`,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const saved=[];
  for(const [index,o] of objects.entries()) {
    const r=await api.storage.from(o.bucket).download(o.path);assert.ifError(r.error);
    const data=Buffer.from(await r.data.arrayBuffer());assert.equal(data.length,Number(o.bytes));
    const sha=digest(data), ref=refs.filter(r=>r.bucket===o.bucket&&r.path===o.path&&r.hash);
    for(const r of ref)assert.equal(sha,r.hash,'Source file checksum mismatch');
    const file=`object-${index}.bin`;writeFileSync(join(source,file),data,{mode:0o600});saved.push({...o,file,sha});
  }
  for(const ref of refs) assert.ok(objects.some(o=>o.bucket===ref.bucket&&o.path===ref.path),'Registered attachment is missing from Storage');
  // This key and all plaintext are deliberately destroyed after the drill.
  stage='encrypted archive round trip';
  writeFileSync(join(source,'manifest.json'),JSON.stringify({project,snapshot,tables:fingerprints.map(({sql,...f})=>f),objects:saved}),{mode:0o600});
  run('pg_restore',['--list',dump]);
  const archive=execFileSync('/usr/bin/tar',['-cf','-','-C',source,'.'],{maxBuffer:300e6,stdio:['ignore','pipe','pipe']});
  const encrypted=sealBackup(archive,key);const opened=openBackup(encrypted,key);assert.equal(digest(opened),digest(archive));
  const damaged=Buffer.from(encrypted);damaged[damaged.length-1]^=1;assert.throws(()=>openBackup(damaged,key));
  assert.throws(()=>openBackup(encrypted,randomBytes(32)));
  execFileSync('/usr/bin/tar',['-xf','-','-C',restored],{input:opened,stdio:['pipe','pipe','pipe']});
  assert.equal(digest(readFileSync(join(restored,'database.dump'))),digest(readFileSync(dump)));
  for(const o of saved)assert.equal(digest(readFileSync(join(restored,o.file))),o.sha);
  stage='isolated local database restore';
  const data=join(work,'pgdata');run('initdb',['-D',data,'-U','solar_restore','-A','trust','--no-locale','--encoding=UTF8']);
  run('pg_ctl',['-D',data,'-l',join(work,'postgres.log'),'-o',`-h '' -k '${work}' -p 55440`,'-w','start']);cluster=true;
  run('createdb',['solar_restore_check'],{...localEnv,PGDATABASE:'postgres'});
  for(const role of roles)if(role!=='solar_restore')local(`create role ${qi(role)} nologin;`);
  local("create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions; drop schema public;");
  run('pg_restore',['--dbname=solar_restore_check','--no-owner','--exit-on-error',join(restored,'database.dump')],localEnv);
  stage='restored row and permission verification';
  for(const f of fingerprints){const result=JSON.parse(local(f.sql));assert.equal(result.rows,f.rows,'Restored row count mismatch');assert.equal(result.hash,f.hash,'Restored row digest mismatch');}
  assert.deepEqual(JSON.parse(local(securitySql)),permissions,'Restored privileges and RLS differ from source');
  assert.deepEqual(JSON.parse(local(policySql)),policies,'Restored row policies differ from source');
  const rls=JSON.parse(local("select jsonb_build_object('tables',count(*),'protected',count(*) filter(where relrowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';"));
  assert.equal(rls.tables,rls.protected,'Every exposed business table retains RLS');
  for(const p of permissions.filter(p=>p.schema==='private'&&!p.rls))assert.ok(p.permissions.filter(g=>g.role!=='service_role').every(g=>!g.allowed),'Internal non-RLS token tables must have no direct client grants');
  const anonGrant=local("select has_table_privilege('anon','public.plants','select');");
  if(anonGrant==='t')assert.equal(local("set role anon; select count(*) from public.plants;"),'0');
  else assert.equal(anonGrant,'f');
  const linkCounts=JSON.parse(local("select jsonb_build_object('users',(select count(*) from auth.users),'members',(select count(*) from public.organization_members),'plants',(select count(*) from public.plants),'inspections',(select count(*) from public.inspections),'reports',(select count(*) from public.reports),'super_admins',(select count(*) from private.organization_super_admins));"));
  report={project,checkedAt:new Date().toISOString(),tables:fingerprints.length,rows:fingerprints.reduce((n,f)=>n+Number(f.rows),0),storageObjects:saved.length,storageBytes:bytes,registeredFiles:refs.length,counts:linkCounts,encryptedRoundTrip:true,tamperAndWrongKeyRejected:true,localOnlyRestore:true,publicRlsTables:rls.tables,policies:policies.length,tablePrivilegesMatch:true,productionWrites:false,retainedBackup:false,limits:['No live Auth service login or real SMTP delivery was tested on the local PostgreSQL restore.','Storage bytes were restored to a local directory, not uploaded to another Supabase project.','Managed cron/vault/extensions outside selected schemas, root keys, SMTP secrets and hosting secrets are not part of this dump.','This is a recovery drill; no durable backup/key custody or schedule was configured.']};
} catch(e) {console.error('FAIL backup drill: '+stage+' — '+e.message);process.exitCode=1;}
finally {
  connection?.close();
  if(cluster)run('pg_ctl',['-D',join(work,'pgdata'),'-m','fast','-w','stop']);
  key.fill(0);
  assert.match(basename(work),/^solar-restore-[a-zA-Z0-9]+$/);
  rmSync(work,{recursive:true,force:true});
  console.log('CLEANED only the new isolated restore cluster and temporary snapshots; production unchanged.');
}
if(report)console.log(JSON.stringify(report,null,2));
