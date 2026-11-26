// `npm run diagnose:ladder` sends three increasingly complex requests so you can see which one hangs or fails.
// Prints status, elapsed time, finish reason and token counts. The key is never printed.
import { DEFAULT_MODEL, RESPONSE_SCHEMA } from '../server/ai-plan.js';

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('Set GEMINI_API_KEY first.');
  process.exit(1);
}
const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
const prompt = { role: 'user', parts: [{ text: 'List three short tips for breathing cleaner air at home.' }] };
const json = { responseMimeType: 'application/json' };
const schema = { ...json, responseSchema: RESPONSE_SCHEMA };

const steps = [
  ['A plain prompt', { contents: [prompt] }],
  ['B JSON mime type only', { contents: [prompt], generationConfig: json }],
  ['C JSON with responseSchema', { contents: [prompt], generationConfig: schema }],
];

console.log(`Model: ${model}`);
for (const [name, body] of steps) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    });
    const data = await res.json().catch(() => ({}));
    const usage = data.usageMetadata ?? {};
    const note = res.ok
      ? `finish=${data.candidates?.[0]?.finishReason ?? 'none'} thoughtsTokens=${usage.thoughtsTokenCount ?? 0} outputTokens=${usage.candidatesTokenCount ?? 0}`
      : String(data.error?.message ?? '').replace(/\s+/g, ' ').slice(0, 140);
    console.log(`${name}: HTTP ${res.status} in ${Date.now() - started} ms ${note}`);
  } catch (err) {
    console.log(`${name}: ${err?.name === 'TimeoutError' ? 'TIMEOUT after 40 s' : 'network error'} (${Date.now() - started} ms)`);
  }
}
