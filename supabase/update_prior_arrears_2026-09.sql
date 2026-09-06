-- 이미 Supabase households 테이블에 시드 데이터가 들어간 상태라면
-- (즉, 앱을 이미 한 번 정상 로드한 적이 있다면) 아래 UPDATE를 SQL Editor에서 실행해서
-- 윤석민/김광민의 2026년 이전 미납 이월분을 반영하세요.
-- 아직 한 번도 정상 로드된 적이 없다면(테이블이 비어있다면) 이 파일은 실행할 필요 없이,
-- App.jsx의 시드 데이터가 그대로 반영됩니다.

update households
set prior_arrears = (
  select array_agg(to_char(d, 'YYYY-MM'))
  from generate_series('2022-01-01'::date, '2025-12-01'::date, interval '1 month') d
)
where id = 'h1'; -- 윤석민

update households
set prior_arrears = (
  select array_agg(to_char(d, 'YYYY-MM'))
  from generate_series('2019-01-01'::date, '2025-12-01'::date, interval '1 month') d
)
where id = 'h2'; -- 김광민
