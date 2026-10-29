/**
 * Danh mục biến Open-Meteo và CÁCH HIỂN THỊ của từng loại.
 *
 * Mấu chốt: không phải loại dữ liệu nào cũng vẽ cùng một kiểu. Có ba dạng:
 *
 *   field   - trường vô hướng liên tục -> nội suy thành raster phủ bản đồ
 *             (mưa, nhiệt độ, độ ẩm đất, bốc hơi, bức xạ, chất lượng không khí)
 *
 *   vector  - trường có HƯỚNG -> vẽ mũi tên, raster không diễn đạt được hướng
 *             (gió, sóng)
 *
 *   point   - đại lượng gắn với một vị trí rời rạc, KHÔNG phải trường liên tục
 *             -> marker tại đúng điểm đó. Nội suy ra cả vùng là sai về bản chất
 *             (lưu lượng sông, mực nước hồ)
 */

/**
 * Bảng màu rời rạc: dùng khi có thang phân cấp chính thức cần bám đúng.
 * `max` mặc định là cận trên ĐÓNG (value <= max). Đặt `lt: true` khi chữ trong
 * chú giải là cận HỞ — ví dụ "Mưa nhỏ: < 16" thì 16 phải rơi sang bậc sau.
 */
const bands = (list) => ({ kind: 'bands', list });
/** Bảng màu liên tục: dùng khi đại lượng biến thiên trơn và không có thang quy định. */
const ramp = (stops) => ({ kind: 'ramp', stops });

