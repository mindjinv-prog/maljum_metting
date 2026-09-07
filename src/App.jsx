import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Upload, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Users, Wallet, TrendingUp, X } from "lucide-react";
import {
  fetchHouseholds,
  fetchTransactions,
  saveHouseholds,
  insertNewTransactions,
  seedIfEmpty,
  resetAll,
} from "./lib/ledgerStore";
import { supabase } from "./lib/supabaseClient";
import Login from "./Login";

/* ============================================================
   말점 계모임 회비 장부 — "치부책(置簿冊)" 컨셉
   전통 계모임 장부의 인디고 표지 + 한지 속지 + 붉은 인주 도장을
   모티프로 삼아, 실제 은행 거래내역을 회원별 월별 납부 현황으로
   변환해 보여주는 장부형 대시보드.
   ============================================================ */

// ---------- 회원(가구) 명단 ----------
// ※ 이 배열은 "실제 데이터가 없을 때 보여줄 예시" 용도입니다.
//    실제 회원 명단/거래내역은 Supabase에 저장되며, 앱 로드시 자동으로
//    불러옵니다 (src/lib/ledgerStore.js 참고). 공개 저장소에 실명이
//    들어가지 않도록 아래는 전부 가상의 예시 데이터입니다.
const INITIAL_HOUSEHOLDS = [
  { id: "h1", names: ["김철수"], family: 2, role: "일반", fee: 30000 },
  { id: "h2", names: ["이영희"], family: 1, role: "일반", fee: 30000 },
  { id: "h3", names: ["박민수", "최지은"], family: 4, role: "일반", fee: 30000 },
  { id: "h4", names: ["정다은"], family: 3, role: "총무", fee: 20000 },
  { id: "h5", names: ["강민준", "윤서연"], family: 4, role: "회장", fee: 20000, priorArrears: ["2025-10", "2025-11", "2025-12"] },
];

// ---------- 예시 거래내역 (시드 데이터) ----------
// ※ 실명 대신 위 INITIAL_HOUSEHOLDS와 짝이 맞는 가상의 이름을 사용합니다.
const SEED_ROWS = [
  ["2026.08.15 10:00:00", "전자금융", "김철수", "", 0, 30000, 500000, "예시은행"],
  ["2026.08.10 09:30:00", "전자금융", "이영희", "", 0, 30000, 470000, "예시은행"],
  ["2026.08.05 14:20:00", "전자금융", "박민수", "", 0, 30000, 440000, "예시은행"],
  ["2026.07.15 10:00:00", "전자금융", "김철수", "", 0, 30000, 410000, "예시은행"],
  ["2026.07.10 09:30:00", "전자금융", "이영희", "", 0, 30000, 380000, "예시은행"],
  ["2026.06.30 12:00:00", "결산이자", "이자세금:10원", "", 0, 90, 350000, "예시은행"],
  ["2026.06.05 15:00:00", "스마트출금", "예시업체", "행사비", 100000, 0, 349910, "예시은행"],
  ["2026.06.01 15:28:33", "전자금융", "정다은", "", 0, 900000, 449910, "예시은행"],
];

function rowsToTransactions(rows) {
  return rows.map((r, i) => {
    const [dt, desc, name, memo, wd, dep, bal, branch] = r;
    const [datePart, timePart] = String(dt).split(" ");
    const ymd = datePart.replaceAll(".", "-");
    return {
      key: `seed-${i}-${ymd}-${name}-${wd}-${dep}`,
      date: ymd,
      time: timePart || "",
      month: ymd.slice(0, 7),
      desc,
      name: String(name || "").trim(),
      memo: memo || "",
      withdraw: Number(wd) || 0,
      deposit: Number(dep) || 0,
      balance: Number(bal) || 0,
      branch,
    };
  });
}

const SEED_TRANSACTIONS = rowsToTransactions(SEED_ROWS).map((t) =>
  t.date === "2026-06-01" && t.name === "정다은" && t.deposit === 900000
    ? { ...t, excluded: true, excludeReason: "회비 아님으로 확인되어 제외 (예시)" }
    : t
);

// ---------- 월 유틸 ----------
function monthRange(start, end) {
  const out = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}
function addMonths(ym, n) {
  let [y, m] = ym.split("-").map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}
function getCurrentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const MONTH_LABEL = (ym) => `${Number(ym.slice(5, 7))}월`;
const FULL_MONTH_LABEL = (ym) => `${ym.slice(0, 4)}.${ym.slice(5, 7)}`;
// 이월 미납 개월수를 대시보드에서 한눈에 보기 좋게 "n년치" 단위로 요약
function YEARS_MONTHS_LABEL(totalMonths) {
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  if (y === 0) return `${m}개월`;
  if (m === 0) return `${y}년치`;
  return `${y}년 ${m}개월`;
}

// ---------- 매칭 ----------
function matchHousehold(name, households) {
  const n = (name || "").trim();
  if (!n) return null;
  return households.find((h) => h.names.some((alias) => alias.trim() === n)) || null;
}

// ---------- 장부 계산 ----------
// 가구마다 조회기간(startMonth~endMonth) 이전부터 밀린 회비(priorArrears)가 있을 수 있어서,
// 실제 채워나가는 순서는 [priorArrears..., 조회기간 months...] 를 한 줄로 이어붙인
// "타임라인"을 기준으로 계산한다. 입금은 항상 타임라인의 제일 오래된 미납월부터 채운다.
function buildLedger(households, transactions, startMonth, endMonth) {
  const months = monthRange(startMonth, endMonth);
  const perHousehold = {};
  const unmatched = [];
  const interest = [];
  const expenditure = [];
  const excluded = [];

  for (const h of households) {
    const priorArrears = (h.priorArrears || []).filter((m) => m < startMonth);
    const timeline = [...priorArrears, ...months];
    perHousehold[h.id] = {
      household: h,
      priorArrears,
      timeline,
      paidCount: 0, // 타임라인 기준, 처음부터 연속으로 채운 개월 수
      overflowCount: 0, // 타임라인(조회기간+이월분) 전체를 넘어서는 미래 선납 개월 수
      partials: [],
      trail: [], // {tx, covers:[월라벨...]}
      totalPaid: 0,
    };
  }

  const deposits = transactions
    .filter((t) => t.deposit > 0)
    .slice()
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  for (const t of transactions) {
    if (t.withdraw > 0) expenditure.push(t);
  }

  for (const t of deposits) {
    if (t.excluded) {
      excluded.push(t);
      continue;
    }
    if (t.desc === "결산이자" || /이자세금/.test(t.name)) {
      interest.push(t);
      continue;
    }
    const h = matchHousehold(t.name, households);
    if (!h) {
      unmatched.push(t);
      continue;
    }
    const rec = perHousehold[h.id];
    rec.totalPaid += t.deposit;
    const monthsCovered = Math.floor(t.deposit / h.fee);
    const remainder = t.deposit % h.fee;
    if (remainder !== 0) {
      rec.partials.push({ tx: t, remainder });
    }
    const covers = [];
    for (let i = 0; i < monthsCovered; i++) {
      const idx = rec.paidCount;
      let label;
      if (idx < rec.timeline.length) {
        label = rec.timeline[idx];
      } else {
        label = addMonths(endMonth, idx - rec.timeline.length + 1);
        rec.overflowCount += 1;
      }
      covers.push(label);
      rec.paidCount++;
    }
    rec.trail.push({ tx: t, covers });
  }

  const rows = households.map((h) => {
    const rec = perHousehold[h.id];
    const priorLen = rec.priorArrears.length;
    const priorPaidCount = Math.min(rec.paidCount, priorLen);
    const priorUnpaidCount = priorLen - priorPaidCount;
    // 이월 미납분 중 아직 안 채워진 "구체적인 월 목록"과 그 금액(현재 회비 기준)
    const priorArrearsUnpaid = rec.priorArrears.slice(priorPaidCount);
    const priorArrearsAmount = priorArrearsUnpaid.length * h.fee;
    const windowPaidCount = Math.max(0, Math.min(rec.paidCount - priorLen, months.length));
    const paidMonths = new Set(months.slice(0, windowPaidCount));
    const unpaid = months.filter((m) => !paidMonths.has(m));
    return {
      household: h,
      paidMonths,
      unpaidMonths: unpaid,
      priorArrears: rec.priorArrears,
      priorArrearsUnpaidCount: priorUnpaidCount,
      priorArrearsUnpaid,
      priorArrearsAmount,
      overflowCount: rec.overflowCount,
      partials: rec.partials,
      trail: rec.trail,
      totalPaid: rec.totalPaid,
    };
  });

  return { months, rows, unmatched, interest, expenditure, excluded };
}

