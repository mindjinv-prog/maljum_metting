import { useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* 계모임 회원들이 공유하는 계정 하나로 로그인하는 최소한의 인증 화면.
   Supabase Auth로 로그인하면, RLS 정책이 "로그인한 사용자만" DB를 읽고
   쓸 수 있게 막아주기 때문에 공개된 사이트 주소만으로는 데이터를 볼 수 없다. */
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError("로그인 정보가 올바르지 않아요. 계모임 총무에게 계정 정보를 확인해주세요.");
    }
    // 성공하면 App.jsx의 onAuthStateChange가 자동으로 감지해서 화면을 넘겨준다.
  };

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
        padding: 24,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 320,
          background: "#1D2839",
          border: "1px solid #B08D57",
          borderRadius: 12,
          padding: "28px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 12, letterSpacing: 2, color: "#B08D57", marginBottom: 6 }}>置簿冊 · 계비 장부</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>말점 계모임 로그인</div>
        </div>
        <input
          type="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="username"
          style={{
            background: "#2B3A55",
            border: "1px solid #445374",
            borderRadius: 6,
            padding: "10px 12px",
            color: "#F4EFE0",
            fontSize: 14,
          }}
        />
        <input
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          style={{
            background: "#2B3A55",
            border: "1px solid #445374",
            borderRadius: 6,
            padding: "10px 12px",
            color: "#F4EFE0",
            fontSize: 14,
          }}
        />
        {error && <div style={{ color: "#F0B0B0", fontSize: 13 }}>{error}</div>}
        <button
          type="submit"
          disabled={loading}
          style={{
            background: "#A6323C",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "로그인 중…" : "로그인"}
        </button>
        <div style={{ fontSize: 11.5, color: "#93A0B4" }}>
          계정 정보는 계모임 총무에게 문의해주세요.
        </div>
      </form>
    </div>
  );
}
