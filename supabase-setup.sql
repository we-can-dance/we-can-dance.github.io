-- ============================================================
-- DANCE LIBRARY — Supabase Setup
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

-- User profiles (auto-created on signup via trigger below)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  role text default 'user' check (role in ('admin', 'superuser', 'user')),
  created_at timestamptz default now()
);

-- Dance classes
create table if not exists classes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  created_at timestamptz default now()
);

-- Songs
create table if not exists songs (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  artist text,
  ragam text,
  talam text,
  writer text,
  dance_style text,
  description text,           -- admin/teacher notes visible to all who have access
  youtube_url text,           -- YouTube performance video link
  audio_path text,            -- path in Supabase storage bucket 'audio'
  pdf_path text,              -- path in Supabase storage bucket 'pdfs'
  uploaded_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- Songs ↔ Classes (a song can belong to multiple classes)
create table if not exists song_classes (
  song_id uuid references songs(id) on delete cascade,
  class_id uuid references classes(id) on delete cascade,
  primary key (song_id, class_id)
);

-- Users ↔ Classes (a user can belong to multiple classes)
create table if not exists class_members (
  user_id uuid references profiles(id) on delete cascade,
  class_id uuid references classes(id) on delete cascade,
  primary key (user_id, class_id)
);

-- Individual song access (share a single song with a specific user)
create table if not exists individual_song_access (
  user_id uuid references profiles(id) on delete cascade,
  song_id uuid references songs(id) on delete cascade,
  primary key (user_id, song_id)
);

-- Private per-user notes per song
create table if not exists user_notes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id) on delete cascade,
  song_id uuid references songs(id) on delete cascade,
  content text,
  updated_at timestamptz default now(),
  unique(user_id, song_id)
);

-- ============================================================
-- TRIGGER: auto-create profile on signup
-- ============================================================

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- HELPER FUNCTION: get current user's role
-- ============================================================

create or replace function get_my_role()
returns text as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles enable row level security;
alter table classes enable row level security;
alter table songs enable row level security;
alter table song_classes enable row level security;
alter table class_members enable row level security;
alter table individual_song_access enable row level security;
alter table user_notes enable row level security;

-- Drop existing policies if re-running
drop policy if exists "profiles_select" on profiles;
drop policy if exists "profiles_update_own" on profiles;
drop policy if exists "profiles_update_admin" on profiles;
drop policy if exists "classes_select" on classes;
drop policy if exists "classes_all_admin" on classes;
drop policy if exists "songs_select" on songs;
drop policy if exists "songs_insert" on songs;
drop policy if exists "songs_update" on songs;
drop policy if exists "songs_delete" on songs;
drop policy if exists "song_classes_select" on song_classes;
drop policy if exists "song_classes_insert" on song_classes;
drop policy if exists "song_classes_delete" on song_classes;
drop policy if exists "class_members_select" on class_members;
drop policy if exists "class_members_all_admin" on class_members;
drop policy if exists "isa_select" on individual_song_access;
drop policy if exists "isa_all_admin" on individual_song_access;
drop policy if exists "user_notes_own" on user_notes;

-- PROFILES
create policy "profiles_select" on profiles
  for select using (auth.role() = 'authenticated');

create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);

create policy "profiles_update_admin" on profiles
  for update using (get_my_role() = 'admin');

-- CLASSES
-- Admins see all; others see only classes they belong to
create policy "classes_select" on classes
  for select using (
    get_my_role() = 'admin'
    or exists (
      select 1 from class_members
      where class_id = classes.id and user_id = auth.uid()
    )
  );

create policy "classes_all_admin" on classes
  for all using (get_my_role() = 'admin');

-- SONGS
-- A user can see a song if:
--   they are admin, OR
--   they are in a class that has the song, OR
--   they have individual access to the song
create policy "songs_select" on songs
  for select using (
    get_my_role() = 'admin'
    or exists (
      select 1 from song_classes sc
      join class_members cm on cm.class_id = sc.class_id
      where sc.song_id = songs.id and cm.user_id = auth.uid()
    )
    or exists (
      select 1 from individual_song_access isa
      where isa.song_id = songs.id and isa.user_id = auth.uid()
    )
  );

create policy "songs_insert" on songs
  for insert with check (get_my_role() in ('admin', 'superuser'));

create policy "songs_update" on songs
  for update using (
    get_my_role() = 'admin'
    or (get_my_role() = 'superuser' and uploaded_by = auth.uid())
  );

create policy "songs_delete" on songs
  for delete using (get_my_role() = 'admin');

-- SONG_CLASSES
create policy "song_classes_select" on song_classes
  for select using (auth.role() = 'authenticated');

create policy "song_classes_insert" on song_classes
  for insert with check (get_my_role() in ('admin', 'superuser'));

create policy "song_classes_delete" on song_classes
  for delete using (get_my_role() = 'admin');

-- CLASS_MEMBERS
create policy "class_members_select" on class_members
  for select using (
    get_my_role() = 'admin' or user_id = auth.uid()
  );

create policy "class_members_all_admin" on class_members
  for all using (get_my_role() = 'admin');

-- INDIVIDUAL_SONG_ACCESS
create policy "isa_select" on individual_song_access
  for select using (
    get_my_role() = 'admin' or user_id = auth.uid()
  );

create policy "isa_all_admin" on individual_song_access
  for all using (get_my_role() = 'admin');

-- USER_NOTES (fully private — users only see/edit their own)
create policy "user_notes_own" on user_notes
  for all using (user_id = auth.uid());

-- ============================================================
-- STORAGE BUCKETS
-- Create these manually in Supabase Dashboard > Storage, OR
-- uncomment the lines below (requires storage extension)
-- ============================================================

-- insert into storage.buckets (id, name, public) values ('audio', 'audio', false) on conflict do nothing;
-- insert into storage.buckets (id, name, public) values ('pdfs', 'pdfs', false) on conflict do nothing;

-- Storage policies: authenticated users can upload and read
-- (access is controlled at the songs table level via RLS above)

-- Run these after creating the buckets:
/*
create policy "audio_upload" on storage.objects
  for insert with check (bucket_id = 'audio' and auth.role() = 'authenticated');

create policy "audio_read" on storage.objects
  for select using (bucket_id = 'audio' and auth.role() = 'authenticated');

create policy "pdfs_upload" on storage.objects
  for insert with check (bucket_id = 'pdfs' and auth.role() = 'authenticated');

create policy "pdfs_read" on storage.objects
  for select using (bucket_id = 'pdfs' and auth.role() = 'authenticated');
*/

-- ============================================================
-- AFTER RUNNING THIS FILE:
-- 1. Go to Supabase Dashboard > Storage > New bucket
--    - Create bucket named: audio  (private)
--    - Create bucket named: pdfs   (private)
-- 2. In each bucket, go to Policies and add:
--    - INSERT: authenticated users
--    - SELECT: authenticated users
-- 3. Go to Authentication > Users and create your first admin user
-- 4. Then run this to make yourself admin (replace the email):
--    UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
-- ============================================================
