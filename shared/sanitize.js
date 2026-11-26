// Text sanitising for anything that reaches an LLM prompt or comes back from
// one. The rules are deliberately blunt: free text is data, never instructions.

// Zero-width characters and bidi overrides are removed outright, so they cannot
// split a keyword ("ig<ZWSP>nore"). Other control characters become spaces.
const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
// Characters that could close a delimiter or fake structure in a prompt.
const STRUCTURAL = /[<>{}[\]`\\|]/g;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;
const LABEL_DISALLOWED = /[^\p{L}\p{M}\p{N} .,'()-]/gu;

// Injection detection works on words, not on backtracking regexes, so hostile
// input cannot trigger catastrophic matching.
const COMMAND_WORDS = new Set(['ignore', 'disregard', 'forget', 'override', 'bypass']);
const TARGET_WORDS = new Set(['previous', 'prior', 'above', 'earlier', 'preceding', 'instructions', 'instruction', 'rules', 'system', 'everything', 'safety', 'guidelines', 'prompt']);
const REVEAL_WORDS = new Set(['reveal', 'print', 'show', 'leak', 'repeat']);
const SECRET_WORDS = new Set(['prompt', 'instructions', 'secret', 'password']);
const PHRASES = [
  'system prompt', 'system message', 'system instruction', 'developer prompt', 'developer message', 'developer instruction',
  'you are now', 'act as', 'pretend to be', 'pretend you', 'jailbreak', 'dan mode', 'api key', 'apikey', 'api_key',
  'new instruction', 'respond only', 'respond with', 'respond in', 'output only', 'output the following', 'output json',
];
const WINDOW = 4;

function words(text) {
  return text.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
}

function hasWordPair(list, first, second) {
  return list.some((word, i) => first.has(word) && list.slice(i + 1, i + 1 + WINDOW).some((next) => second.has(next)));
}

function matchesInjection(text) {
  const list = words(text);
  const joined = ` ${list.join(' ')} `;
  if (PHRASES.some((phrase) => joined.includes(` ${phrase.replace(/_/g, ' ').replace(/\s+/g, ' ')} `) || joined.includes(` ${phrase} `))) return true;
  if (/\bforget\b/.test(text.toLowerCase()) && /\b(everything|previous|prior|instructions|rules|told)\b/.test(text.toLowerCase())) return true;
  return hasWordPair(list, COMMAND_WORDS, TARGET_WORDS) || hasWordPair(list, REVEAL_WORDS, SECRET_WORDS);
}

/** Normalise, drop invisible and structural characters, collapse whitespace, cap length. */
export function sanitizeText(input, maxLen) {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(CONTROL, ' ')
    .replace(STRUCTURAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/** True when the text looks like an attempt to give the model instructions. */
export function looksLikeInjection(text) {
  if (typeof text !== 'string') return false;
  const plain = text.normalize('NFKC').replace(ZERO_WIDTH, '').replace(CONTROL, ' ');
  const squashed = plain.replace(STRUCTURAL, '').replace(/\s+/g, ' ');
  const untagged = plain.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  return [plain, squashed, untagged].some(matchesInjection);
}

export const NOTES_MAX = 200;

/**
 * Prepare an optional free-text note about the user's day.
 * Notes that look like prompt injection are dropped entirely, not cleaned.
 * @returns {{ value: string, dropped: boolean }}
 */
export function sanitizeNotes(input) {
  if (input === undefined || input === null || input === '') return { value: '', dropped: false };
  if (typeof input !== 'string') return { value: '', dropped: true };
  if (looksLikeInjection(input)) return { value: '', dropped: true };
  return { value: sanitizeText(input, NOTES_MAX), dropped: false };
}

/** Reduce a place name (which comes from a third-party geocoder) to safe label characters. */
export function sanitizeLabel(input, maxLen = 60) {
  if (typeof input !== 'string') return '';
  return input.normalize('NFKC').replace(LABEL_DISALLOWED, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/** Remove links and markup characters from model output before it is shown. */
export function cleanModelText(input, maxLen) {
  if (typeof input !== 'string') return '';
  return sanitizeText(input.replace(URL_PATTERN, ''), maxLen);
}
