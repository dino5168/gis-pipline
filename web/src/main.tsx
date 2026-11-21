import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { readStored } from './lib/storage';
import { applySystemStyle } from './lib/theme';
import { parseSystemStyle, SYSTEM_STYLE_KEY } from './types/systemStyle';

// 先套用系統樣式再繪製，避免開啟時閃一下預設配色
applySystemStyle(readStored(SYSTEM_STYLE_KEY, parseSystemStyle));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
