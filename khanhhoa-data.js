/**
 * Dịch vụ dữ liệu Open-Meteo cho tỉnh Khánh Hoà (sau sáp nhập).
 *
 * Mục đích: một cửa duy nhất để trang bản đồ lấy đủ ba dạng dữ liệu, đã chuẩn
 * hoá, đã có cache, đã xử lý 429 — gọi `taiDuLieuKhanhHoa()` là xong.
 *
 * MỌI CON SỐ HẠN MỨC DƯỚI ĐÂY LẤY TỪ brief/OPEN-METEO-FACTS.md (đo thật ngày
 * 28–29/10/2026). Đừng tự suy diễn lại:
 *
 *   - 600 lượt/phút · 5.000 lượt/giờ · 10.000 lượt/ngày · 300.000 lượt/tháng,
 *     tính theo địa chỉ IP.
 *   - MỘT REQUEST KHÔNG BẰNG MỘT LƯỢT. **Mỗi ĐIỂM tính như một lượt.** Đã đo:
 *     gọi một lưới 782 điểm xong thì mọi request khác trong cùng phút đều nhận
 *     429, kể cả request một điểm.
 *   - Trần cứng 1.000 điểm mỗi request.
 *   - PHẢI dùng POST (GET vỡ ở ~300 điểm với HTTP 414) và `timezone` trong thân
 *     POST phải là MẢNG. Hai cái bẫy này đã nằm trong openmeteo-fetch.js.
 *
 * Hệ quả cho module này: **mặc định step 0.2 (54 điểm) khi chạy ở localhost.**
 * Lưới dày chỉ bật ở môi trường thật. Vài lần thử lưới 782 điểm là hết ngân
 * sách giờ, phải chờ sang giờ sau.
 *
 * ĐIỀU KIỆN SỬ DỤNG: dữ liệu CC-BY 4.0 → BẮT BUỘC ghi công "Open-Meteo" trên
 * giao diện (dùng `legendFor()` trong weather-render.js, đừng xoá phần ghi
 * nguồn). Gói miễn phí chỉ cho mục đích phi thương mại; dự án này có thuộc
 * diện thương mại hay không ĐANG CHỜ PHÁP CHẾ XÁC NHẬN.
 */

import { fetchFieldGrid, fetchPointValues } from './openmeteo-fetch.js';
import { VARIABLES, colorFor } from './weather-vars.js';
import { bilinear } from './weather-render.js';
import { classifyRain } from './rain-class.js';

/* ======================= Hằng số địa bàn và hạn mức ======================= */

/** Khung bao Khánh Hoà sau sáp nhập (~183 x 120 km). Nguồn: brief. */
export const BBOX_KHANH_HOA = Object.freeze({
  latMin: 11.30, latMax: 12.95, lonMin: 108.45, lonMax: 109.55,
});

/**
 * Bước lưới và số điểm tương ứng — đã tính sẵn để không phải đoán:
 *   0.05 -> 34 x 23 = 782 điểm  (khuyến nghị cho production, nên chia 2 lô)
 *   0.10 -> 17 x 12 = 204 điểm  (đủ dùng, 1 lô)
 *   0.20 ->  9 x  6 =  54 điểm  (dùng khi phát triển)
 * Lưới mô hình thật ~0,04° nên ĐỪNG lấy mịn hơn 0,05°: chỉ nhận lại cùng một
 * giá trị lặp, tốn lượt gọi mà không thêm thông tin.
 */
export const STEP_PHAT_TRIEN = 0.2;
export const STEP_SAN_XUAT = 0.1;
export const STEP_TOI_THIEU = 0.05;

/** Trần cứng mỗi request do API công bố qua thông báo lỗi. */
export const MAX_DIEM_MOI_REQUEST = 1000;

/** Biến mặc định: đủ cho ba dạng field + vector. */
export const BIEN_MAC_DINH = Object.freeze([
  'precipitation_sum',            // field · mưa 24h (mm)
  'temperature_2m_max',           // field · nhiệt độ cao nhất ngày (°C)
  'et0_fao_evapotranspiration',   // field · bốc hơi tham chiếu ET0 (mm)
  'soil_moisture_9_to_27cm',      // field · ẩm đất tầng rễ (m³/m³)
  'wind_10m',                     // vector · gió 10 m (tốc độ + hướng)
]);

