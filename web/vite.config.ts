import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // 後端 API（FastAPI）走代理，前端程式一律用相對路徑 /api/...
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
});
