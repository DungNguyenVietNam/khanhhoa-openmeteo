/**
 * Bản sao của google-adapter.js cho Leaflet.
 *
 * Cùng bộ vẽ trong weather-render.js, chỉ khác lớp gắn lên bản đồ. Giữ đúng
 * cùng chữ ký hàm để đổi nền bản đồ chỉ cần đổi dòng import.
 */
import { renderField, buildArrows, buildPoints, ARROW_PATH, arrowRotation } from './weather-render.js';

export function addFieldLayer(map, grid, variable, plane, opts = {}) {
  const { canvas, bounds } = renderField(grid, variable, plane, opts);
  const layer = L.imageOverlay(canvas.toDataURL('image/png'),
    [[bounds.latMin, bounds.lonMin], [bounds.latMax, bounds.lonMax]],
    { interactive: false, className: 'wx-field' });
  layer.addTo(map);
  return { setMap: (m) => (m ? layer.addTo(map) : map.removeLayer(layer)) };
}

export function addVectorLayer(map, grid, variable, speedPlane, dirPlane, { every = 2, scale = 1 } = {}) {
  const arrows = buildArrows(grid, variable, speedPlane, dirPlane, { every });
  const group = L.layerGroup();
  for (const a of arrows) {
    const size = 22 * scale;
    // dirDeg là hướng gió THỔI TỪ -> glyph chỉ về phía ngược lại
    const html = `<svg width="${size}" height="${size}" viewBox="-12 -12 24 24"
        style="transform:rotate(${arrowRotation(a.dirDeg)}deg);display:block">
        <path d="${ARROW_PATH}" fill="${a.color}" stroke="#fff" stroke-width="0.6"/></svg>`;
    L.marker([a.lat, a.lon], {
      icon: L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] }),
      interactive: false,
    }).addTo(group);
  }
  group.addTo(map);
  return { setMap: (m) => (m ? group.addTo(map) : map.removeLayer(group)), arrows };
}

export function addPointLayer(map, places, variable, values, { unit = '' } = {}) {
  const pts = buildPoints(places, variable, values);
  const group = L.layerGroup();
  for (const p of pts) {
    // Viền NÉT ĐỨT: phân biệt với marker trạm quan trắc nét liền
    const html = `<div style="width:34px;height:34px;border-radius:50%;background:${p.color};
        border:2px dashed #fff;display:flex;align-items:center;justify-content:center;
        color:#fff;font:600 11px/1 system-ui;box-shadow:0 1px 5px rgba(0,0,0,.55)">${p.text}</div>`;
    L.marker([p.lat, p.lon], { icon: L.divIcon({ html, className: '', iconSize: [34, 34] }) })
      .bindPopup(`<b>${p.name}</b><br>${p.text} ${unit}<br>
                  <span style="color:#777;font-size:11px">Dự báo mô hình — không phải số đo trạm</span>`)
      .addTo(group);
  }
  group.addTo(map);
  return { setMap: (m) => (m ? group.addTo(map) : map.removeLayer(group)), points: pts };
}
