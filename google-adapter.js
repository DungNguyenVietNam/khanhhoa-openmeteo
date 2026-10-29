/**
 * Gắn ba dạng lớp lên Google Maps JavaScript API.
 *
 * Dùng google.maps.GroundOverlay cho raster vì nó tự khớp theo toạ độ địa lý
 * và tự co giãn khi zoom — không phải tự tính pixel như OverlayView.
 * Mũi tên và điểm dùng Marker với icon dạng SVG path, xoay được bằng `rotation`.
 *
 * Mọi hàm đều trả về đối tượng có .setMap(null) để gỡ lớp.
 */
import { renderField, buildArrows, buildPoints, ARROW_PATH, arrowRotation } from './weather-render.js';

/** Lớp raster cho dữ liệu dạng field. */
export function addFieldLayer(map, grid, variable, plane, opts = {}) {
  const { canvas, bounds } = renderField(grid, variable, plane, opts);
  const overlay = new google.maps.GroundOverlay(
    canvas.toDataURL('image/png'),
    { north: bounds.latMax, south: bounds.latMin, east: bounds.lonMax, west: bounds.lonMin },
    { clickable: false, opacity: 1 },   // độ mờ đã nằm trong alpha của canvas
  );
  overlay.setMap(map);
  return overlay;
}

/** Lớp mũi tên cho dữ liệu dạng vector. */
export function addVectorLayer(map, grid, variable, speedPlane, dirPlane, { every = 2, scale = 1 } = {}) {
  const arrows = buildArrows(grid, variable, speedPlane, dirPlane, { every });
  const markers = arrows.map((a) => new google.maps.Marker({
    map,
    position: { lat: a.lat, lng: a.lon },
    clickable: false,
    icon: {
      path: ARROW_PATH,
      rotation: arrowRotation(a.dirDeg),
      fillColor: a.color, fillOpacity: 0.95,
      strokeColor: '#ffffff', strokeWeight: 0.6,
      scale: scale * 1.1,
      anchor: new google.maps.Point(0, 0),
    },
  }));
  return { setMap: (m) => markers.forEach((k) => k.setMap(m)), markers, arrows };
}

/**
 * Lớp điểm rời rạc — ví dụ lưu lượng đến từng hồ.
 * Dùng viền NÉT ĐỨT để phân biệt với marker trạm quan trắc nét liền.
 */
export function addPointLayer(map, places, variable, values, { onClick } = {}) {
  const pts = buildPoints(places, variable, values);
  const info = new google.maps.InfoWindow();
  const markers = pts.map((p) => {
    const m = new google.maps.Marker({
      map,
      position: { lat: p.lat, lng: p.lon },
      label: { text: p.text, color: '#ffffff', fontSize: '11px', fontWeight: '600' },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 15,
        fillColor: p.color, fillOpacity: 1,
        strokeColor: '#ffffff', strokeWeight: 2,
      },
      title: `${p.name}: ${p.text}`,
    });
    m.addListener('click', () => {
      if (onClick) return onClick(p);
      info.setContent(
        `<div style="font:13px system-ui;color:#222;min-width:160px">
           <b>${p.name}</b><br>${p.text} đơn vị<br>
           <span style="color:#777;font-size:11px">Dự báo mô hình — không phải số đo trạm</span>
         </div>`);
      info.open({ map, anchor: m });
    });
    return m;
  });
  return { setMap: (mm) => { markers.forEach((k) => k.setMap(mm)); if (!mm) info.close(); }, markers, points: pts };
}

/** Gắn một khối HTML làm điều khiển tuỳ biến của Google Maps. */
export function addControl(map, el, position = 'RIGHT_TOP') {
  map.controls[google.maps.ControlPosition[position]].push(el);
  return el;
}
