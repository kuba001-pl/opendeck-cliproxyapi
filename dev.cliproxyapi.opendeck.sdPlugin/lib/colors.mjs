/**
 * Colours for the keys: one per provider (from its brand mark), a variant per extra account,
 * a stable hashed colour for providers not listed here, and the traffic-light and mono themes.
 */

// Track must stay visible on Stream Deck LCD panels, where near-black reads as pure black.
export const TRACK_COLOR = '#2c2c33';
// Concrete installed families first: OpenDeck rasterizes keys with resvg, whose generic
// `sans-serif` maps to Arial and silently drops text when Arial is missing.
export const FONT_STACK = "Inter, 'Noto Sans', 'DejaVu Sans', 'Liberation Sans', Arial, Helvetica, sans-serif";
export const ERROR_COLOR = '#ef4444';

// Ring colours follow each provider's brand mark. Extra accounts of the same provider get
// distinct variants so their rings can be told apart.
export const PROVIDER_COLORS = {
  antigravity: ['#3186FF', '#7AB0FF'],
  claude: ['#D97757', '#F2B880', '#E8708A'],
  codex: ['#F4F4F5', '#B1A7FF'],
  gemini: ['#9177C7', '#4796E3'],
  kimi: ['#1783FF', '#6BB0FF'],
  xai: ['#D4D4D8', '#A1A1AA'],
  devin: ['#21C19A'],
  meta: ['#0082FB'],
  qwen: ['#615CED'],
  deepseek: ['#4D6BFE'],
  copilot: ['#C9D1D9'],
  cursor: ['#E4E4E7'],
  plugin: ['#14b8a6'],
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}

function rgbToHex(rgb) {
  return `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;
}

/** Mixes `hex` toward `target` by `amount` (0..1). */
export function mixColor(hex, target, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return rgbToHex(a.map((c, i) => c + (b[i] - c) * amount));
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Apple-style ring track: the ring's own hue, heavily dimmed. */
export function trackFor(color) {
  return mixColor(color, '#000000', 0.74);
}

/** Second (weekly) ring colour: a clearly different tone of the same brand colour. */
export function secondaryTone(color) {
  const [r, g, b] = hexToRgb(color);
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  // Near-white neutrals (Codex, Grok, Cursor) can't get lighter, so they step down to grey;
  // everything else steps up to a light tint of its own hue.
  const nearWhiteNeutral = luminance(color) > 0.8 && chroma < 0.12;
  return nearWhiteNeutral ? mixColor(color, '#000000', 0.42) : mixColor(color, '#ffffff', 0.5);
}

// For providers not listed above.
const DYNAMIC_FALLBACK_COLORS = [
  '#2dd4bf', // teal
  '#a78bfa', // violet
  '#fb7185', // rose
  '#38bdf8', // sky
  '#4ade80', // green
  '#fbbf24', // amber
  '#f472b6', // pink
  '#60a5fa', // blue
];

const MONO_SHADES = ['#ffffff', '#d4d4d8', '#a1a1aa', '#71717a', '#e4e4e7', '#b4b4bc'];

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Traffic-light theme: green, then yellow at 40% left, red at 15%. */
export function trafficLightColor(percent) {
  if (percent == null || !Number.isFinite(percent)) return '#52525b';
  if (percent <= 15) return '#ef4444';
  if (percent <= 40) return '#eab308';
  return '#22c55e';
}

/**
 * Ring colour for a subscription. `providerOccurrenceIndex` is which account of that provider
 * it is (0 for the first), so each account keeps its own colour on every key.
 */
export function getSubscriptionColor(sub, globalIndex, providerOccurrenceIndex, theme = 'provider') {
  if (sub.status === 'error') return ERROR_COLOR;
  if (theme === 'traffic') return trafficLightColor(sub.remainingPercent);
  if (theme === 'mono') return MONO_SHADES[globalIndex % MONO_SHADES.length];

  const key = String(sub.provider || '').toLowerCase();
  if (PROVIDER_COLORS[key]) {
    const variants = PROVIDER_COLORS[key];
    return variants[providerOccurrenceIndex % variants.length];
  }

  // Providers not listed above get a stable colour derived from their name.
  const baseIdx = hashString(key || String(globalIndex)) % DYNAMIC_FALLBACK_COLORS.length;
  return DYNAMIC_FALLBACK_COLORS[(baseIdx + providerOccurrenceIndex) % DYNAMIC_FALLBACK_COLORS.length];
}
