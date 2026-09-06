-- 말점 계모임 장부 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에서 이 파일 전체를 붙여넣고 실행하세요.

-- ============================================================
-- 1. households (회원/가구 명단)
-- ============================================================
create table if not exists households (
  id            text primary key,
  names         text[] not null default '{}',
  family        int not null default 1,
  role          text not null default '일반',
  fee           int not null default 30000,
  prior_arrears text[] not null default '{}',
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- 2. transactions (은행 거래내역)
--    key는 앱에서 생성하는 고유 거래 키(rowsToTransactions/parseWorkbookToTransactions
--    참고)를 그대로 사용 — 같은 거래를 다시 업로드해도 중복 저장되지 않도록 막아줌.
-- ============================================================
create table if not exists transactions (
  key            text primary key,
  date           date not null,
  time           text not null default '',
  month          text not null,
  description    text not null default '',
  name           text not null default '',
  memo           text not null default '',
  withdraw       numeric not null default 0,
  deposit        numeric not null default 0,
  balance        numeric,
  branch         text,
  excluded       boolean not null default false,
  exclude_reason text,
  created_at     timestamptz not null default now()
);

create index if not exists transactions_month_idx on transactions (month);
create index if not exists transactions_name_idx on transactions (name);

-- ============================================================
-- 3. Row Level Security
-- ============================================================
alter table households enable row level security;
alter table transactions enable row level security;

-- 지금은 로그인 기능이 없어서 anon key로 읽고 쓰는 구조입니다.
-- 조회는 나중에 다른 회원들도 로그인 없이 볼 수 있도록 열어두고,
-- 쓰기도 지금은 총무 브라우저가 anon key로 하고 있어서 함께 열어둡니다.
--
-- TODO: 나중에 회원 로그인(Supabase Auth)을 추가하면, 아래 insert/update/delete
-- 정책을 "인증된 사용자(예: 총무 계정)만" 허용하도록 좁혀야 합니다.
-- 예: using (auth.uid() = 'admin-user-uuid') 같은 조건으로 교체.

drop policy if exists "households_select_anon" on households;
create policy "households_select_anon" on households
  for select using (true);

drop policy if exists "households_write_anon" on households;
create policy "households_write_anon" on households
  for all using (true) with check (true);

drop policy if exists "transactions_select_anon" on transactions;
create policy "transactions_select_anon" on transactions
  for select using (true);

drop policy if exists "transactions_write_anon" on transactions;
create policy "transactions_write_anon" on transactions
  for all using (true) with check (true);
