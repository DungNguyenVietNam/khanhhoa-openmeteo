/**
 * Nối tầng dữ liệu Open-Meteo vào vỏ giao diện, và dựng panel điều khiển
 * cho TOÀN BỘ các lớp lấy được từ API.
 *
 * khanhhoa.html là vỏ trung lập — nó không biết gì về Open-Meteo. File này là
 * bên duy nhất biết, nên đổi nguồn dữ liệu sau này chỉ phải sửa ở đây.
 *
 * Ba dạng dữ liệu, ba cách vẽ khác nhau (xem brief/OPEN-METEO-FACTS.md):
 *   field  -> raster nội suy phủ bản đồ   (mưa, nhiệt, ẩm, bốc hơi, bức xạ, bụi)
 *   vector -> mũi tên có hướng             (gió, sóng — raster không thể hiện hướng)
 *   point  -> marker tại đúng vị trí       (lưu lượng đến từng hồ)
 *
 * Nạp SAU khanhhoa.html, dạng <script type="module">.
 */
import { fetchFieldGrid, fetchPointValues } from './openmeteo-fetch.js';
import { VARIABLES } from './weather-vars.js';
import { renderField, buildArrows, ARROW_PATH, arrowRotation, legendFor } from './weather-render.js';
import { classifyRain } from './rain-class.js';

const pam = window.__pam;
if (!pam) throw new Error('[tích hợp] Không thấy window.__pam — khanhhoa.html phải nạp trước.');

/* ========================= cấu hình lớp ========================= */

/** Lớp raster — mỗi lúc chỉ hiện MỘT, vì chồng hai raster lên nhau thì không đọc được. */
const RASTER = [
  { key: 'precipitation_sum',          ten: 'Lượng mưa 24h' },
  { key: 'temperature_2m_max',         ten: 'Nhiệt độ cao nhất ngày' },
  { key: 'temperature_2m',             ten: 'Nhiệt độ theo giờ' },
  { key: 'relative_humidity_2m',       ten: 'Độ ẩm không khí' },
  { key: 'soil_moisture_9_to_27cm',    ten: 'Độ ẩm đất 9–27 cm' },
  { key: 'et0_fao_evapotranspiration', ten: 'Bốc hơi tham chiếu ET₀' },
  { key: 'shortwave_radiation',        ten: 'Bức xạ sóng ngắn' },
  { key: 'pm2_5',                      ten: 'Bụi mịn PM2.5' },
];

/** Lớp mũi tên — chồng lên raster được vì chúng không che nhau. */
const MUITEN = [
  { key: 'wind_10m', ten: 'Gió 10 m' },
  { key: 'waves',    ten: 'Sóng biển', ghiChu: 'chỉ có số ngoài biển' },
];

/* ========================= trạng thái ========================= */

const SO_NGAY = 3;

/**
 * Đổi chỉ số NGÀY của thanh trượt thành chỉ số trong mặt phẳng dữ liệu.
 * Biến theo ngày có 3 mốc; biến theo giờ có 72. Lấy 12h trưa của ngày đó cho
 * biến theo giờ — nửa đêm thì bức xạ luôn bằng 0, nhìn như mất dữ liệu.
 */
function chiSo(plane, ngay) {
  if (!plane) return 0;
  return plane.length > SO_NGAY ? Math.min(ngay * 24 + 12, plane.length - 1)
                                : Math.min(ngay, plane.length - 1);
}

let luoi = null;          // lưới đã tải, dùng chung cho mọi lớp
let dangTai = false;
let rasterHienTai = null; // layer object đang vẽ
let muiTenHienTai = {};   // key -> layer
let diemHienTai = null;
let luuLuong = null;      // dữ liệu river_discharge

const el = (t, a = {}, ...con) => {
  const n = document.createElement(t);
  for (const [k, v] of Object.entries(a)) {
    if (k === 'class') n.className = v; else if (k === 'html') n.innerHTML = v; else n.setAttribute(k, v);
  }
  con.forEach((c) => n.append(c));
  return n;
};

/* ========================= dựng panel ========================= */

