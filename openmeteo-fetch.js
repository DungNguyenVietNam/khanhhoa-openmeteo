/**
 * Lấy lưới cho BẤT KỲ biến nào của Open-Meteo, trả về dạng mặt phẳng
 * plane[latIndex][lonIndex] để các bộ vẽ dùng chung.
 *
 * Xem openmeteo-client.js để biết chi tiết hạn mức và cách tính lượt gọi.
 * Tóm tắt: mỗi ĐIỂM tính như một lượt, trần 600 lượt/phút và 1.000 điểm/request,
 * và PHẢI dùng POST vì GET vỡ ở khoảng 300 điểm với HTTP 414.
 */
import { VARIABLES } from './weather-vars.js';
import { giuCho } from './openmeteo-rate.js';

const HOSTS = {
  forecast:   'https://api.open-meteo.com/v1/forecast',
  flood:      'https://flood-api.open-meteo.com/v1/flood',
  marine:     'https://marine-api.open-meteo.com/v1/marine',
  airQuality: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  archive:    'https://archive-api.open-meteo.com/v1/archive',
};

const axis = (min, max, step) => {
  const n = Math.round((max - min) / step);
  return Array.from({ length: n + 1 }, (_, i) => +(min + i * step).toFixed(4));
};

/**
 * @param {string[]} variables khoá trong VARIABLES
 * @returns {{lats, lons, times, planes, fetchedAt}}
 *   planes[apiName][timeIndex][latIndex][lonIndex]
 */
export async function fetchFieldGrid({
  variables, bbox, step = 0.05, days = 3, timezone = 'Asia/Bangkok', signal,
  onCho,   // (giayCho) => void — báo UI khi phải chờ cho đủ ngân sách phút
} = {}) {
  const lats = axis(bbox.latMin, bbox.latMax, step);
  const lons = axis(bbox.lonMin, bbox.lonMax, step);
  const count = lats.length * lons.length;
  if (count > 1000) throw new Error(`Lưới ${count} điểm vượt trần 1.000. Tăng step hoặc chia lô.`);

  // Gom biến theo API và theo hourly/daily — mỗi tổ hợp là một request
  const jobs = new Map();
  for (const key of variables) {
    const v = VARIABLES[key];
    if (!v) throw new Error(`Biến chưa khai báo: ${key}`);
    const api = v.api ?? 'forecast';
    const names = v.form === 'vector' ? [v.speedKey, v.dirKey] : [key];
    const id = `${api}|${v.agg}`;
    if (!jobs.has(id)) jobs.set(id, { api, agg: v.agg, names: new Set() });
    names.forEach((n) => jobs.get(id).names.add(n));
  }

  const latList = [], lonList = [];
  for (const a of lats) for (const b of lons) { latList.push(a); lonList.push(b); }

  const planes = {}; let times = null;
  for (const job of jobs.values()) {
    // Mỗi ĐIỂM tính một lượt gọi. Nhiều biến = nhiều request, nên phải giữ chỗ
    // trước từng request, nếu không request thứ hai trong cùng phút sẽ dính 429.
    await giuCho(count, { signal, onCho: onCho });
    const body = {
      latitude: latList, longitude: lonList,
      [job.agg]: [...job.names],
      forecast_days: days,
      timezone: [timezone],   // POST yêu cầu MẢNG, gửi chuỗi sẽ 400
    };
    const res = await fetch(HOSTS[job.api], {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal,
    });
    if (res.status === 429) {
      throw Object.assign(new Error(
        'Open-Meteo siết nhịp (429). Mỗi điểm tính như một lượt gọi, trần 600/phút và 5.000/giờ. ' +
        'Giảm số điểm, giảm số biến, hoặc chờ rồi thử lại.'), { status: 429 });
    }
    if (!res.ok) throw new Error(`${job.api} lỗi ${res.status}`);
    const points = await res.json();
    const arr = Array.isArray(points) ? points : [points];

    const block = arr[0][job.agg];
    if (!block) throw new Error(`${job.api} không trả khối ${job.agg}`);
    times ??= block.time;

    for (const name of job.names) {
      const nSteps = block.time.length;
      const plane = Array.from({ length: nSteps }, () =>
        Array.from({ length: lats.length }, () => new Array(lons.length).fill(null)));
      let k = 0;
      for (let i = 0; i < lats.length; i++) {
        for (let j = 0; j < lons.length; j++) {
          const series = arr[k++]?.[job.agg]?.[name] ?? [];
          for (let t = 0; t < nSteps; t++) {
            const val = series[t];
            plane[t][i][j] = (val === null || val === undefined) ? null : val;  // giữ null
          }
        }
      }
      planes[name] = plane;
    }
  }

  return { lats, lons, times, planes, fetchedAt: Date.now(), source: 'Open-Meteo' };
}

/** Lấy giá trị dạng point (lưu lượng sông) cho một danh sách vị trí. */
export async function fetchPointValues(places, { variable = 'river_discharge', days = 7, signal, onCho } = {}) {
  const v = VARIABLES[variable];
  await giuCho(places.length, { signal, onCho });
  const res = await fetch(HOSTS[v.api ?? 'forecast'], {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: places.map((p) => p.lat),
      longitude: places.map((p) => p.lon),
      daily: [variable], forecast_days: days,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`flood lỗi ${res.status}`);
  const arr = await res.json();
  const list = Array.isArray(arr) ? arr : [arr];
  return {
    times: list[0]?.daily?.time ?? [],
    byIndex: list.map((p) => p?.daily?.[variable] ?? []),
    codes: places.map((p) => p.code),
  };
}
