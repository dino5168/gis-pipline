import { bool, oneOf } from '@/lib/storage';

// ---- 系統樣式（設定 → 系統樣式）：主題（背景色）、文字大小、粗體、字型
// 需求：2-Tasks/1-UI/15-設定系統顯示樣式.md

export type ThemeId = 'navy' | 'gray' | 'black' | 'light' | 'custom';

/** 預設主題；bg 是背景色，其餘顏色由 lib/theme.ts 依背景調出層次（深藍沿用原本的固定配色） */
export const THEMES: { id: ThemeId; label: string; bg: string }[] = [
  { id: 'navy', label: '深藍（預設）', bg: '#10212d' },
  { id: 'gray', label: '深灰', bg: '#1f2328' },
  { id: 'black', label: '黑', bg: '#0b0b0c' },
  { id: 'light', label: '淺色', bg: '#eef2f5' },
  { id: 'custom', label: '自訂', bg: '#10212d' },
];

export type TextSize = 'sm' | 'md' | 'lg' | 'xl';

/** 文字大小：整個介面（含地圖上的標籤）依比例縮放 */
export const TEXT_SIZES: { id: TextSize; label: string; scale: number }[] = [
  { id: 'sm', label: '小', scale: 0.9 },
  { id: 'md', label: '標準', scale: 1 },
  { id: 'lg', label: '大', scale: 1.15 },
  { id: 'xl', label: '特大', scale: 1.3 },
];

export type FontId = 'system' | 'jhenghei' | 'noto';

/** 字型；思源黑體在選用時才從 Google Fonts 載入 */
export const FONTS: { id: FontId; label: string; family: string }[] = [
  { id: 'system', label: '系統預設', family: "system-ui, 'Microsoft JhengHei', 'Noto Sans TC', sans-serif" },
  { id: 'jhenghei', label: '微軟正黑體', family: "'Microsoft JhengHei', 'Noto Sans TC', system-ui, sans-serif" },
  { id: 'noto', label: '思源黑體', family: "'Noto Sans TC', 'Microsoft JhengHei', system-ui, sans-serif" },
];

export interface SystemStyle {
  theme: ThemeId;
  /** 自訂主題的背景色 */
  customBg: string;
  textSize: TextSize;
  bold: boolean;
  font: FontId;
}

export const DEFAULT_SYSTEM_STYLE: SystemStyle = {
  theme: 'navy',
  customBg: '#10212d',
  textSize: 'md',
  bold: false,
  font: 'system',
};

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** 從儲存內容還原系統樣式（不合法的欄位用預設值） */
export function parseSystemStyle(v: Record<string, unknown>): SystemStyle {
  const d = DEFAULT_SYSTEM_STYLE;
  return {
    theme: oneOf(v.theme, THEMES, d.theme),
    customBg: isHex(v.customBg) ? v.customBg.toLowerCase() : d.customBg,
    textSize: oneOf(v.textSize, TEXT_SIZES, d.textSize),
    bold: bool(v.bold, d.bold),
    font: oneOf(v.font, FONTS, d.font),
  };
}

/** 目前主題的背景色 */
export const themeBackground = (s: SystemStyle): string =>
  s.theme === 'custom' ? s.customBg : (THEMES.find((t) => t.id === s.theme) ?? THEMES[0]).bg;

/** localStorage 鍵 */
export const SYSTEM_STYLE_KEY = 'utl.systemStyle';
