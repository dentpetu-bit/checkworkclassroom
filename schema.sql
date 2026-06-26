-- Run in Supabase SQL Editor
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  student_code text unique not null,
  prefix text,
  full_name text not null,
  room text not null,
  number int,
  created_at timestamptz default now()
);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  room text not null default '4/2',
  title text not null,
  max_score numeric default 10,
  sort_order int generated always as identity,
  created_at timestamptz default now()
);

create table if not exists scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  assignment_id uuid references assignments(id) on delete cascade,
  score numeric not null check (score >= 0),
  updated_at timestamptz default now(),
  unique(student_id, assignment_id)
);


-- v5: แยกชิ้นงานตามห้อง
alter table assignments add column if not exists room text;
update assignments set room = '4/2' where room is null;
alter table assignments alter column room set default '4/2';
alter table assignments alter column room set not null;

alter table students enable row level security;
alter table assignments enable row level security;
alter table scores enable row level security;

-- Drop existing policies so this file can be run repeatedly
drop policy if exists "students read" on students;
drop policy if exists "students insert" on students;
drop policy if exists "students delete" on students;
drop policy if exists "students update" on students;
drop policy if exists "assignments read" on assignments;
drop policy if exists "assignments insert" on assignments;
drop policy if exists "assignments update" on assignments;
drop policy if exists "assignments delete" on assignments;
drop policy if exists "scores read" on scores;
drop policy if exists "scores insert" on scores;
drop policy if exists "scores update" on scores;
drop policy if exists "scores delete" on scores;

-- สำหรับเว็บครูแบบง่ายบน GitHub Pages: อนุญาต anon key อ่าน/เขียน
-- ถ้าต้องการความปลอดภัยสูง ให้เพิ่ม Supabase Auth แล้วเปลี่ยนนโยบายเป็น authenticated เท่านั้น
create policy "students read" on students for select using (true);
create policy "students insert" on students for insert with check (true);
create policy "students delete" on students for delete using (true);
create policy "students update" on students for update using (true) with check (true);
create policy "assignments read" on assignments for select using (true);
create policy "assignments insert" on assignments for insert with check (true);
create policy "assignments update" on assignments for update using (true) with check (true);
create policy "assignments delete" on assignments for delete using (true);
create policy "scores read" on scores for select using (true);
create policy "scores insert" on scores for insert with check (true);
create policy "scores update" on scores for update using (true) with check (true);
create policy "scores delete" on scores for delete using (true);

insert into assignments(room,title,max_score) values ('4/2','งานที่ 1',10) on conflict do nothing;

-- ตัวอย่างเพิ่มนักเรียน
-- insert into students(student_code,prefix,full_name,room,number) values
-- ('40201','นาย','ตัวอย่าง นักเรียน','4/2',1),
-- ('40202','นางสาว','ทดลอง ระบบ','4/2',2);

