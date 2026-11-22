// 剖面分析匯出 PNG（白底、2 倍解析度）：
// 上方標題資訊（時間、A／B 坐標、剖面長與交會條數）＋斷面圖＋下方圖例。
// 斷面圖用 ProfileChart 以淺色配色另外繪成 SVG，再和文字一起畫到 canvas。
// 本檔由 ProfileWindow 動態 import（含 react-dom/server），不進主 bundle。
import { renderToStaticMarkup } from 'react-dom/server';
import { PIPE3D_NO_DEPTH_COLOR } from '../config';
import { formatDistance } from '../map/measure';
import { COORD_SYSTEMS, type CoordDisplaySettings } from '../types/coordSystem';
import { PIPE_KINDS } from '../types/pipeKind';
import type { LngLat, ProfileResult } from '../types/profile';
import { formatCoord } from './CoordinateDisplay';
import { PRINT_INK, ProfileChart } from './ProfileChart';

const SCALE = 2;
/** 匯出圖的基準寬度（px，與視窗最大寬度相同；管線多時斷面圖會再加寬） */
const BASE_WIDTH = 760;
/** 匯出固定用 16px 根字級，不受畫面「文字大小」設定影響 */
const REM = 16;
const PAD = 16;
const BG = '#ffffff';

const pad2 = (v: number) => String(v).padStart(2, '0');

function loadSvg(markup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('斷面圖轉換失敗'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

export async function exportProfilePng(result: ProfileResult, line: [LngLat, LngLat], coord: CoordDisplaySettings) {
  const family = getComputedStyle(document.documentElement).fontFamily || 'sans-serif';
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  // 斷面圖
  const chartMarkup = renderToStaticMarkup(
    <ProfileChart result={result} width={BASE_WIDTH} rem={REM} ink={PRINT_INK} fontFamily={family} />,
  );
  const chart = await loadSvg(chartMarkup);
  const chartW = chart.width;
  const chartH = chart.height;
  const W = Math.max(BASE_WIDTH, chartW);

  // 文字內容
  const sysLabel = COORD_SYSTEMS.find((s) => s.id === coord.system)?.label ?? '';
  const pt = (name: string, p: LngLat) => `${name}　${formatCoord(coord, p[0], p[1]).join('　')}`;
  const infoLines = [
    `坐標系 ${sysLabel}`,
    pt('A', line[0]),
    pt('B', line[1]),
    `剖面長 ${formatDistance(result.length)}，交會管線 ${result.pipes.length} 條${result.truncated ? '（已達上限，只列前面的）' : ''}`,
  ];
  const legend: { color: string; text: string }[] = PIPE_KINDS.filter((k) => result.pipes.some((p) => p.layer === k.id)).map(
    (k) => ({ color: k.color, text: `${k.code} ${k.name}` }),
  );
  if (result.pipes.some((p) => p.depth === null)) legend.push({ color: PIPE3D_NO_DEPTH_COLOR, text: '埋深缺值（畫在地表）' });
  const note = '標註：代碼 管材 管徑 權屬｜深度方向放大，管線依深度比例畫';

  const titleFont = `600 ${REM * 1.0625}px ${family}`;
  const textFont = `${REM * 0.8125}px ${family}`;
  const lineH = REM * 1.3;

  // 圖例排版（自動換行）
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('瀏覽器不支援 canvas');
  measure.font = textFont;
  const sw = REM * 0.7; // 色塊
  const items: { x: number; row: number; color: string; text: string }[] = [];
  let x = PAD;
  let row = 0;
  for (const it of legend) {
    const iw = sw + 6 + measure.measureText(it.text).width;
    if (x > PAD && x + iw > W - PAD) {
      x = PAD;
      row++;
    }
    items.push({ x, row, ...it });
    x += iw + REM * 1.25;
  }
  const legendRows = legend.length ? row + 1 : 0;

  // 版面高度
  const titleH = REM * 1.6;
  const headerH = PAD + titleH + infoLines.length * lineH + PAD * 0.5;
  const legendTop = headerH + chartH + PAD * 0.5;
  const H = legendTop + PAD * 0.5 + (legendRows + 1) * lineH + PAD * 0.75;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(W * SCALE);
  canvas.height = Math.ceil(H * SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('瀏覽器不支援 canvas');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';

  // 標題列
  let y = PAD + titleH / 2;
  ctx.font = titleFont;
  ctx.fillStyle = PRINT_INK.fg;
  ctx.fillText('剖面分析', PAD, y);
  ctx.font = textFont;
  ctx.fillStyle = PRINT_INK.muted;
  ctx.textAlign = 'right';
  ctx.fillText(stamp, W - PAD, y);
  ctx.textAlign = 'left';
  y = PAD + titleH + lineH / 2;
  ctx.fillStyle = PRINT_INK.fg;
  for (const t of infoLines) {
    ctx.fillText(t, PAD, y);
    y += lineH;
  }

  // 分隔線
  const rule = (yy: number) => {
    ctx.strokeStyle = PRINT_INK.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, yy + 0.5);
    ctx.lineTo(W - PAD, yy + 0.5);
    ctx.stroke();
  };
  rule(headerH - PAD * 0.25);

  // 斷面圖
  ctx.drawImage(chart, 0, headerH, chartW, chartH);
  rule(legendTop);

  // 圖例
  ctx.font = textFont;
  const legendY0 = legendTop + PAD * 0.5 + lineH / 2;
  for (const it of items) {
    const yy = legendY0 + it.row * lineH;
    ctx.fillStyle = it.color;
    ctx.fillRect(it.x, yy - sw / 2, sw, sw);
    ctx.fillStyle = PRINT_INK.fg;
    ctx.fillText(it.text, it.x + sw + 6, yy);
  }
  ctx.fillStyle = PRINT_INK.muted;
  ctx.fillText(note, PAD, legendY0 + legendRows * lineH);

  // 下載
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('產生 PNG 失敗');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `剖面分析_${stamp.replace(/[-:]/g, '').replace(' ', '-')}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
