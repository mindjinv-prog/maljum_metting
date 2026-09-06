import { supabase } from "./supabaseClient";

/* ============================================================
   households / transactions 를 Supabase와 주고받기 위한 데이터 계층.
   App.jsx는 이 파일의 함수만 호출하고, snake_case 컬럼 <-> camelCase
   앱 상태 변환은 전부 여기서 처리한다.
   ============================================================ */

function toDbHousehold(h) {
  return {
    id: h.id,
    names: h.names,
    family: h.family,
    role: h.role,
    fee: h.fee,
    prior_arrears: h.priorArrears || [],
  };
}

function fromDbHousehold(row) {
  return {
    id: row.id,
    names: row.names || [],
    family: row.family,
    role: row.role,
    fee: row.fee,
    ...(row.prior_arrears && row.prior_arrears.length ? { priorArrears: row.prior_arrears } : {}),
  };
}

function toDbTransaction(t) {
  return {
    key: t.key,
    date: t.date,
    time: t.time || "",
    month: t.month,
    description: t.desc || "",
    name: t.name || "",
    memo: t.memo || "",
    withdraw: t.withdraw || 0,
    deposit: t.deposit || 0,
    balance: t.balance,
    branch: t.branch,
    excluded: !!t.excluded,
    exclude_reason: t.excludeReason || null,
  };
}

function fromDbTransaction(row) {
  return {
    key: row.key,
    date: row.date,
    time: row.time || "",
    month: row.month,
    desc: row.description || "",
    name: row.name || "",
    memo: row.memo || "",
    withdraw: Number(row.withdraw) || 0,
    deposit: Number(row.deposit) || 0,
    balance: Number(row.balance) || 0,
    branch: row.branch,
    ...(row.excluded ? { excluded: true, excludeReason: row.exclude_reason || undefined } : {}),
  };
}

// ---------- 조회 ----------

export async function fetchHouseholds() {
  const { data, error } = await supabase.from("households").select("*").order("id", { ascending: true });
  if (error) throw error;
  return (data || []).map(fromDbHousehold);
}

export async function fetchTransactions() {
  const { data, error } = await supabase.from("transactions").select("*");
  if (error) throw error;
  return (data || []).map(fromDbTransaction);
}

// ---------- 저장 ----------

// 회원 명단은 몇 안 되는(수십 행 이내) 데이터라 편집될 때마다 전체를 upsert 한다.
export async function saveHouseholds(households) {
  if (!households.length) return;
  const { error } = await supabase.from("households").upsert(households.map(toDbHousehold));
  if (error) throw error;
}

// 거래내역은 계속 쌓이는 데이터라, 엑셀 업로드로 새로 파싱된 행만 넘겨서
// key 충돌(이미 있는 거래) 시 무시하도록 삽입한다.
export async function insertNewTransactions(newTransactions) {
  if (!newTransactions.length) return;
  const { error } = await supabase
    .from("transactions")
    .upsert(newTransactions.map(toDbTransaction), { onConflict: "key", ignoreDuplicates: true });
  if (error) throw error;
}

// 최초 실행(테이블이 비어있을 때) 시드 데이터를 한 번에 밀어넣을 때 사용.
export async function seedIfEmpty(seedHouseholds, seedTransactions) {
  const [{ count: householdCount }, { count: txCount }] = await Promise.all([
    supabase.from("households").select("id", { count: "exact", head: true }),
    supabase.from("transactions").select("key", { count: "exact", head: true }),
  ]);

  if (!householdCount) {
    const { error } = await supabase.from("households").insert(seedHouseholds.map(toDbHousehold));
    if (error) throw error;
  }
  if (!txCount) {
    const { error } = await supabase.from("transactions").insert(seedTransactions.map(toDbTransaction));
    if (error) throw error;
  }

  return { seededHouseholds: !householdCount, seededTransactions: !txCount };
}

// "초기 데이터로 리셋" 버튼에서 사용 — 기존 행을 모두 지우고 시드 데이터를 다시 넣는다.
export async function resetAll(seedHouseholds, seedTransactions) {
  const delHouseholds = await supabase.from("households").delete().not("id", "is", null);
  if (delHouseholds.error) throw delHouseholds.error;
  const delTx = await supabase.from("transactions").delete().not("key", "is", null);
  if (delTx.error) throw delTx.error;

  const insHouseholds = await supabase.from("households").insert(seedHouseholds.map(toDbHousehold));
  if (insHouseholds.error) throw insHouseholds.error;
  const insTx = await supabase.from("transactions").insert(seedTransactions.map(toDbTransaction));
  if (insTx.error) throw insTx.error;
}
