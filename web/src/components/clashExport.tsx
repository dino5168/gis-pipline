// 衝突檢核匯出 Excel（.xlsx，exceljs）：
// 工作表「衝突檢核」＝規劃管線參數、檢核結果統計、說明＋沿規劃管線的縱剖面圖（PNG 圖片）；
// 「衝突清單」＝視窗表格＋衝突位置坐標（TWD97 與經緯度）；「規劃管線頂點」＝各頂點坐標與累計距離。
// 剖面圖用 ProfileChart（淺色配色＋規劃管線＋檢核淨距範圍）繪成 SVG，再畫到 canvas 轉 PNG。
// 本檔由 ClashWindow 動態 import（含 exceljs、react-dom/server），不進主 bundle。
import { Workbook, type Worksheet } from 'exceljs';
import { renderToStaticMarkup } from 'react-dom/server';
import { PIPE3D_NO_DEPTH_COLOR } from '../config';
import { CLASH_PLAN_COLOR } from '../map/clashTool';
import { lngLatToTwd97 } from '../map/coordTransform';
import { CLASH_SEVERITY, type ClashParams, type ClashPipe, type ClashResult, type ClashSeverity } from '../types/clash';
import { PIPE_KINDS, PIPE_KIND_BY_ID, type PipeKindId } from '../types/pipeKind';
import { formatSize, type LngLat, type ProfilePipe, type ProfileResult } from '../types/profile';
import { PRINT_INK, ProfileChart } from './ProfileChart';

const SCALE = 2;
/** 剖面圖基準寬度（px；衝突多時會再加寬） */
const BASE_WIDTH = 900;
const REM = 16;
const PAD = 16;
const NOTE = '淨距為負值＝該方向重疊；依資料埋深推算，僅供篩檢，開挖前仍需現場確認';

const pad2 = (v: number) => String(v).padStart(2, '0');
/** Excel 顏色（ARGB） */
const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;

