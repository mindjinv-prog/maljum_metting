import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // 개발 중 .env 설정을 깜빡했을 때 바로 알아챌 수 있도록 콘솔에 경고만 남기고,
  // 앱 자체는 계속 로드되게 둔다 (App.jsx 쪽에서 에러를 잡아 saveStatus로 보여줌).
  console.warn(
    "[supabaseClient] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았어요. " +
      ".env.example을 참고해서 .env 파일을 만들어주세요."
  );
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");
