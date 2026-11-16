import type {
  ExpressionSpecification,
  FilterSpecification,
  LineLayerSpecification,
} from 'maplibre-gl';
import { TILES_BASE } from '../config';
import { PIPE_KINDS, type PipeColorMode, type PipeKind, type PipeKindId } from '../types/pipeKind';

// 每種管線一個 vector source（source-layer = 資料表名稱）、兩個圖層（白色外框＋本體）
export const pipeSourceId = (kind: PipeKindId) => `pipes-${kind}`;
export const pipeLayerId = (kind: PipeKindId) => `pipes-${kind}`;
export const pipeCasingLayerId = (kind: PipeKindId) => `pipes-${kind}-casing`;
export const pipeTileJson = (kind: PipeKindId) => `${TILES_BASE}/${kind}`;

export interface Material {
  code: string;
  color: string;
  name: string;
}

/** 主要材料（依筆數排序）與顏色；其餘歸為「其他」 */
export const MATERIALS: Material[] = [
  { code: 'PVC', color: '#2f7fd8', name: '聚氯乙烯管' },
  { code: 'RCP', color: '#e8590c', name: '鋼筋混凝土管' },
  { code: 'ABS', color: '#2b9a66', name: 'ABS 管' },
  { code: 'VCP', color: '#a3459e', name: '陶管' },
  { code: 'PVCP', color: '#d6336c', name: 'PVC 壓力管' },
  { code: 'HDPE', color: '#0c8599', name: '高密度聚乙烯管' },
];
export const OTHER_CODE = '__other';
export const OTHER_MATERIAL: Material = { code: OTHER_CODE, color: '#868e96', name: '其他材料' };
export const ALL_MATERIAL_CODES = [...MATERIALS.map((m) => m.code), OTHER_CODE];

const colorExpr: ExpressionSpecification = [
  'match',
  ['get', 'material'],
  ...MATERIALS.flatMap((m) => [m.code, m.color]),
  OTHER_MATERIAL.color,
] as unknown as ExpressionSpecification;

// 線寬：依管徑（mm）與縮放等級
const dia: ExpressionSpecification = [
  'interpolate', ['linear'], ['coalesce', ['get', 'dia_width'], 200],
  150, 1, 300, 1.6, 600, 2.4, 1500, 4,
];

// 注意：["zoom"] 只能出現在最外層的 interpolate/step，額外加寬（hover、外框）要放進每個停止點
const widthExpr = (extra: number | ExpressionSpecification): ExpressionSpecification => [
  'interpolate', ['exponential', 1.6], ['zoom'],
  12, ['+', ['*', 0.4, dia], extra],
  16, ['+', ['*', 1.2, dia], extra],
  20, ['+', ['*', 4, dia], extra],
];
const hoverExtra: ExpressionSpecification = ['case', ['boolean', ['feature-state', 'hover'], false], 3, 0];

/** 管線本體顏色（選取時固定黃色） */
export function pipeColor(kind: PipeKind, mode: PipeColorMode): ExpressionSpecification {
  return [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    '#ffd400',
    mode === 'kind' ? kind.color : colorExpr,
  ];
}

export function pipeLayers(kind: PipeKind, mode: PipeColorMode): LineLayerSpecification[] {
  const id = kind.id as PipeKindId;
  const common = {
    type: 'line',
    source: pipeSourceId(id),
    'source-layer': id,
    minzoom: kind.minZoom,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  } as const;
  return [
    {
      ...common,
      id: pipeCasingLayerId(id),
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.7, 'line-width': widthExpr(1.5) },
    },
    {
      ...common,
      id: pipeLayerId(id),
      paint: { 'line-color': pipeColor(kind, mode), 'line-width': widthExpr(hoverExtra) },
    },
  ];
}

/** 全部種類的 source 與圖層（PIPE_KINDS 後面的畫在上面） */
export const PIPE_SOURCES = PIPE_KINDS.map((k) => ({ id: pipeSourceId(k.id), url: pipeTileJson(k.id) }));
export const allPipeLayers = (mode: PipeColorMode) => PIPE_KINDS.flatMap((k) => pipeLayers(k, mode));

/** 依勾選的材料產生圖層篩選條件 */
export function materialFilter(enabled: ReadonlySet<string>): FilterSpecification {
  const main = MATERIALS.map((m) => m.code);
  const shown = main.filter((c) => enabled.has(c));
  const parts: ExpressionSpecification[] = [];
  if (shown.length) parts.push(['in', ['get', 'material'], ['literal', shown]]);
  if (enabled.has(OTHER_CODE)) parts.push(['!', ['in', ['get', 'material'], ['literal', main]]]);
  return parts.length ? ['any', ...parts] : ['==', 1, 0];
}
