import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// GitHub Pages project 페이지(https://<사용자명>.github.io/maljum_metting/)로 배포하기 위해
// base를 저장소 이름으로 맞춰둠. 저장소 이름을 다르게 만들었다면 아래 경로도 함께 바꿔주세요.
export default defineConfig({
  base: '/maljum_metting/',
  plugins: [react()],
})
