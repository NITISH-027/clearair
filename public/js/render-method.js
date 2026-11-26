/**
 * Static explainer panel describing the exposure model and its sources.
 */
import { el } from './dom.js';

/** Build the collapsible "How the numbers are calculated" panel. */
export function renderMethod() {
  /** @param {string} text */
  const code = (text) => el('pre', { text });
  return el('details', { class: 'panel method' }, [
    el('summary', { text: 'How the numbers are calculated' }),
    el('p', {
      text: 'Inhaled PM2.5 per day is the sum, over each place you spend time, of concentration x breathing rate x hours (US EPA Exposure Factors Handbook; Klepeis et al. 2001).',
    }),
    code('dose = sum( C_i x V_i x t_i )   in ug/day'),
    el('p', {
      text: "Indoor air uses a single-room mass balance (Riley et al. 2002; Chen and Zhao 2011). P is how much leaks through the walls, a is air changes per hour, k is particle settling, CADR is the purifier's clean air delivery rate and V is the room volume.",
    }),
    code('C_in = (P x a x C_out + S / V) / (a + k + CADR / V)'),
    el('ul', {}, [
      el('li', {
        text: 'Windows open a = 2.0 per hour, closed a = 0.5. P = 0.8, k = 0.2 per hour, room 40 m3. Purifier covers 70% of indoor time.',
      }),
      el('li', { text: 'Breathing rates in m3 per hour: sleep 0.3, rest 0.5, light 1.0, hard exercise 2.0.' }),
      el('li', {
        text: 'Cooking sits in a 15 m3 kitchen for 2 hours. Wood, dung and coal add about 600 ug/m3, gas about 40, induction under 10. An exhaust fan triples the air exchange.',
      }),
      el('li', {
        text: 'A fitted N95 uses a protection factor of 5, half of the OSHA value of 10 for half-mask respirators, because most people do not get a perfect seal.',
      }),
      el('li', {
        text: 'AQI follows the US EPA PM2.5 breakpoints (2024). Every constant is an assumption taken from the ranges in these sources, so use the result to compare choices, not as a measurement.',
      }),
    ]),
  ]);
}