function dungPanel() {
  // Vỏ có sẵn một checkbox "Dự báo mưa 24h" cho một lớp duy nhất. Giờ có 11 lớp
  // nên ẩn nó đi, tránh hai chỗ điều khiển chồng nhau gây mâu thuẫn trạng thái.
  const cu = document.getElementById('chk-forecast');
  if (cu) {
    // Dùng style.display chứ KHÔNG dùng thuộc tính `hidden`: quy tắc
    // .opt{display:flex} trong vỏ ghi đè display:none của UA stylesheet,
    // nên đặt hidden thôi thì hàng vẫn hiện ra.
    const an = (e) => { if (e) e.style.display = 'none'; };
    const row = cu.closest('.opt');
    an(row);
    const hint = row?.nextElementSibling;
    if (hint?.classList.contains('hint')) an(hint);
    const hr = row?.previousElementSibling;
    if (hr?.classList.contains('hr')) an(hr);
    cu.checked = false;   // tránh vỏ tự vẽ lớp cũ khi khởi động
  }

  const body = el('div', { class: 'p-body' });

  body.append(el('p', { class: 'hint', style: 'margin:0 0 6px' },
    'Dữ liệu mô hình dự báo, không phải số đo trạm.'));

  // --- raster ---
  body.append(el('div', { class: 'grp-t', style: 'font-size:11px;letter-spacing:.05em;text-transform:uppercase;opacity:.6;margin:6px 0 4px' },
    'Lớp phủ (chọn một)'));
  const radio = (id, ten, val) => {
    const inp = el('input', { class: 'rad', type: 'radio', name: 'om-raster', id });
    inp.value = val;
    inp.addEventListener('change', () => veLai());
    return el('label', { class: 'opt' }, inp, el('span', {}, ten));
  };
  const r0 = radio('om-none', 'Không hiện', '');
  r0.querySelector('input').checked = true;
  body.append(r0);
  RASTER.forEach((r) => body.append(radio('om-' + r.key, r.ten, r.key)));

  // --- mũi tên + điểm ---
  body.append(el('div', { class: 'hr' }));
  body.append(el('div', { class: 'grp-t', style: 'font-size:11px;letter-spacing:.05em;text-transform:uppercase;opacity:.6;margin:6px 0 4px' },
    'Lớp chồng thêm'));
  const check = (id, ten, ghiChu, onChange) => {
    const inp = el('input', { class: 'chk', type: 'checkbox', id });
    inp.addEventListener('change', onChange);
    const lab = el('label', { class: 'opt' }, inp, el('span', {}, ten));
    const wrap = el('div', {}, lab);
    if (ghiChu) wrap.append(el('p', { class: 'hint', style: 'margin:0 0 2px 24px' }, ghiChu));
    return wrap;
  };
  MUITEN.forEach((m) => body.append(check('om-' + m.key, m.ten, m.ghiChu, () => veLai())));
  body.append(check('om-river', 'Lưu lượng đến từng hồ', 'mô hình GloFAS, không thay trạm đo', () => veLai()));

  // --- thời điểm + độ mờ ---
  body.append(el('div', { class: 'hr' }));
  const tLab = el('p', { class: 'hint', id: 'om-tlab', style: 'margin:2px 0 2px' }, '—');
  const t = el('input', { type: 'range', id: 'om-t', min: '0', max: '0', value: '0', step: '1',
    style: 'width:100%;accent-color:var(--emerald)' });
  t.addEventListener('input', () => veLai());
  body.append(el('div', { class: 'grp-t', style: 'font-size:11px;letter-spacing:.05em;text-transform:uppercase;opacity:.6;margin:6px 0 2px' }, 'Thời điểm'), t, tLab);

  const op = el('input', { type: 'range', id: 'om-op', min: '15', max: '100', value: '55', step: '5',
    style: 'width:100%;accent-color:var(--emerald)' });
  op.addEventListener('input', () => veLai());
  body.append(el('div', { class: 'grp-t', style: 'font-size:11px;letter-spacing:.05em;text-transform:uppercase;opacity:.6;margin:8px 0 2px' }, 'Độ mờ lớp phủ'), op);

  const head = el('div', { class: 'p-head' },
    el('h2', {}, 'Dữ liệu Open-Meteo'),
    el('button', { class: 'collapse', 'data-collapse': 'panel-openmeteo',
      'aria-expanded': 'true', 'aria-label': 'Thu gọn panel Dữ liệu Open-Meteo' }, '−'));
  const panel = el('section', { class: 'panel', id: 'panel-openmeteo' }, head, body);

  document.querySelector('.right-dock')?.append(panel);

  // Nút thu gọn của vỏ gắn theo data-collapse; panel này thêm sau nên tự nối.
  head.querySelector('button').addEventListener('click', (e) => {
    const b = e.currentTarget;
    const mo = b.getAttribute('aria-expanded') === 'true';
    panel.classList.toggle('collapsed', mo);
    b.setAttribute('aria-expanded', String(!mo));
    b.textContent = mo ? '+' : '−';
  });
}

