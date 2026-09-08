import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// 커스텀 도메인(maljum.mindjin.com) 루트에서 서빙하므로 base를 '/'로 둡니다.
export default defineConfig({
  base: '/',
  plugins: [react()],
})