export const VARIABLES = {
  // ---------- FIELD: trường vô hướng ----------
  precipitation_sum: {
    form: 'field', group: 'Mưa', label: 'Lượng mưa 24h', unit: 'mm', agg: 'daily',
    // Bám đúng Chú giải sẵn có trên bản đồ, không dùng gradient
    // color: null nghĩa là KHÔNG tô -> điểm ảnh trong suốt, lộ bản đồ nền.
    // Chỉ đúng giá trị 0 mới không tô; từ 0.001 mm trở lên đã là Mưa nhỏ.
    scale: bands([
      { max: 0,        color: null,      label: 'Không mưa' },
      { max: 16, lt: true, color: '#4fc3f7', label: 'Mưa nhỏ: < 16' },
      { max: 50,       color: '#43a047', label: 'Mưa vừa: 16 – 50' },
      { max: 100,      color: '#fb8c00', label: 'Mưa to: 51 – 100' },
      { max: Infinity, color: '#e53935', label: 'Mưa rất to: > 100' },
    ]),
  },
  temperature_2m: {
    form: 'field', group: 'Nhiệt', label: 'Nhiệt độ', unit: '°C', agg: 'hourly',
    scale: ramp([[16,'#3b6fb5'],[22,'#58b0c8'],[27,'#9ed17a'],[31,'#f2c744'],[35,'#ef7d3a'],[40,'#c6342c']]),
  },
  temperature_2m_max: {
    form: 'field', group: 'Nhiệt', label: 'Nhiệt độ cao nhất ngày', unit: '°C', agg: 'daily',
    scale: ramp([[20,'#3b6fb5'],[26,'#58b0c8'],[30,'#9ed17a'],[34,'#f2c744'],[38,'#ef7d3a'],[43,'#c6342c']]),
  },
  relative_humidity_2m: {
    form: 'field', group: 'Ẩm', label: 'Độ ẩm không khí', unit: '%', agg: 'hourly',
    scale: ramp([[30,'#d9c07a'],[50,'#cfd9a0'],[70,'#8fc8a8'],[85,'#4da3b8'],[100,'#2d5f9e']]),
  },
  soil_moisture_9_to_27cm: {
    form: 'field', group: 'Ẩm', label: 'Độ ẩm đất 9–27 cm', unit: 'm³/m³', agg: 'hourly',
    // Tầng rễ cây — chỉ thị nhu cầu tưới. Nâu = khô, xanh = đủ ẩm
    scale: ramp([[0.05,'#8c6239'],[0.12,'#bda171'],[0.20,'#9bbf8a'],[0.30,'#4a9ec4'],[0.45,'#1f5f9e']]),
  },
  et0_fao_evapotranspiration: {
    form: 'field', group: 'Bốc hơi', label: 'Bốc hơi tham chiếu ET₀', unit: 'mm', agg: 'daily',
    scale: ramp([[0,'#f2f7f5'],[2,'#ffe2a8'],[4,'#ffb85c'],[6,'#f07f2e'],[9,'#c04a18']]),
  },
  shortwave_radiation: {
    form: 'field', group: 'Bức xạ', label: 'Bức xạ sóng ngắn', unit: 'W/m²', agg: 'hourly',
    scale: ramp([[0,'#1b2430'],[200,'#4a5a74'],[500,'#b8a44e'],[800,'#f0d74e'],[1100,'#fff6c2']]),
  },
  pm2_5: {
    form: 'field', group: 'Không khí', label: 'Bụi mịn PM2.5', unit: 'µg/m³', agg: 'hourly',
    api: 'airQuality',
    // Bám thang AQI quốc tế, nên dùng bậc chứ không gradient
    scale: bands([
      { max: 12,       color: '#3bb143', label: 'Tốt: ≤ 12' },
      { max: 35.4,     color: '#f2d41f', label: 'Trung bình: 12 – 35' },
      { max: 55.4,     color: '#f08c2e', label: 'Kém: 35 – 55' },
      { max: 150.4,    color: '#e53935', label: 'Xấu: 55 – 150' },
      { max: Infinity, color: '#8e3fa0', label: 'Rất xấu: > 150' },
    ]),
  },

  // ---------- VECTOR: trường có hướng ----------
  wind_10m: {
    form: 'vector', group: 'Gió', label: 'Gió 10 m', unit: 'km/h', agg: 'hourly',
    speedKey: 'wind_speed_10m', dirKey: 'wind_direction_10m',
    scale: ramp([[0,'#9fd4e8'],[15,'#5aa9d6'],[30,'#f2c744'],[50,'#ef7d3a'],[80,'#c6342c']]),
  },
  waves: {
    form: 'vector', group: 'Biển', label: 'Sóng biển', unit: 'm', agg: 'hourly',
    api: 'marine', speedKey: 'wave_height', dirKey: 'wave_direction',
    scale: ramp([[0,'#bfe3f0'],[0.8,'#6aa9cc'],[1.6,'#3f7fae'],[2.5,'#2a5280'],[4,'#17304f']]),
  },

  // ---------- POINT: đại lượng rời rạc ----------
  river_discharge: {
    form: 'point', group: 'Dòng chảy', label: 'Lưu lượng đến', unit: 'm³/s', agg: 'daily',
    api: 'flood',
    // Mô hình GloFAS toàn cầu, độ phân giải thô. KHÔNG nội suy ra cả vùng —
    // chỉ hiển thị tại đúng vị trí hồ hoặc trạm đã khai báo.
    scale: ramp([[0,'#cfe8f5'],[25,'#6aa9cc'],[60,'#f2c744'],[120,'#ef7d3a'],[250,'#c6342c']]),
  },
};

/** Đổi giá trị thành màu CSS, hoặc null nếu không tô. */
export function colorFor(variable, value) {
  const v = VARIABLES[variable];
  if (!v || value == null) return null;
  const s = v.scale;
  if (s.kind === 'bands') {
    for (const b of s.list) {
      if (b.lt ? value < b.max : value <= b.max) return b.color;
    }
    return s.list.at(-1).color;
  }
  // ramp: nội suy tuyến tính giữa hai chặng gần nhất
  const st = s.stops;
  if (value <= st[0][0]) return st[0][1];
  if (value >= st.at(-1)[0]) return st.at(-1)[1];
  for (let i = 0; i < st.length - 1; i++) {
    const [a, ca] = st[i], [b, cb] = st[i + 1];
    if (value >= a && value <= b) return mix(ca, cb, (value - a) / (b - a));
  }
  return null;
}

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function mix(c1, c2, t) {
  const a = hex(c1), b = hex(c2);
  return '#' + a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, '0')).join('');
}

/** Các chặng để dựng chú giải. */
export function legendStops(variable) {
  const v = VARIABLES[variable];
  if (!v) return [];
  return v.scale.kind === 'bands'
    ? v.scale.list.filter((b) => b.color).map((b) => ({ color: b.color, label: b.label }))
    : v.scale.stops.map(([val, color]) => ({ color, label: `${val} ${v.unit}` }));
}
