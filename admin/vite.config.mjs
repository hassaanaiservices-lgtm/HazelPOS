import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// npm run dev: the screens on :5174, talking to the admin server (node server.js) on :4400
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': 'http://localhost:4400' } },
})