function loadSvg(markup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('剖面圖轉換失敗'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

/** 沿規劃管線的縱剖面圖＋圖例 → PNG（data URL）與顯示尺寸（px） */
async function renderChart(result: ClashResult, params: ClashParams) {
  const family = getComputedStyle(document.documentElement).fontFamily || 'sans-serif';
  // 圖上依距起點排序，標註序號對應衝突清單
  const order = result.clashes.map((c, i) => ({ c, no: i + 1 })).sort((a, b) => a.c.dist - b.c.dist);
  const chartData: ProfileResult = {
    length: result.length,
    truncated: result.truncated,
    pipes: order.map(({ c }): ProfilePipe => ({ ...c, overlap: false })),
  };
  const markup = renderToStaticMarkup(
    <ProfileChart
      result={chartData}
      width={BASE_WIDTH}
      rem={REM}
      ink={PRINT_INK}
      fontFamily={family}
      plan={{ startDep: params.startDep, endDep: params.endDep, dia: params.diaMm / 1000, clearance: params.clearance, color: CLASH_PLAN_COLOR }}
      numbers={order.map((o) => o.no)}
      marks={order.map((o) => CLASH_SEVERITY[o.c.severity].color)}
    />,
  );
  const chart = await loadSvg(markup);
  const W = Math.max(BASE_WIDTH, chart.width);

  // 圖例：規劃管線、淨距範圍、管線種類、狀態外圈
  type Item = { text: string; color: string; shape: 'box' | 'dash' | 'ring' };
  const legend: Item[] = [
    { text: '規劃管線', color: CLASH_PLAN_COLOR, shape: 'box' },
    { text: `檢核淨距 ${params.clearance} m 範圍`, color: CLASH_PLAN_COLOR, shape: 'dash' },
    ...PIPE_KINDS.filter((k) => result.clashes.some((c) => c.layer === k.id)).map(
      (k): Item => ({ text: `${k.code} ${k.name}`, color: k.color, shape: 'box' }),
    ),
  ];
  if (result.clashes.some((c) => c.depth === null)) legend.push({ text: '埋深缺值（畫在地表）', color: PIPE3D_NO_DEPTH_COLOR, shape: 'box' });
  for (const s of Object.keys(CLASH_SEVERITY) as ClashSeverity[])
    if (result.clashes.some((c) => c.severity === s)) legend.push({ text: `外圈：${CLASH_SEVERITY[s].label}`, color: CLASH_SEVERITY[s].color, shape: 'ring' });
  const note = '標註：序號（對應衝突清單） 代碼 管材 管徑 權屬｜X＝距規劃管線起點（m），Y＝管頂埋深（地表 = 0）｜深度方向放大';

  const textFont = `${REM * 0.8125}px ${family}`;
  const lineH = REM * 1.3;
  const sw = REM * 0.7;
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('瀏覽器不支援 canvas');
  measure.font = textFont;
  const items: (Item & { x: number; row: number })[] = [];
  let x = PAD;
  let row = 0;
  for (const it of legend) {
    const iw = sw + 6 + measure.measureText(it.text).width;
    if (x > PAD && x + iw > W - PAD) {
      x = PAD;
      row++;
    }
    items.push({ ...it, x, row });
    x += iw + REM * 1.25;
  }
  const legendTop = chart.height + PAD * 0.5;
  const H = legendTop + (row + 2) * lineH + PAD * 0.5;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(W * SCALE);
  canvas.height = Math.ceil(H * SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('瀏覽器不支援 canvas');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(chart, 0, 0, chart.width, chart.height);
  ctx.textBaseline = 'middle';
  ctx.font = textFont;
  for (const it of items) {
    const yy = legendTop + lineH / 2 + it.row * lineH;
    if (it.shape === 'box') {
      ctx.fillStyle = it.color;
      ctx.fillRect(it.x, yy - sw / 2, sw, sw);
    } else {
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(it.shape === 'dash' ? [3, 2] : []);
      ctx.beginPath();
      if (it.shape === 'dash') ctx.rect(it.x, yy - sw / 2, sw, sw);
      else ctx.arc(it.x + sw / 2, yy, sw / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = PRINT_INK.fg;
    ctx.fillText(it.text, it.x + sw + 6, yy);
  }
  ctx.fillStyle = PRINT_INK.muted;
  ctx.fillText(note, PAD, legendTop + lineH / 2 + (row + 1) * lineH);
  return { dataUrl: canvas.toDataURL('image/png'), width: W, height: H };
}

/** 表頭列：粗體、淺灰底、凍結、篩選 */
function header(ws: Worksheet, cols: { header: string; key: string; width: number; fmt?: string }[]) {
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EDF0' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}

export async function exportClashXlsx(result: ClashResult, line: LngLat[], params: ClashParams, layers: PipeKindId[]) {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const chart = await renderChart(result, params);

  const wb = new Workbook();
  wb.created = now;

  // ── 工作表 1：摘要＋剖面圖 ──
  const ws = wb.addWorksheet('衝突檢核');
  ws.getColumn(1).width = 20;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 8;
  ws.addRow(['管線衝突檢核']).font = { bold: true, size: 14 };
  ws.addRow(['匯出時間', stamp]);
  ws.addRow([]);
  const section = (t: string) => {
    ws.addRow([t]).font = { bold: true };
  };
  const kv = (k: string, v: string | number, unit = '', fmt?: string) => {
    const r = ws.addRow([k, v, unit]);
    if (fmt) r.getCell(2).numFmt = fmt;
    r.getCell(2).alignment = { horizontal: typeof v === 'number' ? 'right' : 'left' };
  };
  section('規劃管線參數');
  kv('管徑 Ø', params.diaMm, 'mm');
  kv('起點管頂埋深', params.startDep, 'm', '0.00');
  kv('終點管頂埋深', params.endDep, 'm', '0.00');
  kv('檢核淨距（水平／垂直）', params.clearance, 'm', '0.00');
  kv('檢核管線種類', layers.map((id) => PIPE_KIND_BY_ID[id]?.name ?? id).join('、'));
  kv('頂點數', line.length, '點');
  ws.addRow([]);
  section('檢核結果');
  kv('規劃管線長度', result.length, 'm', '0.00');
  kv('比對既有管線', result.checked, '條');
  kv('疑似衝突', result.clashes.length, '條');
  for (const s of Object.keys(CLASH_SEVERITY) as ClashSeverity[]) {
    kv(`　${CLASH_SEVERITY[s].label}`, result.clashes.filter((c) => c.severity === s).length, '條');
    const cell = ws.lastRow?.getCell(1);
    if (cell) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(CLASH_SEVERITY[s].color) } };
  }
  if (result.truncated) kv('備註', '已達上限，只列前面的');
  ws.addRow([]);
  section('說明');
  ws.addRow([NOTE]);
  ws.addRow(['規劃管線管頂埋深由起點線性變化到終點；既有管線取最接近規劃管線處的埋深']);
  ws.addRow([]);
  section('沿規劃管線剖面圖');
  const imgRow = ws.rowCount; // 0 起算的列索引＝下一列
  const img = wb.addImage({ base64: chart.dataUrl, extension: 'png' });
  ws.addImage(img, { tl: { col: 0, row: imgRow }, ext: { width: chart.width, height: chart.height } });

  // ── 工作表 2：衝突清單 ──
  const wl = wb.addWorksheet('衝突清單');
  header(wl, [
    { header: '序號', key: 'no', width: 6 },
    { header: '狀態', key: 'sev', width: 10 },
    { header: '種類', key: 'kind', width: 16 },
    { header: '管線編號', key: 'pipe_no', width: 16 },
    { header: 'gid', key: 'gid', width: 9 },
    { header: '管材', key: 'material', width: 10 },
    { header: '管徑', key: 'size', width: 16 },
    { header: '權屬', key: 'mgmt', width: 14 },
    { header: '既有管頂深 (m)', key: 'depth', width: 14, fmt: '0.00' },
    { header: '埋深註記', key: 'dnote', width: 10 },
    { header: '規劃管頂深 (m)', key: 'plan', width: 14, fmt: '0.00' },
    { header: '水平淨距 (m)', key: 'hgap', width: 13, fmt: '0.00' },
    { header: '垂直淨距 (m)', key: 'vgap', width: 13, fmt: '0.00' },
    { header: '距起點 (m)', key: 'dist', width: 11, fmt: '0.0' },
    { header: 'TWD97 X', key: 'x', width: 13, fmt: '0.000' },
    { header: 'TWD97 Y', key: 'y', width: 13, fmt: '0.000' },
    { header: '經度', key: 'lng', width: 13, fmt: '0.0000000' },
    { header: '緯度', key: 'lat', width: 12, fmt: '0.0000000' },
  ]);
  result.clashes.forEach((c: ClashPipe, i) => {
    const [x, y] = lngLatToTwd97(c.lng, c.lat);
    const sev = CLASH_SEVERITY[c.severity];
    const r = wl.addRow({
      no: i + 1,
      sev: sev.label,
      kind: PIPE_KIND_BY_ID[c.layer]?.name ?? c.layer,
      pipe_no: c.pipe_no ?? '',
      gid: c.gid,
      material: c.material ?? '',
      size: formatSize(c),
      mgmt: c.mgmt_unit ?? '',
      depth: c.depth,
      dnote: c.depth === null ? '缺值' : c.clamped ? '異常' : '',
      plan: c.plan_depth,
      hgap: c.h_gap,
      vgap: c.v_gap,
      dist: c.dist,
      x,
      y,
      lng: c.lng,
      lat: c.lat,
    });
    r.getCell('sev').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(sev.color) } };
    const red = { color: { argb: 'FFC92A2A' } };
    if (c.h_gap < 0) r.getCell('hgap').font = red;
    if (c.v_gap !== null && c.v_gap < 0) r.getCell('vgap').font = red;
  });
  if (!result.clashes.length) wl.addRow({ no: '', sev: '未發現衝突' });

  // ── 工作表 3：規劃管線頂點 ──
  const wv = wb.addWorksheet('規劃管線頂點');
  header(wv, [
    { header: '序號', key: 'no', width: 6 },
    { header: 'TWD97 X', key: 'x', width: 13, fmt: '0.000' },
    { header: 'TWD97 Y', key: 'y', width: 13, fmt: '0.000' },
    { header: '經度', key: 'lng', width: 13, fmt: '0.0000000' },
    { header: '緯度', key: 'lat', width: 12, fmt: '0.0000000' },
    { header: '累計距離 (m)', key: 'acc', width: 13, fmt: '0.00' },
  ]);
  let acc = 0;
  let prev: [number, number] | null = null;
  line.forEach(([lng, lat], i) => {
    const xy = lngLatToTwd97(lng, lat);
    if (prev) acc += Math.hypot(xy[0] - prev[0], xy[1] - prev[1]);
    prev = xy;
    wv.addRow({ no: i + 1, x: xy[0], y: xy[1], lng, lat, acc });
  });

  // 下載
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `衝突檢核_${stamp.replace(/[-:]/g, '').replace(' ', '-')}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