/* ========================= tải dữ liệu ========================= */

const $ = (id) => document.getElementById(id);
const dangChon = () => document.querySelector('input[name=om-raster]:checked')?.value || '';
const bat = (id) => !!$(id)?.checked;

/** Biến nào đang cần? Chỉ tải đúng thứ đang bật, không tải thừa. */
function bienCanTai() {
  const ds = new Set();
  const r = dangChon(); if (r) ds.add(r);
  MUITEN.forEach((m) => bat('om-' + m.key) && ds.add(m.key));
  return [...ds];
}

async function baoDamCoDuLieu() {
  const can = bienCanTai();
  const thieu = can.filter((k) => {
    const v = VARIABLES[k];
    const keys = v.form === 'vector' ? [v.speedKey, v.dirKey] : [k];
    return keys.some((n) => !luoi?.planes?.[n]);
  });

  if (thieu.length) {
    const daCo = luoi ? Object.keys(luoi.planes) : [];
    pam.setStatus('Đang tải dữ liệu Open-Meteo…');
    const them = await fetchFieldGrid({
      bbox: pam.bbox, step: 0.1, days: 3,
      // CHỈ tải biến còn thiếu. Tải lại cả cụm mỗi lần bật thêm một lớp sẽ
      // đốt hạn mức rất nhanh — mỗi điểm tính một lượt gọi.
      variables: thieu,
      // Mỗi ĐIỂM tính một lượt gọi, trần 600/phút. Nếu phải chờ thì nói ra,
      // đừng để trang trông như treo.
      onCho: (giay) => pam.setStatus(
        `Đang chờ ${giay} giây cho đủ ngân sách gọi Open-Meteo (mỗi điểm tính một lượt)…`),
    });
    luoi = luoi ? { ...them, planes: { ...luoi.planes, ...them.planes } } : them;
    if (daCo.length) luoi.planes = { ...luoi.planes };
  }

  if (bat('om-river') && !luuLuong) {
    pam.setStatus('Đang tải lưu lượng đến…');
    const p = await fetchPointValues(pam.reservoirs, { days: 3 });
    luuLuong = p;
  }

  // Thanh trượt luôn tính theo NGÀY (0..2), không theo mốc giờ.
  const t = $('om-t');
  if (t && +t.max !== SO_NGAY - 1) {
    t.max = String(SO_NGAY - 1);
    t.value = String(Math.min(+t.value, SO_NGAY - 1));
  }
}

/* ========================= vẽ ========================= */

/** Nhãn ngày cho thanh trượt. times có thể là ngày hoặc giờ tuỳ nhóm tải trước. */
function nhanNgay(ngay) {
  const ts = luoi?.times ?? [];
  if (!ts.length) return '—';
  const s = ts.length > SO_NGAY ? ts[Math.min(ngay * 24 + 12, ts.length - 1)] : ts[Math.min(ngay, ts.length - 1)];
  return String(s).slice(0, 10);
}

function go(layer) { try { layer?.setMap?.(null); } catch {} return null; }

async function veLai() {
  if (dangTai) return;
  const coGi = dangChon() || MUITEN.some((m) => bat('om-' + m.key)) || bat('om-river');

  rasterHienTai = go(rasterHienTai);
  Object.keys(muiTenHienTai).forEach((k) => { muiTenHienTai[k] = go(muiTenHienTai[k]); });
  muiTenHienTai = {};
  diemHienTai = go(diemHienTai);
  pam.setLegendExtra('');

  if (!coGi) { pam.setStatus('Chưa bật lớp Open-Meteo nào.'); return; }

  dangTai = true;
  try {
    await baoDamCoDuLieu();
    const t = +($('om-t')?.value ?? 0);
    const alpha = +($('om-op')?.value ?? 55) / 100;
    const map = pam.map;
    const L = window.L;

    $('om-tlab').textContent = nhanNgay(t);

    // --- raster ---
    const rk = dangChon();
    if (rk) {
      const mat = luoi.planes[rk]?.[chiSo(luoi.planes[rk], t)];
      if (mat) {
        const { canvas, bounds } = renderField(luoi, rk, mat, { pxPerDeg: 400, alpha });
        rasterHienTai = taoAnh(L, map, canvas, bounds);
      }
    }

    // --- mũi tên ---
    for (const m of MUITEN) {
      if (!bat('om-' + m.key)) continue;
      const v = VARIABLES[m.key];
      const sp = luoi.planes[v.speedKey], dr = luoi.planes[v.dirKey];
      if (!sp || !dr) continue;
      const i = chiSo(sp, t);
      muiTenHienTai[m.key] = taoMuiTen(L, map, buildArrows(luoi, m.key, sp[i], dr[i], { every: 2 }));
    }

    // --- điểm lưu lượng ---
    if (bat('om-river') && luuLuong) {
      diemHienTai = taoDiem(L, map, t);
    }

    chuGiai(rk, t);
    const sd = luoi.lats.length * luoi.lons.length;
    pam.setStatus(`Open-Meteo · lưới ${luoi.lats.length}×${luoi.lons.length} (${sd} điểm) · ${nhanNgay(t)}`);
  } catch (e) {
    pam.setStatus('Lỗi tải dữ liệu: ' + e.message, true);
  } finally {
    dangTai = false;
  }
}