/**
 * Bảy hồ chứa lớn của Khánh Hoà sau sáp nhập, dùng cho dữ liệu dạng `point`
 * (`river_discharge`, mô hình GloFAS, m³/s).
 *
 * ⚠️ TOẠ ĐỘ DƯỚI ĐÂY LÀ **ƯỚC LƯỢNG** — tra từ vị trí hành chính trên bản đồ,
 * KHÔNG phải toạ độ đo tại đập. Đội dự án PHẢI thay bằng toạ độ thật do đơn vị
 * quản lý hồ cung cấp trước khi đưa vào sử dụng: lệch vài km đủ để GloFAS trả
 * về ô lưới của một lưu vực khác, và con số sẽ sai mà không có dấu hiệu gì.
 * Cờ `toaDoUocLuong: true` để giao diện hiển thị cảnh báo; khi thay toạ độ thật
 * thì đổi thành `false`.
 *
 * Thêm nữa: GloFAS là mô hình toàn cầu, độ phân giải thô, KHÔNG thay được trạm
 * đo thật — hiển thị như một lớp dự báo riêng, đừng trộn với số đo mực nước.
 */
export const HO_KHANH_HOA = Object.freeze([
  { code: 'DA_BAN',     name: 'Hồ Đá Bàn',       lat: 12.73, lon: 109.08, toaDoUocLuong: true },
  { code: 'HOA_SON',    name: 'Hồ Hoa Sơn',      lat: 12.80, lon: 109.20, toaDoUocLuong: true },
  { code: 'CAM_RANH',   name: 'Hồ Cam Ranh',     lat: 11.98, lon: 109.07, toaDoUocLuong: true },
  { code: 'SUOI_DAU',   name: 'Hồ Suối Dầu',     lat: 12.10, lon: 109.07, toaDoUocLuong: true },
  { code: 'TA_RUC',     name: 'Hồ Tà Rục',       lat: 11.93, lon: 108.95, toaDoUocLuong: true },
  { code: 'SONG_HINH',  name: 'Hồ Sông Hinh',    lat: 12.85, lon: 108.98, toaDoUocLuong: true },
  { code: 'SONG_TRAU',  name: 'Hồ Sông Trâu',    lat: 11.70, lon: 109.05, toaDoUocLuong: true },
]);

/* ============================== Cache 2 giờ =============================== */

const TTL_CACHE_MS = 2 * 60 * 60 * 1000;   // 2 giờ
const TIEN_TO_CACHE = 'kh-data:v1:';

/** Trục lưới đều, làm tròn 4 chữ số để khoá cache ổn định giữa các lần chạy. */
const truc = (min, max, step) => {
  const n = Math.round((max - min) / step);
  return Array.from({ length: n + 1 }, (_, i) => +(min + i * step).toFixed(4));
};

/**
 * Khoá cache gồm ĐỦ mọi thứ làm dữ liệu khác nhau: bbox + step + số ngày +
 * danh sách biến (đã sắp xếp) + NGÀY lịch. Thiếu một thành phần là cache sẽ
 * trả về dữ liệu của tham số khác — lỗi khó thấy nhất trong nhóm này.
 */
export function khoaCache({ bbox, step, days, bien }) {
  const b = [bbox.latMin, bbox.latMax, bbox.lonMin, bbox.lonMax]
    .map((x) => x.toFixed(4)).join(',');
  const ngay = new Date().toISOString().slice(0, 10);   // dự báo đổi theo ngày
  return `${TIEN_TO_CACHE}${b}|${step}|${days}|${[...bien].sort().join(',')}|${ngay}`;
}

/**
 * Mọi truy cập localStorage đều bọc try/catch: ở chế độ riêng tư, khi người
 * dùng chặn site data, hoặc khi iframe khác origin thì chỉ ĐỌC thuộc tính
 * `localStorage` đã ném lỗi. Cache là tiện nghi, không được làm sập trang.
 */
function docCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.luuLuc !== 'number') return null;
    if (Date.now() - obj.luuLuc > TTL_CACHE_MS) {
      try { localStorage.removeItem(key); } catch { /* bỏ qua */ }
      return null;
    }
    return obj;
  } catch {
    return null;   // hỏng JSON hoặc không có localStorage -> coi như chưa cache
  }
}

function ghiCache(key, dulieu) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...dulieu, luuLuc: Date.now() }));
    return true;
  } catch {
    // Thường là QuotaExceededError: lưới 782 điểm x 6 biến x 7 ngày khá to.
    // Dọn các bản cũ của chính module rồi thử lại một lần.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(TIEN_TO_CACHE) && k !== key) localStorage.removeItem(k);
      }
      localStorage.setItem(key, JSON.stringify({ ...dulieu, luuLuc: Date.now() }));
      return true;
    } catch {
      return false;   // không cache được thì thôi, dữ liệu vẫn dùng bình thường
    }
  }
}

