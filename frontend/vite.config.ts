/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { mockExtraction } from './mock/extraction.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.VITE_MOCK_API ? [mockExtraction()] : [])],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true },
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts' },
})
