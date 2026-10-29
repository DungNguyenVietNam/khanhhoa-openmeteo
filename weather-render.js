/**
 * Ba bộ vẽ cho ba dạng dữ liệu, không phụ thuộc thư viện bản đồ.
 * Mỗi hàm trả về một thứ thuần tuý (canvas, mảng mũi tên, mảng điểm),
 * phần gắn lên bản đồ để các adapter lo.
 */
import { VARIABLES, colorFor } from './weather-vars.js';

/* ============ 1. FIELD -> raster nội suy ============ */

/** Nội suy song tuyến một ô lưới đều. */
export function bilinear(grid, plane, lat, lon) {
  const { lats, lons } = grid;
  if (lat < lats[0] || lat > lats.at(-1) || lon < lons[0] || lon > lons.at(-1)) return null;
  const sLat = lats[1] - lats[0], sLon = lons[1] - lons[0];
  const fi = (lat - lats[0]) / sLat, fj = (lon - lons[0]) / sLon;
  const i0 = Math.min(Math.floor(fi), lats.length - 2);
  const j0 = Math.min(Math.floor(fj), lons.length - 2);
  const ty = fi - i0, tx = fj - j0;
  const q = [plane[i0][j0], plane[i0][j0 + 1], plane[i0 + 1][j0], plane[i0 + 1][j0 + 1]];
  if (q.some((v) => v == null)) return null;   // thiếu góc nào thì bỏ, không đoán
  const [a, b, c, d] = q;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * @returns {{canvas, bounds}} canvas phủ đúng khung lưới
 */
export function renderField(grid, variable, plane, { pxPerDeg = 300, alpha = 0.55 } = {}) {
  const latMin = grid.lats[0], latMax = grid.lats.at(-1);
  const lonMin = grid.lons[0], lonMax = grid.lons.at(-1);
  const w = Math.max(2, Math.round((lonMax - lonMin) * pxPerDeg));
  const h = Math.max(2, Math.round((latMax - latMin) * pxPerDeg));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const A = Math.round(alpha * 255);

  for (let y = 0; y < h; y++) {
    const lat = latMax - (y + 0.5) / h * (latMax - latMin);  // hàng 0 là mép bắc
    for (let x = 0; x < w; x++) {
      const lon = lonMin + (x + 0.5) / w * (lonMax - lonMin);
      const v = bilinear(grid, plane, lat, lon);
      const p = (y * w + x) * 4;
      const col = colorFor(variable, v);
      if (!col) { img.data[p + 3] = 0; continue; }
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(col.slice(i, i + 2), 16));
      img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = A;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, bounds: { latMin, latMax, lonMin, lonMax } };
}

/* ============ 2. VECTOR -> mũi tên ============ */

/**
 * Thưa hoá lưới thành các mũi tên. Vẽ mũi tên ở mọi ô sẽ rối, nên lấy mẫu
 * cách `every` ô một lần.
 * @returns {{lat,lon,speed,dirDeg,color}[]}
 */
export function buildArrows(grid, variable, speedPlane, dirPlane, { every = 2 } = {}) {
  const out = [];
  for (let i = 0; i < grid.lats.length; i += every) {
    for (let j = 0; j < grid.lons.length; j += every) {
      const sp = speedPlane[i][j], dir = dirPlane[i][j];
      if (sp == null || dir == null) continue;
      out.push({
        lat: grid.lats[i], lon: grid.lons[j],
        speed: sp, dirDeg: dir,
        color: colorFor(variable, sp) ?? '#888',
      });
    }
  }
  return out;
}

/**
 * Ký hiệu mũi tên dạng SVG path, gốc toạ độ ở tâm.
 * Quy ước khí tượng: dirDeg là hướng gió THỔI TỪ, nên mũi tên chỉ về
 * hướng ngược lại (dirDeg + 180).
 */
export const ARROW_PATH = 'M 0,-9 L 3,-2 L 1.1,-2 L 1.1,9 L -1.1,9 L -1.1,-2 L -3,-2 Z';
export const arrowRotation = (dirDeg) => (dirDeg + 180) % 360;

/* ============ 3. POINT -> marker rời rạc ============ */

/**
 * Ghép giá trị vào danh sách vị trí đã biết (hồ, trạm).
 * KHÔNG nội suy — dữ liệu dạng point gắn với đúng vị trí đó.
 * @param {{code,name,lat,lon}[]} places
 * @param {Map<string, number|null>} values  code -> giá trị
 */
export function buildPoints(places, variable, values) {
  return places.map((p) => {
    const v = values.get(p.code) ?? null;
    return { ...p, value: v, color: colorFor(variable, v) ?? '#8a9aa0',
             text: v == null ? '—' : (v >= 100 ? v.toFixed(0) : v.toFixed(1)) };
  });
}

/* ============ chú giải dùng chung ============ */
export function legendFor(variable, { issuedAt, period } = {}) {
  const v = VARIABLES[variable];
  if (!v) return '';
  const stops = v.scale.kind === 'bands'
    ? v.scale.list.filter((b) => b.color).map((b) => [b.color, b.label])
    : v.scale.stops.map(([val, c]) => [c, `${val} ${v.unit}`]);
  const rows = stops.map(([c, l]) => `
    <div style="display:flex;align-items:center;gap:7px;padding:1px 0">
      <span style="width:13px;height:13px;background:${c};flex:0 0 auto;border-radius:2px"></span>
      <span style="font-size:11.5px">${l}</span>
    </div>`).join('');
  const t = issuedAt ? new Date(issuedAt).toLocaleString('vi-VN') : '';
  return `<div>
    <div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;opacity:.65;margin-bottom:5px">
      ${v.label}${v.unit ? ` (${v.unit})` : ''}${period ? ` · ${period}` : ''}
    </div>
    ${rows}
    <div style="font-size:10.5px;opacity:.6;margin-top:6px">
      Số mô hình dự báo, không phải số đo trạm${t ? `<br>Lấy lúc ${t}` : ''}<br>
      Nguồn: <a href="https://open-meteo.com/" target="_blank" rel="noopener" style="color:inherit">Open-Meteo</a> · CC-BY 4.0
    </div>
  </div>`;
}