/** Xoá toàn bộ cache của module. Dùng khi cần buộc tải lại, và trong test. */
export function xoaCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(TIEN_TO_CACHE)) localStorage.removeItem(k);
    }
    return true;
  } catch {
    return false;
  }
}

/* =============================== Tiện ích ================================= */

/** Đang chạy ở máy cá nhân? Quyết định step mặc định. */
export function laLocalhost() {
  try {
    const h = globalThis.location?.hostname ?? '';
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
      || h === '' || h.endsWith('.localhost') || h.endsWith('.test');
  } catch {
    return true;   // không biết thì chọn phương án tốn ít lượt gọi nhất
  }
}

/** Số điểm của một lưới — đây chính là SỐ LƯỢT GỌI sẽ bị trừ cho mỗi request. */
export function demDiem(bbox, step) {
  return truc(bbox.latMin, bbox.latMax, step).length
       * truc(bbox.lonMin, bbox.lonMax, step).length;
}

/**
 * Lỗi 429 dựng sẵn, thông điệp nói rõ NGUYÊN NHÂN và VIỆC NÊN LÀM.
 * KHÔNG tự thử lại: retry ngay chỉ đào sâu thêm hố, vì hạn mức tính theo IP và
 * cửa sổ phút chưa trôi qua.
 */
function loi429({ soDiem, soRequest }) {
  const msg =
    `Open-Meteo đang siết nhịp (HTTP 429). Nguyên nhân: hạn mức tính theo SỐ ĐIỂM, ` +
    `mỗi điểm trong lưới là MỘT lượt gọi — lần này ${soDiem} điểm x ${soRequest} request ` +
    `≈ ${soDiem * soRequest} lượt, trên trần 600 lượt/phút và 5.000 lượt/giờ (tính theo IP). ` +
    `Nên làm: DỪNG gọi, chờ ít nhất 60 giây cho cửa sổ phút trôi qua (nếu đã chạm trần giờ ` +
    `thì phải chờ sang giờ sau), rồi tăng step để thưa lưới (0.2 = 54 điểm, 0.1 = 204 điểm) ` +
    `hoặc giảm số biến. Module KHÔNG tự thử lại để không làm tình hình xấu thêm.`;
  return Object.assign(new Error(msg), {
    status: 429, retryAfterMs: 60_000, soDiem, soRequest, source: 'Open-Meteo',
  });
}

/** Lỗi nào cũng có thể là 429 gói trong lớp khác — nhận diện rồi dựng lại. */
function chuanHoaLoi(err, ngucanh) {
  if (err?.name === 'AbortError') throw err;          // người dùng huỷ, không phải lỗi
  if (err?.status === 429 || /\b429\b/.test(String(err?.message))) {
    throw loi429(ngucanh);
  }
  throw err;
}

/* ============================ Hàm chính =================================== */

/**
 * Tải trọn bộ dữ liệu Khánh Hoà và trả về thứ SẴN SÀNG VẼ.
 *
 * @param {object}   [o]
 * @param {number}   [o.step]      bước lưới (°). Mặc định 0.2 ở localhost, 0.1 nơi khác.
 * @param {number}   [o.days]      số ngày dự báo (mặc định 7).
 * @param {string[]} [o.bien]      danh sách khoá trong VARIABLES (mặc định BIEN_MAC_DINH).
 * @param {object}   [o.bbox]      khung bao (mặc định BBOX_KHANH_HOA).
 * @param {boolean}  [o.layHo]     có lấy river_discharge cho 7 hồ hay không (mặc định true).
 * @param {boolean}  [o.dungCache] đọc/ghi localStorage (mặc định true).
 * @param {function} [o.onProgress] ({ buoc, tongBuoc, nhan }) => void
 * @param {AbortSignal} [o.signal]
 *
 * @returns {Promise<{
 *   bbox, step, days, bien, lats, lons, times, planes, hoTimes, ho,
 *   tuCache:boolean, laySanLuc:number, soDiem:number, soLuotDaTieu:number,
 *   nguon:string, ghiCong:string,
 *   giaTriTai(bien, chiSoThoiGian, lat, lon): number|null,
 *   mauTai(bien, chiSoThoiGian, lat, lon): string|null,
 *   bacMuaTai(chiSoThoiGian, lat, lon): object,
 *   gioTai(chiSoThoiGian, lat, lon): {speed, dirDeg, huongGlyph}|null,
 *   mangPhang(bien, chiSoThoiGian): (number|null)[][]|null,
 *   hoTai(code): object|null
 * }>}
 */
