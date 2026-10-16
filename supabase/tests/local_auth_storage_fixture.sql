-- Local-only Auth/Storage shape. Real Auth behavior is tested separately.
create schema auth;
create schema storage;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb default '{}',
 email_confirmed_at timestamptz,encrypted_password text,invited_at timestamptz,deleted_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage,extensions to authenticated,anon,service_role;
grant all on storage.objects,storage.buckets to authenticated,service_role;
