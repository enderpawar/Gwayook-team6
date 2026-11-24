/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { mockExtraction } from './mock/extraction.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.VITE_MOCK_API ? [mockExtraction()] : [])],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    // 모의 응답을 쓰지 않을 때는 로컬 백엔드(backend/, npm start)로 보낸다.
    proxy: process.env.VITE_MOCK_API ? undefined : { '/api': 'http://127.0.0.1:3001' },
  },
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts' },
})
