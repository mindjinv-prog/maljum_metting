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
  loan_household_id text references households(id),
  created_at     timestamptz not null default now()
);

-- 기존에 만들어진 transactions 테이블에는 create table if not exists가 컬럼을
-- 추가해주지 않으므로, 이미 테이블이 있어도 안전하게 재실행 가능하도록 별도 추가.
alter table transactions add column if not exists loan_household_id text references households(id);

create index if not exists transactions_month_idx on transactions (month);
create index if not exists transactions_name_idx on transactions (name);

-- ============================================================
-- 3. Row Level Security
-- ============================================================
alter table households enable row level security;
alter table transactions enable row level security;

-- 사이트가 GitHub Pages로 공개 배포되므로, 로그인(Supabase Auth)한 사용자만
-- 읽고 쓸 수 있도록 제한합니다. 앱은 공유 계정 1개로 로그인하는 방식(src/Login.jsx)을
-- 씁니다 — 로그인하지 않은 방문자는 anon key로 API를 직접 호출해도 데이터를 못 봅니다.

drop policy if exists "households_select_anon" on households;
drop policy if exists "households_select_auth" on households;
create policy "households_select_auth" on households
  for select using (auth.role() = 'authenticated');

drop policy if exists "households_write_anon" on households;
drop policy if exists "households_write_auth" on households;
create policy "households_write_auth" on households
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "transactions_select_anon" on transactions;
drop policy if exists "transactions_select_auth" on transactions;
create policy "transactions_select_auth" on transactions
  for select using (auth.role() = 'authenticated');

drop policy if exists "transactions_write_anon" on transactions;
drop policy if exists "transactions_write_auth" on transactions;
create policy "transactions_write_auth" on transactions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- 4. fixed_deposits (계모임 정기예금 계좌) — 계좌 하나짜리라 단일 행으로 관리
-- ============================================================
create table if not exists fixed_deposits (
  id             text primary key,
  account_number text not null,
  product_name   text not null default '정기예금',
  opened_date    date not null,
  maturity_date  date not null,
  principal      numeric not null,
  rate           numeric not null,
  tax_type       text not null default '일반과세',
  balance        numeric not null,
  history        jsonb not null default '[]',
  updated_at     timestamptz not null default now()
);

alter table fixed_deposits enable row level security;

drop policy if exists "fixed_deposits_select_auth" on fixed_deposits;
create policy "fixed_deposits_select_auth" on fixed_deposits
  for select using (auth.role() = 'authenticated');

drop policy if exists "fixed_deposits_write_auth" on fixed_deposits;
create policy "fixed_deposits_write_auth" on fixed_deposits
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
