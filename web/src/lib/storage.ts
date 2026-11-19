import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

// 使用者偏好存在 localStorage（只存在這台瀏覽器）。
// 讀寫失敗（隱私模式、格式錯誤等）一律不報錯：讀取時交給 parse 補預設值，寫入時忽略。

/** 從 localStorage 讀出物件；沒有、不是物件或解析失敗時回傳空物件 */
function readObject(key: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 讀取設定：parse 負責檢查每個欄位，不合法的用預設值 */
export function readStored<T>(key: string, parse: (v: Record<string, unknown>) => T): T {
  return parse(readObject(key));
}

/** 寫入設定（失敗時忽略） */
export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 無法儲存時忽略
  }
}

/** 會自動存到 localStorage 的 useState；初始值由 parse 從儲存內容還原 */
export function usePersistentState<T>(
  key: string,
  parse: (v: Record<string, unknown>) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(() => readStored(key, parse));
  useEffect(() => writeStored(key, value), [key, value]);
  return [value, setValue];
}

// ---- 欄位檢查（parse 用）

type Range = { readonly min: number; readonly max: number };

/** 不透明度範圍 0～1 */
export const OPACITY_RANGE: Range = { min: 0, max: 1 };

/** 有限數值夾在範圍內，否則用預設值 */
export const clampNum = (v: unknown, r: Range, def: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, r.min), r.max) : def;

/** 整數夾在範圍內，否則用預設值 */
export const clampInt = (v: unknown, r: Range, def: number): number =>
  typeof v === 'number' && Number.isInteger(v) ? Math.min(Math.max(v, r.min), r.max) : def;

/** 布林值，否則用預設值 */
export const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);

/** 必須是 options 其中一個 id，否則用預設值 */
export const oneOf = <T extends string>(v: unknown, options: readonly { id: T }[], def: T): T =>
  options.find((o) => o.id === v)?.id ?? def;
