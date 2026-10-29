/**
 * Ngân sách lượt gọi Open-Meteo theo phút, dùng chung cho mọi đường gọi.
 *
 * Vì sao cần: hạn mức miễn phí là 600 lượt/phút và MỖI ĐIỂM tính như một lượt.
 * Một lưới cỡ tỉnh (782 điểm) đã gần hết ngân sách của cả phút. Khi lấy nhiều
 * biến, mỗi tổ hợp (api, hourly/daily) là một request riêng — hai request liên
 * tiếp trong cùng một phút là dính 429 ngay.
 *
 * Trước đây việc giãn nhịp chỉ có trong fetchRainGridBatched() và chỉ dùng cho
 * mưa, nên đường lấy nhiều biến không được bảo vệ. Module này đưa ngân sách ra
 * một chỗ để mọi hàm cùng tôn trọng.
 */

const GIOI_HAN_PHUT = 600;
const CUA_SO_MS = 60_000;

/** Lịch sử tiêu thụ trong cửa sổ trượt: [{ luc, diem }] */
const lichSu = [];

function donDep(now) {
  while (lichSu.length && now - lichSu[0].luc >= CUA_SO_MS) lichSu.shift();
}

function daTieu(now) {
  donDep(now);
  return lichSu.reduce((s, x) => s + x.diem, 0);
}

/** Số lượt còn dùng được ngay bây giờ. */
export function conLai() {
  return Math.max(0, GIOI_HAN_PHUT - daTieu(Date.now()));
}

/**
 * Giữ chỗ `diem` lượt, chờ nếu cần cho tới khi cửa sổ phút đủ chỗ.
 *
 * @param {number} diem số điểm của request sắp gửi
 * @param {object} opts
 * @param {AbortSignal} opts.signal
 * @param {(giayCho:number)=>void} opts.onCho  báo cho UI biết đang phải chờ
 */
export async function giuCho(diem, { signal, onCho } = {}) {
  // Request lớn hơn cả ngân sách một phút thì chờ cũng vô ích — để nó đi và
  // xử lý 429 ở tầng trên, còn hơn treo vĩnh viễn.
  if (diem >= GIOI_HAN_PHUT) {
    if (lichSu.length) await choTrong(lichSu[0].luc + CUA_SO_MS - Date.now(), signal, onCho);
    lichSu.push({ luc: Date.now(), diem });
    return;
  }

  for (;;) {
    const now = Date.now();
    if (daTieu(now) + diem <= GIOI_HAN_PHUT) {
      lichSu.push({ luc: now, diem });
      return;
    }
    // Chờ tới khi mục cũ nhất rơi ra khỏi cửa sổ, cộng 1 giây đệm
    const chờ = lichSu[0].luc + CUA_SO_MS - now + 1000;
    await choTrong(chờ, signal, onCho);
  }
}

function choTrong(ms, signal, onCho) {
  if (ms <= 0) return Promise.resolve();
  onCho?.(Math.ceil(ms / 1000));
  return new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Đã huỷ', 'AbortError')); },
      { once: true });
  });
}

/** Xoá lịch sử — chỉ dùng trong kiểm thử. */
export function datLai() { lichSu.length = 0; }
