// 系統樣式（設定 → 系統樣式）套用到畫面：色彩 token、根字級、粗體、字型。
// 色彩 token 寫在 <html> 的 inline style，蓋過 index.css 的預設值；
// 淺色主題時 <html data-theme="light">，讓 shadcn 的 dark: 變體失效（見 index.css 的 @custom-variant）。
import { FONTS, TEXT_SIZES, themeBackground, type SystemStyle } from '../types/systemStyle';

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: Rgb) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
/** 由 a 往 b 混合 t（0～1） */
const mix = (a: string, b: string, t: number) => {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as Rgb);
};
/** 相對亮度（WCAG） */
const luminance = (hex: string) => {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** 背景色是否偏亮（偏亮就用深色文字） */
export const isLightColor = (hex: string) => luminance(hex) > 0.4;

/** 原本固定的深藍配色（index.css），預設主題原樣沿用 */
const NAVY_TOKENS: Record<string, string> = {
  background: '#10212d',
  foreground: '#e6edf2',
  card: '#172c3b',
  popover: '#172c3b',
  primary: '#e6edf2',
  'primary-foreground': '#10212d',
  secondary: '#213847',
  muted: '#213847',
  'muted-foreground': '#93a6b4',
  accent: '#213847',
  ring: '#5b7384',
};

/** 依背景色調出整組色彩 token（深色背景往白混、淺色背景往黑混） */
function deriveTokens(bg: string): Record<string, string> {
  const light = isLightColor(bg);
  const toward = light ? '#000000' : '#ffffff';
  const fg = mix(bg, toward, light ? 0.85 : 0.88);
  const surface = light ? mix(bg, '#ffffff', 0.7) : mix(bg, '#ffffff', 0.04);
  const raised = mix(bg, toward, light ? 0.06 : 0.08);
  return {
    background: bg,
    foreground: fg,
    card: surface,
    popover: surface,
    primary: fg,
    'primary-foreground': bg,
    secondary: raised,
    muted: raised,
    'muted-foreground': mix(bg, toward, 0.55),
    accent: raised,
    ring: mix(bg, toward, 0.35),
    border: light ? 'rgb(0 0 0 / 12%)' : 'rgb(255 255 255 / 10%)',
    input: light ? 'rgb(0 0 0 / 18%)' : 'rgb(255 255 255 / 15%)',
    destructive: light ? 'oklch(0.577 0.245 27.325)' : 'oklch(0.704 0.191 22.216)',
  };
}

const NOTO_LINK_ID = 'font-noto-sans-tc';

/** 思源黑體第一次選用時才載入（Google Fonts 依字元範圍分片下載） */
function ensureNotoFont() {
  if (document.getElementById(NOTO_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = NOTO_LINK_ID;
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&display=swap';
  document.head.appendChild(link);
}

/** 套用系統樣式到 <html> */
export function applySystemStyle(s: SystemStyle) {
  const root = document.documentElement;
  const bg = themeBackground(s);
  const tokens = { ...deriveTokens(bg), ...(s.theme === 'navy' ? NAVY_TOKENS : {}) };
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(`--${k}`, v);
  const light = isLightColor(bg);
  root.dataset.theme = light ? 'light' : 'dark';
  root.style.colorScheme = light ? 'light' : 'dark';

  const size = TEXT_SIZES.find((t) => t.id === s.textSize) ?? TEXT_SIZES[1];
  root.style.fontSize = `${size.scale * 100}%`;
  root.dataset.uiBold = s.bold ? '1' : '0';
  root.style.fontWeight = s.bold ? '600' : '';
  const font = FONTS.find((f) => f.id === s.font) ?? FONTS[0];
  if (font.id === 'noto') ensureNotoFont();
  root.style.fontFamily = font.family;
}

/** 目前介面文字的縮放倍率（根字級 / 16px）；Cesium 標籤等用 px 指定字級的地方乘上這個值 */
export function uiTextScale(): number {
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? px / 16 : 1;
}

/** Cesium 標籤用的 CSS font 字串：字級依介面縮放、字型與粗體跟隨系統樣式 */
export function uiCanvasFont(px: number, strong = false): string {
  const root = document.documentElement;
  const bold = strong || root.dataset.uiBold === '1';
  const family = root.style.fontFamily || FONTS[0].family;
  return `${bold ? 'bold ' : ''}${Math.round(px * uiTextScale())}px ${family}`;
}
