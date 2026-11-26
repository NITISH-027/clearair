import { createServer } from '../server/app.js';

export const json = (data, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => data });

/** Fake fetch. A handler may be a response, a function, or an array consumed one call at a time. */
export function fakeFetch(handlers) {
  const calls = [];
  const queues = new Map();
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const [match, handler] of handlers) {
      if (!String(url).includes(match)) continue;
      let h = handler;
      if (Array.isArray(handler)) {
        if (!queues.has(match)) queues.set(match, [...handler]);
        const queue = queues.get(match);
        h = queue.length > 1 ? queue.shift() : queue[0];
      }
      if (typeof h === 'function') return h(url, init);
      if (h instanceof Error) throw h;
      return h;
    }
    return json({}, false, 404);
  };
  impl.calls = calls;
  impl.callsTo = (match) => calls.filter((c) => c.url.includes(match));
  return impl;
}

export const timeoutError = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });

export const geocode = json({
  results: [{ name: 'Chennai', admin1: 'Tamil Nadu', country: 'India', latitude: 13.08, longitude: 80.27 }],
});

function hourlyDay() {
  const time = [];
  const pm = [];
  const aqi = [];
  for (let h = 8; h < 8 + 30; h += 1) {
    const day = h < 24 ? '26' : '27';
    time.push(`2026-11-${day}T${String(h % 24).padStart(2, '0')}:00`);
    const value = h % 24 === 14 || h % 24 === 15 ? 25 : 80;
    pm.push(value);
    aqi.push(value > 50 ? 160 : 80);
  }
  return { time, pm2_5: pm, us_aqi: aqi };
}

export const air = json({ current: { time: '2026-11-26T08:00', us_aqi: 160, pm2_5: 80, pm10: 90 }, hourly: hourlyDay() });

export const goodAiPlan = {
  summary: 'Air is unhealthy today, so keep exposure low by staying in during the dirtiest hours and cleaning your indoor air.',
  steps: [
    { title: 'Wear an N95 on the commute', action: 'Wear a fitted N95 on your scooter ride to work today.', why: 'It filters most fine particles you would breathe in traffic.', when: 'morning', category: 'routine' },
    { title: 'Keep windows closed', action: 'Close windows and doors until the afternoon window.', why: 'Fewer outdoor particles leak into the rooms where your family spends time.', when: 'daytime', category: 'indoor' },
    { title: 'Switch the engine off when waiting', action: 'Turn the engine off at long signals and while waiting.', why: 'Less idling exhaust adds to the shared street air.', when: 'anytime', category: 'swap' },
  ],
};

/** Gemini generateContent response in the documented live shape. */
export const geminiReply = (plan = goodAiPlan) =>
  json({
    candidates: [{ content: { role: 'model', parts: [{ text: typeof plan === 'string' ? plan : JSON.stringify(plan) }] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 300, totalTokenCount: 800 },
    modelVersion: 'gemini-2.5-flash',
  });

export const profileBody = (over = {}) => ({
  household: { children: true },
  commute: { mode: 'twowheeler', hours: 1 },
  exercise: { outdoorHours: 0.5 },
  home: { windows: 'open', purifier: false, cooking: 'lpg' },
  ...over,
});

export async function withServer(opts, fn) {
  const slept = [];
  const server = createServer({ sleep: async (ms) => { slept.push(ms); }, random: () => 1, ...opts });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, { slept, server });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export function postPlan(base, body, headers = {}) {
  return fetch(`${base}/api/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