// ---------- 파일 파싱 (KB국민은행 xls/xlsx) ----------
function parseWorkbookToTransactions(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerIdx = grid.findIndex((row) => row[0] === "거래일시");
  if (headerIdx === -1) throw new Error("거래일시 헤더를 찾을 수 없어요. KB국민은행 거래내역 조회 파일이 맞는지 확인해 주세요.");
  const out = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i];
    if (!row || row.length === 0) continue;
    if (row.some((c) => String(c).includes("합계"))) break;
    const [dt, desc, name, memo, wd, dep, bal, branch] = row;
    if (!dt) continue;
    const dtStr = String(dt).trim();
    const [datePart, timePart] = dtStr.split(" ");
    const ymd = datePart.replaceAll(".", "-");
    out.push({
      key: `u-${dtStr}-${name}-${wd}-${dep}-${bal}`,
      date: ymd,
      time: timePart || "",
      month: ymd.slice(0, 7),
      desc: String(desc || ""),
      name: String(name || "").trim(),
      memo: memo || "",
      withdraw: Number(wd) || 0,
      deposit: Number(dep) || 0,
      balance: Number(bal) || 0,
      branch,
    });
  }
  return out;
}

function fmtWon(n) {
  return `${n.toLocaleString("ko-KR")}원`;
}

// ============================================================
// UI 컴포넌트
// ============================================================

function Stamp({ small }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: small ? 22 : 30,
        height: small ? 22 : 30,
        borderRadius: "46% 54% 51% 49% / 53% 47% 53% 47%",
        border: `2px solid var(--stamp-red)`,
        color: "var(--stamp-red)",
        fontFamily: "'Noto Serif KR', serif",
        fontWeight: 700,
        fontSize: small ? 11 : 14,
        transform: "rotate(-6deg)",
        opacity: 0.88,
        boxShadow: "0 0 0 1px rgba(166,50,60,0.12)",
      }}
      title="납부완료"
    >
      納
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sub, tone }) {
  return (
    <div
      style={{
        background: "var(--paper)",
        border: "1px solid var(--paper-line)",
        borderRadius: 10,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-soft)" }}>
        <Icon size={15} />
        <span style={{ fontSize: 12.5, letterSpacing: 0.2 }}>{label}</span>
      </div>
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 24,
          fontWeight: 600,
          color: tone === "danger" ? "var(--stamp-red-deep)" : "var(--ink)",
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{sub}</div>}
    </div>
  );
}

function MonthlyTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--paper-line)",
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 12.5,
        maxWidth: 260,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {label} · {fmtWon(data.금액)}
      </div>
      {data.details.length === 0 ? (
        <div style={{ color: "var(--ink-soft)" }}>입금 내역 없음</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {data.details.map((d, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: "var(--ink-soft)" }}>{d.name}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmtWon(d.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HouseholdDetail({ row, months }) {
  return (
    <div
      style={{
        background: "rgba(43,58,85,0.03)",
        borderTop: "1px dashed var(--paper-line)",
        padding: "14px 20px",
        fontSize: 13,
      }}
    >
      {row.priorArrearsUnpaid && row.priorArrearsUnpaid.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            background: "rgba(166,50,60,0.06)",
            border: "1px solid rgba(166,50,60,0.2)",
            borderRadius: 8,
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--stamp-red-deep)", marginBottom: 3 }}>
            이전(이월) 미납 {row.priorArrearsUnpaid.length}개월 · {fmtWon(row.priorArrearsAmount)}
          </div>
          <div style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>
            {FULL_MONTH_LABEL(row.priorArrearsUnpaid[0])} ~ {FULL_MONTH_LABEL(row.priorArrearsUnpaid[row.priorArrearsUnpaid.length - 1])}
          </div>
        </div>
      )}
      {row.trail.length === 0 ? (
        <div style={{ color: "var(--ink-soft)" }}>이 기간 입금 기록이 없어요.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--ink-soft)", textAlign: "left" }}>
              <th style={{ fontWeight: 500, padding: "3px 8px 3px 0" }}>입금일</th>
              <th style={{ fontWeight: 500, padding: "3px 8px" }}>입금액</th>
              <th style={{ fontWeight: 500, padding: "3px 8px" }}>충당 개월</th>
              <th style={{ fontWeight: 500, padding: "3px 8px" }}>해당 월</th>
            </tr>
          </thead>
          <tbody>
            {row.trail.map((t, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--paper-line)" }}>
                <td style={{ padding: "5px 8px 5px 0", fontFamily: "'IBM Plex Mono', monospace" }}>{t.tx.date}</td>
                <td style={{ padding: "5px 8px", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtWon(t.tx.deposit)}</td>
                <td style={{ padding: "5px 8px" }}>{t.covers.length}개월</td>
                <td style={{ padding: "5px 8px", color: "var(--ink-soft)" }}>
                  {t.covers.map((m) => FULL_MONTH_LABEL(m)).join(", ")}
                  {t.covers.some((m) => months.length && m < months[0]) && (
                    <span style={{ color: "var(--stamp-red-deep)" }}> (이월 미납분 포함)</span>
                  )}
                  {t.covers.some((m) => months.length && m > months[months.length - 1]) && (
                    <span style={{ color: "var(--indigo)" }}> (조회기간 이후 선납분 포함)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {row.partials.length > 0 && (
        <div style={{ marginTop: 8, color: "var(--stamp-red-deep)", display: "flex", gap: 6, alignItems: "center" }}>
          <AlertTriangle size={13} />
          회비가 정확히 나누어떨어지지 않는 입금이 있어요 (잔액 확인 필요): {row.partials.map((p) => fmtWon(p.remainder)).join(", ")}
        </div>
      )}
    </div>
  );
}

export default function MajagyeLedger() {
  const [households, setHouseholds] = useState(INITIAL_HOUSEHOLDS);
  const [transactions, setTransactions] = useState(SEED_TRANSACTIONS);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [expandedId, setExpandedId] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [fileError, setFileError] = useState("");
  const [fileName, setFileName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const fileInputRef = useRef(null);

  // ---- 로그인 상태 확인 & 구독 (RLS가 로그인한 사용자만 허용하므로 로그인 전엔 데이터를 안 불러옴) ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) setLoaded(false); // 로그아웃하면 다음 로그인 때 다시 불러오도록
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // ---- 로그인 후 Supabase에서 데이터 불러오기 (테이블이 비어있으면 시드 데이터로 초기화) ----
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        await seedIfEmpty(INITIAL_HOUSEHOLDS, SEED_TRANSACTIONS);
        const [loadedHouseholds, loadedTransactions] = await Promise.all([
          fetchHouseholds(),
          fetchTransactions(),
        ]);
        if (!cancelled) {
          setHouseholds(loadedHouseholds.length ? loadedHouseholds : INITIAL_HOUSEHOLDS);
          setTransactions(loadedTransactions.length ? loadedTransactions : SEED_TRANSACTIONS);
          setLoaded(true);
        }
      } catch (err) {
        console.error("[Supabase] 초기 데이터를 불러오지 못했어요.", err);
        if (!cancelled) {
          // Supabase 연결에 실패해도 화면이 완전히 막히지 않도록 시드 데이터로 폴백
          setHouseholds(INITIAL_HOUSEHOLDS);
          setTransactions(SEED_TRANSACTIONS);
          setLoaded(true);
          setSaveStatus("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // ---- 회원 명단 변경 시 자동 저장 (거래내역은 업로드 시점에 바로 저장됨) ----
  useEffect(() => {
    if (!loaded) return;
    setSaveStatus("saving");
    const t = setTimeout(async () => {
      try {
        await saveHouseholds(households);
        setSaveStatus("saved");
      } catch (err) {
        console.error("[Supabase] 회원 명단 저장 실패", err);
        setSaveStatus("error");
      }
    }, 400); // 짧은 debounce로 저장 호출 과다 방지
    return () => clearTimeout(t);
  }, [households, loaded]);

  const resetToSeed = useCallback(async () => {
    if (!window.confirm("저장된 데이터를 지우고 초기 시드 데이터로 되돌릴까요? 이 작업은 되돌릴 수 없어요.")) return;
    setSaveStatus("saving");
    try {
      await resetAll(INITIAL_HOUSEHOLDS, SEED_TRANSACTIONS);
      setSaveStatus("saved");
    } catch (err) {
      console.error("[Supabase] 초기화 실패", err);
      setSaveStatus("error");
    } finally {
      setHouseholds(INITIAL_HOUSEHOLDS);
      setTransactions(SEED_TRANSACTIONS);
    }
  }, []);

  const currentYM = getCurrentYM();
  const startMonth = `${year}-01`;
  const yearEndRaw = `${year}-12`;
  const endMonth = yearEndRaw > currentYM ? currentYM : yearEndRaw; // 아직 안 된 미래월은 보이지 않게 자름

  const earliestYear = Math.min(
    year,
    ...transactions.map((t) => Number(t.date.slice(0, 4))),
    ...households.flatMap((h) => (h.priorArrears || []).map((m) => Number(m.slice(0, 4))))
  );
  const yearOptions = [];
  for (let y = Number(currentYM.slice(0, 4)); y >= Math.min(earliestYear, Number(currentYM.slice(0, 4))); y--) {
    yearOptions.push(y);
  }

  const ledger = useMemo(
    () => buildLedger(households, transactions, startMonth, endMonth),
    [households, transactions, startMonth, endMonth]
  );

  const handleFile = useCallback(
    (file) => {
      setFileError("");
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: "array", cellDates: false });
          const parsed = parseWorkbookToTransactions(wb);
          if (parsed.length === 0) {
            setFileError("거래내역을 찾지 못했어요. KB국민은행 '거래내역조회' 다운로드 파일이 맞는지 확인해 주세요.");
            return;
          }
          const existingKeys = new Set(transactions.map((t) => t.key));
          const newRows = parsed.filter((t) => !existingKeys.has(t.key));

          setSaveStatus("saving");
          try {
            await insertNewTransactions(newRows);
            setSaveStatus("saved");
          } catch (err) {
            console.error("[Supabase] 거래내역 저장 실패", err);
            setSaveStatus("error");
          }

          setTransactions((prev) => {
            const prevKeys = new Set(prev.map((t) => t.key));
            const merged = prev.slice();
            for (const t of newRows) {
              if (!prevKeys.has(t.key)) merged.push(t);
            }
            return merged;
          });
          setFileName(`${file.name} · 새 거래 ${newRows.length}건 추가 (중복 ${parsed.length - newRows.length}건 제외)`);
        } catch (err) {
          setFileError(err.message || "파일을 읽는 중 문제가 생겼어요.");
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [transactions]
  );

  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: "100%",
          background: "#2B3A55",
          color: "#F4EFE0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Noto Sans KR', sans-serif",
          fontSize: 14,
          padding: 40,
        }}
      >
        확인 중…
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  if (!loaded) {
    return (
      <div
        style={{
          minHeight: "100%",
          background: "#2B3A55",
          color: "#F4EFE0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Noto Sans KR', sans-serif",
          fontSize: 14,
          padding: 40,
        }}
      >
        저장된 장부를 불러오는 중…
      </div>
    );
  }

  const totalCollected = ledger.rows.reduce((s, r) => s + r.totalPaid, 0) + ledger.interest.reduce((s, t) => s + t.deposit, 0);
  const sortedTx = transactions.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const latestTx = sortedTx.length ? sortedTx[sortedTx.length - 1] : null;
  const currentBalance = latestTx ? latestTx.balance : 0;
  const currentMonth = endMonth;
  const paidThisMonth = ledger.rows.filter((r) => r.paidMonths.has(currentMonth)).length;
  const totalUnpaid = (r) => r.unpaidMonths.length + r.priorArrearsUnpaidCount;
  const overdueHouseholds = ledger.rows.filter((r) => totalUnpaid(r) > 0);
  const worstOverdue = overdueHouseholds.slice().sort((a, b) => totalUnpaid(b) - totalUnpaid(a))[0];

  const chartData = ledger.months.map((m) => {
    const monthDeposits = transactions.filter(
      (t) => t.month === m && t.deposit > 0 && t.desc !== "결산이자" && !/이자세금/.test(t.name)
    );
    const sum = monthDeposits.reduce((s, t) => s + t.deposit, 0);
    const details = monthDeposits
      .slice()
      .sort((a, b) => b.deposit - a.deposit)
      .map((t) => ({ name: t.name || "(이름없음)", amount: t.deposit }));
    return { month: MONTH_LABEL(m), 금액: sum, details };
  });

  return (
    <div
      style={{
        fontFamily: "'Noto Sans KR', sans-serif",
        color: "var(--ink)",
        background: "var(--indigo)",
        minHeight: "100%",
        padding: "0 0 40px 0",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;700&family=Noto+Sans+KR:wght@400;500;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
        :root {
          --ink: #241C14;
          --ink-soft: #6b6153;
          --paper: #EFE6CF;
          --paper-line: #D9C79D;
          --indigo: #2B3A55;
          --indigo-deep: #1D2839;
          --stamp-red: #A6323C;
          --stamp-red-deep: #7C2430;
          --brass: #B08D57;
          --muted: #9C9384;
        }
        * { box-sizing: border-box; }
        button { cursor: pointer; font-family: inherit; }
        input, select { font-family: inherit; }
        ::selection { background: rgba(166,50,60,0.25); }
        .ledger-scroll::-webkit-scrollbar { height: 8px; }
        .ledger-scroll::-webkit-scrollbar-thumb { background: var(--paper-line); border-radius: 4px; }
      `}</style>

      {/* 헤더 : 인디고 표지 */}
      <div style={{ padding: "28px 24px 22px", borderBottom: `3px solid var(--brass)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 2, color: "var(--brass)", marginBottom: 6 }}>
              置簿冊 · 계비 장부
            </div>
            <h1
              style={{
                fontFamily: "'Noto Serif KR', serif",
                fontSize: 30,
                fontWeight: 700,
                color: "#F4EFE0",
                margin: 0,
              }}
            >
              말점 계모임
            </h1>
            <div style={{ color: "#C7CEDA", fontSize: 13, marginTop: 6 }}>
              총 {households.reduce((s, h) => s + h.family, 0)}명 · {households.length}가구 · 조회기간 {startMonth} ~ {endMonth}
              {endMonth < yearEndRaw && <span style={{ color: "#93A0B4" }}> (아직 안 된 달은 표시하지 않음)</span>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={{ background: "#1D2839", color: "#F4EFE0", border: "1px solid var(--brass)", borderRadius: 6, padding: "6px 8px", fontSize: 13 }}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "var(--stamp-red)", color: "#fff", border: "none",
              borderRadius: 8, padding: "9px 16px", fontSize: 13.5, fontWeight: 600,
            }}
          >
            <Upload size={15} /> 거래내역 파일 업로드 (.xls/.xlsx)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xls,.xlsx"
            style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ""; }}
          />
          <button
            onClick={() => setShowEditor((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "transparent", color: "#F4EFE0", border: "1px solid var(--brass)",
              borderRadius: 8, padding: "9px 14px", fontSize: 13.5,
            }}
          >
            <Users size={15} /> 회원 명단 {showEditor ? "닫기" : "관리"}
          </button>
          <button
            onClick={resetToSeed}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "transparent", color: "#A9B4C4", border: "1px solid rgba(176,141,87,0.4)",
              borderRadius: 8, padding: "9px 14px", fontSize: 12.5,
            }}
          >
            초기 데이터로 리셋
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "transparent", color: "#A9B4C4", border: "1px solid rgba(176,141,87,0.4)",
              borderRadius: 8, padding: "9px 14px", fontSize: 12.5,
            }}
          >
            로그아웃
          </button>
          {fileName && <span style={{ color: "#C7CEDA", fontSize: 12.5, alignSelf: "center" }}>{fileName}</span>}
          <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: 12, color: "#93A0B4" }}>
            {saveStatus === "saving" && "저장 중…"}
            {saveStatus === "saved" && "브라우저에 자동 저장됨 (나만 볼 수 있음)"}
            {saveStatus === "error" && "저장 실패 — 네트워크를 확인해 주세요"}
          </span>
        </div>
        {fileError && (
          <div style={{ marginTop: 10, color: "#F0B0B0", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            <AlertTriangle size={14} /> {fileError}
          </div>
        )}
      </div>

      {/* 한지 속지 영역 */}
      <div style={{ background: "var(--paper)", padding: "24px", position: "relative" }}>
        {/* 붉은 마진선 */}
        <div style={{ position: "absolute", left: 14, top: 0, bottom: 0, width: 1.5, background: "rgba(166,50,60,0.35)" }} />

        {showEditor && (
          <div style={{ marginBottom: 22, background: "#fff8ea", border: "1px solid var(--paper-line)", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>회원 명단 & 회비 설정</div>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.6fr 0.7fr 0.8fr", gap: "6px 12px", fontSize: 13 }}>
              <div style={{ color: "var(--ink-soft)", fontWeight: 500 }}>이름 (쉼표로 부부 구분)</div>
              <div style={{ color: "var(--ink-soft)", fontWeight: 500 }}>가족수</div>
              <div style={{ color: "var(--ink-soft)", fontWeight: 500 }}>직책</div>
              <div style={{ color: "var(--ink-soft)", fontWeight: 500 }}>월회비</div>
              {households.map((h) => (
                <React.Fragment key={h.id}>
                  <input
                    value={h.names.join(",")}
                    onChange={(e) => {
                      const names = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                      setHouseholds((prev) => prev.map((x) => (x.id === h.id ? { ...x, names } : x)));
                    }}
                    style={{ border: "1px solid var(--paper-line)", borderRadius: 5, padding: "4px 7px" }}
                  />
                  <input
                    type="number"
                    value={h.family}
                    onChange={(e) => setHouseholds((prev) => prev.map((x) => (x.id === h.id ? { ...x, family: Number(e.target.value) } : x)))}
                    style={{ border: "1px solid var(--paper-line)", borderRadius: 5, padding: "4px 7px", width: "100%" }}
                  />
                  <select
                    value={h.role}
                    onChange={(e) => {
                      const role = e.target.value;
                      setHouseholds((prev) => prev.map((x) => (x.id === h.id ? { ...x, role, fee: role === "일반" ? 30000 : 20000 } : x)));
                    }}
                    style={{ border: "1px solid var(--paper-line)", borderRadius: 5, padding: "4px 7px" }}
                  >
                    <option value="일반">일반</option>
                    <option value="총무">총무</option>
                    <option value="회장">회장</option>
                  </select>
                  <input
                    type="number"
                    value={h.fee}
                    onChange={(e) => setHouseholds((prev) => prev.map((x) => (x.id === h.id ? { ...x, fee: Number(e.target.value) } : x)))}
                    style={{ border: "1px solid var(--paper-line)", borderRadius: 5, padding: "4px 7px" }}
                  />
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* 통계 카드 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 22 }}>
          <StatCard
            icon={Wallet}
            label="잔금"
            value={fmtWon(currentBalance)}
            sub={latestTx ? `${latestTx.date} 기준 · 누적 수금 ${fmtWon(totalCollected)}` : "거래 없음"}
          />
          <StatCard icon={CheckCircle2} label={`${MONTH_LABEL(currentMonth)} 납부 현황`} value={`${paidThisMonth} / ${households.length}가구`} />
          <StatCard
            icon={AlertTriangle}
            label="미납 가구"
            value={`${overdueHouseholds.length}가구`}
            sub={worstOverdue ? `최다 미납: ${worstOverdue.household.names[0]} 외 ${totalUnpaid(worstOverdue)}개월` : "미납 없음"}
            tone={overdueHouseholds.length > 0 ? "danger" : undefined}
          />
          <StatCard icon={TrendingUp} label="월 평균 수금" value={fmtWon(Math.round(totalCollected / Math.max(ledger.months.length, 1)))} />
        </div>

        {/* 월별 수금 추이 */}
        <div style={{ background: "#fff", border: "1px solid var(--paper-line)", borderRadius: 10, padding: "16px 18px 8px", marginBottom: 22 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>월별 수금 추이</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--paper-line)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "var(--ink-soft)" }} axisLine={{ stroke: "var(--paper-line)" }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--ink-soft)" }} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
              <Tooltip content={<MonthlyTooltip />} cursor={{ fill: "rgba(43,58,85,0.06)" }} />
              <Bar dataKey="금액" radius={[4, 4, 0, 0]}>
                {chartData.map((_, i) => <Cell key={i} fill="var(--indigo)" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 장부 도장 테이블 */}
        <div style={{ background: "#fff", border: "1px solid var(--paper-line)", borderRadius: 10, overflow: "hidden", marginBottom: 22 }}>
          <div style={{ padding: "14px 18px 4px", fontSize: 13.5, fontWeight: 600 }}>가구별 월별 납부 현황</div>
          <div className="ledger-scroll" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--paper-line)" }}>
                  <th style={{ textAlign: "left", padding: "8px 14px", fontSize: 12.5, color: "var(--ink-soft)", fontWeight: 500, minWidth: 160 }}>가구</th>
                  <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12.5, color: "var(--ink-soft)", fontWeight: 500 }}>회비</th>
                  {ledger.months.map((m) => (
                    <th key={m} style={{ padding: "8px 6px", fontSize: 12.5, color: "var(--ink-soft)", fontWeight: 500, textAlign: "center" }}>
                      {MONTH_LABEL(m)}
                    </th>
                  ))}
                  <th style={{ padding: "8px 10px", fontSize: 12.5, color: "var(--ink-soft)", fontWeight: 500, textAlign: "center" }}>선납</th>
                  <th style={{ padding: "8px 14px" }} />
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((row) => {
                  const isExpanded = expandedId === row.household.id;
                  const overdue = row.unpaidMonths.length + row.priorArrearsUnpaidCount;
                  return (
                    <React.Fragment key={row.household.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : row.household.id)}
                        style={{ borderBottom: "1px solid var(--paper-line)", cursor: "pointer" }}
                      >
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{row.household.names.join(" · ")}</div>
                          <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                            {row.household.role !== "일반" && <span style={{ color: "var(--stamp-red-deep)", fontWeight: 600 }}>{row.household.role} · </span>}
                            가족 {row.household.family}명
                          </div>
                          {row.priorArrears.length > 0 && (
                            <div style={{ fontSize: 11, marginTop: 3 }}>
                              {row.priorArrearsUnpaidCount > 0 ? (
                                <span style={{ color: "var(--stamp-red-deep)", fontWeight: 600 }}>
                                  이월 미납 {YEARS_MONTHS_LABEL(row.priorArrearsUnpaidCount)} (자세히 보기 ▸)
                                </span>
                              ) : (
                                <span style={{ color: "var(--ink-soft)" }}>이월분 완납</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "10px", fontSize: 13, fontFamily: "'IBM Plex Mono', monospace" }}>{(row.household.fee / 10000)}만원</td>
                        {ledger.months.map((m) => (
                          <td key={m} style={{ padding: "6px", textAlign: "center" }}>
                            {row.paidMonths.has(m) ? <Stamp small /> : <span style={{ color: "var(--muted)", fontSize: 16, opacity: 0.5 }}>·</span>}
                          </td>
                        ))}
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          {row.overflowCount > 0 ? (
                            <span style={{ fontSize: 12, color: "var(--indigo)", fontWeight: 600 }}>+{row.overflowCount}개월</span>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "6px 14px", textAlign: "right" }}>
                          {overdue > 0 && (
                            <span style={{ fontSize: 11.5, color: "var(--stamp-red-deep)", fontWeight: 600, marginRight: 8 }}>
                              미납 {overdue}개월
                            </span>
                          )}
                          {isExpanded ? <ChevronDown size={15} style={{ display: "inline" }} /> : <ChevronRight size={15} style={{ display: "inline" }} />}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={ledger.months.length + 4} style={{ padding: 0 }}>
                            <HouseholdDetail row={row} months={ledger.months} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 미확인 입금 */}
        {ledger.unmatched.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid var(--paper-line)", borderRadius: 10, padding: "14px 18px", marginBottom: 22 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} color="var(--stamp-red-deep)" /> 회원 명단과 매칭되지 않은 입금 ({ledger.unmatched.length}건)
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {ledger.unmatched.map((t) => (
                  <tr key={t.key} style={{ borderTop: "1px solid var(--paper-line)" }}>
                    <td style={{ padding: "6px 8px 6px 0", fontFamily: "'IBM Plex Mono', monospace", color: "var(--ink-soft)" }}>{t.date}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{t.name || "(이름없음)"}</td>
                    <td style={{ padding: "6px 8px", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtWon(t.deposit)}</td>
                    <td style={{ padding: "6px 8px", color: "var(--ink-soft)" }}>회원 명단에서 이름을 확인해 주세요</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 제외된 거래 */}
        {ledger.excluded.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid var(--paper-line)", borderRadius: 10, padding: "14px 18px", marginBottom: 22 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8, color: "var(--ink-soft)" }}>
              회비 계산에서 제외된 거래 ({ledger.excluded.length}건)
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {ledger.excluded.map((t) => (
                  <tr key={t.key} style={{ borderTop: "1px solid var(--paper-line)" }}>
                    <td style={{ padding: "6px 8px 6px 0", fontFamily: "'IBM Plex Mono', monospace", color: "var(--ink-soft)" }}>{t.date}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{t.name}</td>
                    <td style={{ padding: "6px 8px", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtWon(t.deposit)}</td>
                    <td style={{ padding: "6px 8px", color: "var(--ink-soft)" }}>{t.excludeReason || "수동 제외"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 지출 내역 */}
        {ledger.expenditure.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid var(--paper-line)", borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>지출 내역 (출금)</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {ledger.expenditure.map((t) => (
                  <tr key={t.key} style={{ borderTop: "1px solid var(--paper-line)" }}>
                    <td style={{ padding: "6px 8px 6px 0", fontFamily: "'IBM Plex Mono', monospace", color: "var(--ink-soft)" }}>{t.date}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>
                      {t.memo || t.name || t.desc}
                      {t.memo && t.name && t.memo !== t.name && (
                        <div style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 400 }}>계좌 표시명: {t.name}</div>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px", fontFamily: "'IBM Plex Mono', monospace", color: "var(--stamp-red-deep)" }}>-{fmtWon(t.withdraw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}