function taoAnh(L, map, canvas, b) {
  const lay = L.imageOverlay(canvas.toDataURL('image/png'),
    [[b.latMin, b.lonMin], [b.latMax, b.lonMax]], { interactive: false, className: 'om-field' });
  lay.addTo(map);
  return { setMap: (m) => (m ? lay.addTo(map) : map.removeLayer(lay)) };
}

function taoMuiTen(L, map, arrows) {
  const g = L.layerGroup();
  for (const a of arrows) {
    const html = `<svg width="22" height="22" viewBox="-12 -12 24 24"
        style="transform:rotate(${arrowRotation(a.dirDeg)}deg);display:block">
        <path d="${ARROW_PATH}" fill="${a.color}" stroke="#fff" stroke-width="0.6"/></svg>`;
    L.marker([a.lat, a.lon], { interactive: false,
      icon: L.divIcon({ html, className: '', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(g);
  }
  g.addTo(map);
  return { setMap: (m) => (m ? g.addTo(map) : map.removeLayer(g)) };
}

function taoDiem(L, map, t) {
  const g = L.layerGroup();
  pam.reservoirs.forEach((h, i) => {
    const v = luuLuong.byIndex[i]?.[Math.min(t, (luuLuong.times?.length ?? 1) - 1)] ?? null;
    const txt = v == null ? '—' : (v >= 100 ? v.toFixed(0) : v.toFixed(1));
    // Viền NÉT ĐỨT: đây là số dự báo, không phải số đo trạm.
    const html = `<div style="min-width:34px;height:26px;padding:0 6px;border-radius:13px;
        background:#0ea5e9;border:2px dashed #fff;display:flex;align-items:center;
        justify-content:center;color:#fff;font:600 11px/1 system-ui;
        box-shadow:0 1px 5px rgba(0,0,0,.45)">${txt}</div>`;
    L.marker([h.lat, h.lon], { icon: L.divIcon({ html, className: '', iconSize: [40, 26] }) })
      .bindPopup(`<b>${h.name}</b><br>Lưu lượng đến dự báo: <b>${txt} m³/s</b><br>
        <span style="color:#777;font-size:11px">Mô hình GloFAS — không thay số đo trạm</span>`)
      .addTo(g);
  });
  g.addTo(map);
  return { setMap: (m) => (m ? g.addTo(map) : map.removeLayer(g)) };
}

function chuGiai(rk, t) {
  const luc = new Date(luoi?.fetchedAt ?? Date.now()).toLocaleString('vi-VN');
  let html = '';
  // Vỏ đã có sẵn thang mưa trong Chú giải, nên chỉ thêm thang của lớp KHÁC mưa.
  if (rk && rk !== 'precipitation_sum') html += legendFor(rk, { period: nhanNgay(t) });
  html += `<div style="font-size:11.5px;line-height:1.5;color:#64748b;margin-top:8px;
      padding-top:8px;border-top:1px solid #e2e8f0">
      Số mô hình dự báo, không phải số đo trạm<br>Lấy lúc ${luc}<br>
      Nguồn: <a href="https://open-meteo.com/" target="_blank" rel="noopener"
      style="color:inherit">Open-Meteo</a> · CC-BY 4.0</div>`;
  pam.setLegendExtra(html);
}

/* ========================= khởi động ========================= */
dungPanel();
pam.onReady(() => veLai());