export async function taiDuLieuKhanhHoa({
  step,
  days = 7,
  bien = BIEN_MAC_DINH,
  bbox = BBOX_KHANH_HOA,
  layHo = true,
  dungCache = true,
  onProgress = () => {},
  signal,
} = {}) {
  // Vì sao step mặc định phụ thuộc môi trường: hạn mức tính theo SỐ ĐIỂM, nên
  // thử nghiệm trên lưới dày rất dễ chạm trần 5.000 lượt/giờ và phải chờ cả
  // tiếng. Ở localhost lấy lưới thưa; môi trường thật mới lấy dày. Ghi đè được.
  const buoc = step ?? (laLocalhost() ? STEP_PHAT_TRIEN : STEP_SAN_XUAT);

  const danhSachBien = [...new Set(bien)];
  for (const k of danhSachBien) {
    if (!VARIABLES[k]) throw new Error(`Biến chưa khai báo trong weather-vars.js: ${k}`);
  }

  const soDiem = demDiem(bbox, buoc);
  if (soDiem > MAX_DIEM_MOI_REQUEST) {
    throw new Error(
      `Lưới ${soDiem} điểm vượt trần ${MAX_DIEM_MOI_REQUEST} điểm/request của Open-Meteo. ` +
      `Tăng step (0.1 = 204 điểm, 0.05 = 782 điểm) hoặc chia lô bằng ` +
      `fetchRainGridBatched() trong openmeteo-client.js.`);
  }

  const key = khoaCache({ bbox, step: buoc, days, bien: danhSachBien });

  /* ---- 1. Thử cache trước. Mục đích: mở lại trang KHÔNG gọi lại API ---- */
  if (dungCache) {
    const c = docCache(key);
    if (c) {
      onProgress({ buoc: 1, tongBuoc: 1, nhan: 'Dùng lại dữ liệu đã lưu (còn trong 2 giờ)' });
      return dongGoi({
        ...c, bbox, step: buoc, days, bien: danhSachBien,
        tuCache: true, soDiem, soLuotDaTieu: 0,
      });
    }
  }

  /* ---- 2. Gọi thật ---- */
  const tongBuoc = layHo ? 2 : 1;
  onProgress({ buoc: 0, tongBuoc, nhan: `Đang lấy lưới ${soDiem} điểm (= ${soDiem} lượt gọi)` });

  let luoi, soRequest = 1;
  try {
    luoi = await fetchFieldGrid({
      variables: danhSachBien, bbox, step: buoc, days, signal,
    });
  } catch (e) {
    // fetchFieldGrid gửi một request cho mỗi tổ hợp (api, hourly/daily), nên
    // số lượt thực tiêu có thể là soDiem x số tổ hợp. Đếm để báo đúng trong lỗi.
    soRequest = demToHop(danhSachBien);
    chuanHoaLoi(e, { soDiem, soRequest });
  }
  soRequest = demToHop(danhSachBien);
  let soLuotDaTieu = soDiem * soRequest;

  /* ---- 3. Dạng point: river_discharge cho 7 hồ ---- */
  let ho = null, hoTimes = [];
  if (layHo) {
    onProgress({ buoc: 1, tongBuoc, nhan: `Đang lấy lưu lượng ${HO_KHANH_HOA.length} hồ` });
    try {
      const r = await fetchPointValues(HO_KHANH_HOA, {
        variable: 'river_discharge', days: Math.max(days, 7), signal,
      });
      hoTimes = r.times;
      ho = HO_KHANH_HOA.map((h, i) => ({
        ...h,
        chuoi: (r.byIndex[i] ?? []).map((v) => (v === null || v === undefined ? null : v)),
      }));
      soLuotDaTieu += HO_KHANH_HOA.length;
    } catch (e) {
      // Lưu lượng hồ là lớp phụ: thiếu nó thì vẫn vẽ được lưới. Nhưng 429 thì
      // phải nổi lên, vì nó nói rằng mọi request tiếp theo cũng sẽ trượt.
      if (e?.status === 429 || /\b429\b/.test(String(e?.message))) {
        throw loi429({ soDiem, soRequest });
      }
      if (e?.name === 'AbortError') throw e;
      ho = HO_KHANH_HOA.map((h) => ({ ...h, chuoi: [], loi: String(e?.message ?? e) }));
    }
  }

  const goi = {
    lats: luoi.lats, lons: luoi.lons, times: luoi.times, planes: luoi.planes,
    hoTimes, ho, laySanLuc: luoi.fetchedAt ?? Date.now(),
  };

  if (dungCache) ghiCache(key, goi);

  onProgress({ buoc: tongBuoc, tongBuoc, nhan: `Xong — đã tiêu ~${soLuotDaTieu} lượt gọi` });

  return dongGoi({
    ...goi, bbox, step: buoc, days, bien: danhSachBien,
    tuCache: false, soDiem, soLuotDaTieu,
  });
}

