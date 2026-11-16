import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Cesium 執行時要從 CESIUM_BASE_URL（= /cesium/，見 src/config.ts）載入 Workers、Assets 等靜態檔。
// node_modules/cesium/Build/Cesium/<目錄>/... → <outDir>/cesium/<目錄>/...（開發模式由外掛直接提供）
const CESIUM_STATIC = ['Workers', 'ThirdParty', 'Assets', 'Widgets'];

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: CESIUM_STATIC.map((dir) => ({
        src: `node_modules/cesium/Build/Cesium/${dir}/**/*`,
        dest: 'cesium',
        rename: { stripBase: 4 },
      })),
    }),
  ],
  // 與 tsconfig 的 paths 一致：@/ → src/（shadcn/ui 元件使用）
  resolve: {
    alias: [{ find: /^@\//, replacement: '/src/' }],
  },
  server: {
    port: 5173,
    // 後端 API（FastAPI）走代理，前端程式一律用相對路徑 /api/...
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
});
