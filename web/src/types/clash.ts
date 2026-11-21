// 管線衝突檢核（POST /api/clash）的資料型別與參數
import { clampNum } from '../lib/storage';
import type { PipeKindId } from './pipeKind';
import type { LngLat } from './profile';

/** overlap＝兩管重疊；near＝淨距不足；nodepth＝既有管線埋深缺值，只檢水平 */
export type ClashSeverity = 'overlap' | 'near' | 'nodepth';

export const CLASH_SEVERITY: Record<ClashSeverity, { label: string; color: string }> = {
  overlap: { label: '重疊', color: '#ff6b6b' },
  near: { label: '淨距不足', color: '#ff922b' },
  nodepth: { label: '埋深缺值', color: '#a9e34b' },
};

/** 一筆疑似衝突（API 回傳） */
export interface ClashPipe {
  layer: PipeKindId;
  gid: number;
  pipe_no: string | null;
  material: string | null;
  mgmt_unit: string | null;
  dia_width: number | null;
  dia_height: number | null;
  size_unit: number | null;
  /** 共管條數 */
  n: number | null;
  /** 斷面寬、高（公尺；h null＝圓管） */
  w: number | null;
  h: number | null;
  severity: ClashSeverity;
  /** 水平淨距（公尺，負值＝水平方向重疊） */
  h_gap: number;
  /** 垂直淨距（公尺；null＝埋深缺值） */
  v_gap: number | null;
  /** 既有管線在最接近處的管頂埋深（公尺；null＝缺值） */
  depth: number | null;
  /** 既有管線埋深異常、已截在上限 */
  clamped: boolean;
  /** 規劃管線在最接近處的管頂埋深（公尺） */
  plan_depth: number;
  /** 距規劃管線起點（公尺） */
  dist: number;
  /** 既有管線上最接近的點 */
  lng: number;
  lat: number;
}

export interface ClashResult {
  /** 規劃管線長度（公尺） */
  length: number;
  /** 粗篩後實際比對的既有管線數 */
  checked: number;
  truncated: boolean;
  clashes: ClashPipe[];
}

/** 規劃管線參數（記在 localStorage） */
export interface ClashParams {
  /** 管徑（mm） */
  diaMm: number;
  /** 起點、終點管頂埋深（m） */
  startDep: number;
  endDep: number;
  /** 檢核淨距（m），水平與垂直相同 */
  clearance: number;
}

export const CLASH_DIA_RANGE = { min: 10, max: 5000 } as const;
export const CLASH_DEPTH_RANGE = { min: 0, max: 30 } as const;
export const CLASH_CLEARANCE_RANGE = { min: 0, max: 5 } as const;

export function parseClashParams(v: Record<string, unknown>): ClashParams {
  return {
    diaMm: clampNum(v.diaMm, CLASH_DIA_RANGE, 600),
    startDep: clampNum(v.startDep, CLASH_DEPTH_RANGE, 1.5),
    endDep: clampNum(v.endDep, CLASH_DEPTH_RANGE, 1.5),
    clearance: clampNum(v.clearance, CLASH_CLEARANCE_RANGE, 0.3),
  };
}

export type ClashLine = LngLat[];
