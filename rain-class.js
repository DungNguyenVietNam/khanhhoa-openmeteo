/**
 * Thang phân cấp mưa theo đúng Chú giải sẵn có trên bản đồ.
 *
 * KHÔNG phụ thuộc nguồn dữ liệu. Đầu vào luôn là mm trong 24 giờ, nên nguồn nào
 * trả theo bước ngắn hơn thì cộng dồn và quy về mm trước khi gọi vào đây.
 * Open-Meteo trả precipitation_sum sẵn theo mm/ngày nên dùng thẳng được.
 */

/**
 * Hai trạng thái KHÔNG phải một bậc mưa. Trước đây chúng bị gộp chung thành
 * "Không mưa/ Mất dữ liệu" màu xám, khiến không phân biệt được "mô hình nói
 * trời không mưa" với "mô hình không có số".
 *
 *   color  - màu TÔ RASTER. null nghĩa là KHÔNG tô, để lộ bản đồ nền.
 *   swatch - màu cho nơi buộc phải vẽ ra một hình (marker, ô chú giải).
 */
export const RAIN_NONE = {
  id: 'none', label: 'Không mưa', color: null, swatch: '#5d7076', inLegend: false,
};
export const RAIN_NODATA = {
  id: 'nodata', label: 'Mất dữ liệu', color: null, swatch: '#9aa7ad', inLegend: false,
};

/** Các bậc CÓ mưa, khớp đúng Chú giải hiện có trên bản đồ. */
export const RAIN_CLASSES = [
  { id: 'small',  label: 'Mưa nhỏ: < 16',     max: 16, lt: true, color: '#4fc3f7', swatch: '#4fc3f7', inLegend: true },
  { id: 'medium', label: 'Mưa vừa: 16 – 50',  max: 50,           color: '#43a047', swatch: '#43a047', inLegend: true },
  { id: 'heavy',  label: 'Mưa to: 51 – 100',  max: 100,          color: '#fb8c00', swatch: '#fb8c00', inLegend: true },
  { id: 'vheavy', label: 'Mưa rất to: > 100', max: Infinity,     color: '#e53935', swatch: '#e53935', inLegend: true },
];

/**
 * mm/24h -> một bậc.
 *
 * null        -> Mất dữ liệu (không tô)
 * đúng 0      -> Không mưa   (không tô, để lộ bản đồ nền)
 * 0 < v < 16  -> Mưa nhỏ, màu light blue  <- kể cả 0.001 mm
 *
 * Biên lấy đúng theo chữ trong Chú giải: "< 16" là cận TRÊN HỞ của Mưa nhỏ,
 * còn "16 - 50" là cận DƯỚI ĐÓNG của Mưa vừa. Nên 16.0 phải là Mưa vừa.
 */
export function classifyRain(mm24h) {
  if (mm24h == null) return RAIN_NODATA;
  if (mm24h <= 0) return RAIN_NONE;
  if (mm24h < 16) return RAIN_CLASSES[0];
  if (mm24h <= 50) return RAIN_CLASSES[1];
  if (mm24h <= 100) return RAIN_CLASSES[2];
  return RAIN_CLASSES[3];
}

const STEPS_PER_DAY = 8; // 8 bước x 3 giờ

/**
 * Gộp chuỗi 3 giờ thành các ngày 24 giờ.
 * @param {object[]} rows kết quả của normalize() -- past3hprecip đã là mm
 * @returns {{ ts:number, mm:number, klass:object }[]}
 */
export function daily(rows, key = 'past3hprecip-surface') {
  const days = [];
  for (let i = 0; i + STEPS_PER_DAY <= rows.length; i += STEPS_PER_DAY) {
    const slice = rows.slice(i, i + STEPS_PER_DAY);
    // null = model không có giá trị. Nếu THIẾU dữ liệu thì cả ngày là "mất dữ liệu",
    // không được coi như 0 rồi báo "không mưa".
    const missing = slice.some((r) => r[key] == null);
    const mm = missing ? null : slice.reduce((s, r) => s + r[key], 0);
    days.push({ ts: slice[0].ts, mm, klass: classifyRain(mm) });
  }
  return days;
}

/** Tổng mưa 24 giờ tới, dùng để tô màu marker trạm trên bản đồ. */
export function next24h(rows, key = 'past3hprecip-surface') {
  const slice = rows.slice(0, STEPS_PER_DAY);
  if (slice.length < STEPS_PER_DAY || slice.some((r) => r[key] == null)) return { mm: null, klass: RAIN_NODATA };
  const mm = slice.reduce((s, r) => s + r[key], 0);
  return { mm, klass: classifyRain(mm) };
}
