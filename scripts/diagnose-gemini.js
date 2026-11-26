// Run `npm run diagnose` with GEMINI_API_KEY set to see the real Gemini error (the key is never printed).
import { generateAiPlan } from '../server/ai-plan.js';

const facts = {
  place: 'Delhi, India', aqi: 202, category: 'Very unhealthy', pm25: 154.1,
  forecast: 'cleanest 2 PM to 4 PM',
  cleanestWindow: '2 PM to 4 PM',
  household: { children: true, olderAdults: false, asthma: true, pregnant: false },
  commute: { mode: 'metro', hours: 1 }, outdoorExerciseHours: 0.5,
  home: { cooking: 'lpg', windows: 'open', purifier: false },
  estimatedExposureUgPerDay: 1500,
  ruleBasedSteps: ['Wear a well-fitted mask', 'Run the purifier'],
};
if (!process.env.GEMINI_API_KEY) {
  console.error('Set GEMINI_API_KEY first.');
  process.exit(1);
}
const started = Date.now();
try {
  const out = await generateAiPlan({ fetchImpl: fetch, env: process.env, facts, notes: '', attempts: 2, timeoutMs: 90_000 });
  console.log(`OK with model ${out.model} in ${Date.now() - started} ms: ${out.steps.length} steps. Summary: ${out.summary}`);
} catch (err) {
  console.error(`FAILED after ${Date.now() - started} ms: ${err.code ?? err.name}${err.detail ? ` (${err.detail})` : ''}`);
  process.exit(1);
}