/** fetchFieldGrid gom biến theo (api, hourly/daily) — mỗi tổ hợp là 1 request. */
function demToHop(bien) {
  const s = new Set();
  for (const k of bien) {
    const v = VARIABLES[k];
    s.add(`${v.api ?? 'forecast'}|${v.agg}`);
  }
  return s.size;
}

/* ===================== Đóng gói: lưới + hàm tiện ích ====================== */

/**
 * Gắn các hàm tra cứu vào dữ liệu thô. Tách riêng để đường cache và đường gọi
 * thật trả về **đúng một hình dạng** — nếu không thì lỗi chỉ xuất hiện ở lần
 * mở lại trang, loại lỗi mất nhiều giờ nhất để tìm.
 */
function dongGoi(d) {
  const luoi = { lats: d.lats, lons: d.lons };

  /** Lấy mặt phẳng [lat][lon] của một biến tại một mốc thời gian. */
  const mangPhang = (bien, t = 0) => {
    const v = VARIABLES[bien];
    const ten = v?.form === 'vector' ? v.speedKey : bien;
    return d.planes?.[ten]?.[t] ?? null;
  };

  /**
   * Giá trị tại một toạ độ bất kỳ, nội suy song tuyến.
   * Trả về `null` khi thiếu dữ liệu — KHÔNG đổi thành 0. "Mô hình không có số"
   * và "mô hình nói bằng 0" là hai chuyện khác nhau; gộp lại là làm sai dữ liệu.
   */
  const giaTriTai = (bien, t, lat, lon) => {
    const p = mangPhang(bien, t);
    if (!p) return null;
    return bilinear(luoi, p, lat, lon);
  };

  return {
    bbox: d.bbox, step: d.step, days: d.days, bien: d.bien,
    lats: d.lats, lons: d.lons, times: d.times, planes: d.planes,
    hoTimes: d.hoTimes, ho: d.ho,
    tuCache: d.tuCache, laySanLuc: d.laySanLuc,
    soDiem: d.soDiem, soLuotDaTieu: d.soLuotDaTieu,
    nguon: 'Open-Meteo',
    // Bắt buộc theo giấy phép CC-BY 4.0 — phải xuất hiện trên giao diện.
    ghiCong: 'Nguồn: Open-Meteo · CC-BY 4.0 · số mô hình dự báo, không phải số đo trạm',

    mangPhang,
    giaTriTai,

    /** Màu CSS tại một toạ độ, hoặc null nếu không tô (lộ bản đồ nền). */
    mauTai: (bien, t, lat, lon) => colorFor(bien, giaTriTai(bien, t, lat, lon)),

    /**
     * Bậc mưa tại một toạ độ, theo đúng Chú giải trên bản đồ.
     * Biên: null → Mất dữ liệu · đúng 0 → Không mưa · 0.001 → Mưa nhỏ ·
     * 16 → Mưa vừa · 50 → Mưa vừa · 50.1 → Mưa to.
     */
    bacMuaTai: (t, lat, lon) => classifyRain(giaTriTai('precipitation_sum', t, lat, lon)),

    /**
     * Gió tại một toạ độ. `huongGlyph` đã cộng 180 độ: `wind_direction_10m` là
     * hướng gió THỔI TỪ, nên mũi tên phải chỉ về hướng ngược lại.
     */
    gioTai: (t, lat, lon) => {
      const sp = d.planes?.wind_speed_10m?.[t];
      const dir = d.planes?.wind_direction_10m?.[t];
      if (!sp || !dir) return null;
      const speed = bilinear(luoi, sp, lat, lon);
      const dirDeg = bilinear(luoi, dir, lat, lon);
      if (speed == null || dirDeg == null) return null;
      return { speed, dirDeg, huongGlyph: (dirDeg + 180) % 360 };
    },

    /** Một hồ theo mã, kèm cờ cảnh báo toạ độ ước lượng. */
    hoTai: (code) => d.ho?.find((h) => h.code === code) ?? null,
  };
}
