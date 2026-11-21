/**
 * 144x144 SVG key renderer for OpenDeck / Stream Deck, styled after Apple Watch complications:
 * Activity-style rings with round caps on pure black, tracks tinted in each ring's own colour,
 * real provider logos, one big number.
 *
 * Hardware legibility floor: the image is shown at 72px on a Stream Deck MK.2 (96px on XL),
 * so each unit here is ~0.5 device pixel. No text under ~16 units, primary numbers 26-40,
 * ring strokes 6-14, logos 15-28. Nothing hairline.
 */

import {
  ERROR_COLOR,
  FONT_STACK,
  getSubscriptionColor,
  secondaryTone,
  TRACK_COLOR,
  trackFor,
} from './colors.mjs';
import { formatResetCountdown } from './cliproxy.mjs';
import { renderProviderIcon } from './icons.mjs';

const SIZE = 144;
const CX = 72;
const CY = 72;
const BG = '#000000';
const TEXT = '#ffffff';
const TEXT_DIM = '#b8b8c0';
const LOW = 15; // % left at or below which a number turns red
const DIGIT_W = 0.6; // approximate advance of a bold digit relative to font size

function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG arc path from startAngleDeg to endAngleDeg (0° = 12 o'clock, clockwise). */
function describeArc(cx, cy, r, startAngleDeg, endAngleDeg) {
  const sweep = endAngleDeg - startAngleDeg;
  if (sweep <= 0.1) return '';
  const clampedSweep = Math.min(sweep, 359.8);
  const start = polarToCartesian(cx, cy, r, startAngleDeg);
  const end = polarToCartesian(cx, cy, r, startAngleDeg + clampedSweep);
  const largeArc = clampedSweep > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function arcStroke(cx, cy, r, from, to, color, width, extra = '') {
  const d = describeArc(cx, cy, r, from, to);
  if (!d) return '';
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"${extra}/>`;
}

/**
 * One Activity-style ring: tinted track + filled arc. 0% shows a red dot at the start;
 * errors show a dotted red ring.
 */
function ring(cx, cy, r, w, from, sweep, pct, color, { error = false } = {}) {
  const full = sweep >= 359.9;
  let out = full
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${trackFor(error ? ERROR_COLOR : color)}" stroke-width="${w}"/>`
    : arcStroke(cx, cy, r, from, from + sweep, trackFor(error ? ERROR_COLOR : color), w);
  if (error) {
    const dash = ` stroke-dasharray="0.1 ${(w * 1.6).toFixed(1)}"`;
    out += full
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ERROR_COLOR}" stroke-width="${(w * 0.6).toFixed(1)}" stroke-linecap="round"${dash}/>`
      : arcStroke(cx, cy, r, from, from + sweep, ERROR_COLOR, (w * 0.6).toFixed(1), dash);
    return out;
  }
  if (pct === null || pct === undefined) return out;
  if (full && pct >= 99.5) {
    return `${out}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
  }
  if (pct > 0.5) {
    return out + arcStroke(cx, cy, r, from, from + Math.max(2, (sweep * pct) / 100), color, w);
  }
  const dot = polarToCartesian(cx, cy, r, from);
  return `${out}<circle cx="${dot.x.toFixed(1)}" cy="${dot.y.toFixed(1)}" r="${(w * 0.32).toFixed(1)}" fill="${ERROR_COLOR}"/>`;
}

function svgDoc(body, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${escapeXml(label)}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>
  ${body}
</svg>`;
}

function textEl(x, y, content, { size, weight = 800, color = TEXT, spacing = 0 } = {}) {
  const ls = spacing ? ` letter-spacing="${spacing}"` : '';
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_STACK}" font-size="${size.toFixed(1)}" font-weight="${weight}"${ls} fill="${color}">${escapeXml(content)}</text>`;
}

/** Shrinks a font size so `text` fits within `maxWidth` units. */
function fitSize(text, preferred, maxWidth, advance = 0.64) {
  const len = Math.max(1, String(text).length);
  return Math.min(preferred, maxWidth / (len * advance));
}

/**
 * Big readout: digits at full size, "%" at half size on the same baseline, centred as one unit.
 */
function bigNumber(x, y, value, { size, color = TEXT, suffix = '%', suffixColor = null, maxWidth = Infinity } = {}) {
  const str = String(value);
  let fs = size;
  const widthAt = (s) => s * (str.length * DIGIT_W + (suffix ? 0.45 : 0));
  if (widthAt(fs) > maxWidth) fs = maxWidth / widthAt(1);
  const baseline = y + fs * 0.36;
  const suffixMarkup = suffix
    ? `<tspan font-size="${(fs * 0.5).toFixed(1)}" font-weight="700" fill="${suffixColor || color}"${suffixColor ? '' : ' fill-opacity="0.7"'} dx="${(fs * 0.04).toFixed(1)}">${escapeXml(suffix)}</tspan>`
    : '';
  return `<text x="${x.toFixed(1)}" y="${baseline.toFixed(1)}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${fs.toFixed(1)}" font-weight="800" letter-spacing="${(-fs * 0.03).toFixed(2)}" fill="${color}">${escapeXml(str)}${suffixMarkup}</text>`;
}

/**
 * Two-part caption on one baseline: a coloured tag ("5H") followed by a value ("52m").
 */
function captionEl(x, y, tag, value, { size, tagColor, maxWidth }) {
  const chars = (tag ? tag.length + 1 : 0) + String(value).length;
  const fs = Math.min(size, maxWidth / (chars * 0.6));
  const tagMarkup = tag ? `<tspan fill="${tagColor}" font-weight="800">${escapeXml(tag)}</tspan><tspan dx="${(fs * 0.3).toFixed(1)}">` : '<tspan>';
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_STACK}" font-size="${fs.toFixed(1)}" font-weight="700" fill="${TEXT_DIM}">${tagMarkup}${escapeXml(value)}</tspan></text>`;
}

/**
 * Wraps an SVG string as a base64 data URI ready for OpenDeck's `setImage`.
 */
export function svgToDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/* ---------------------------------------------------------------- data helpers */

function pctOf(sub) {
  return sub.status === 'ok' && typeof sub.remainingPercent === 'number' ? clamp(sub.remainingPercent, 0, 100) : null;
}

function windowTag(w, kind) {
  const h = typeof w.periodHours === 'number' ? w.periodHours : null;
  if (h !== null) {
    if (h < 24) return `${Math.round(h)}H`;
    if (h === 24) return 'DAY';
    if (h >= 160 && h <= 170) return 'WK';
    if (h >= 672) return 'MO';
    return `${Math.round(h / 24)}D`;
  }
  return kind === 'short' ? '5H' : 'WK';
}

/**
 * Splits a subscription's quota windows into the short window (e.g. 5h) and the long window
 * (e.g. weekly), keeping the tightest of each kind. Subscriptions without window detail fall
 * back to their summary percentage.
 */
export function splitWindows(sub) {
  const valid = (sub.windows || []).filter(
    (w) => w && typeof w.remainingPercent === 'number' && Number.isFinite(w.remainingPercent),
  );
  const isShort = (w) =>
    (typeof w.periodHours === 'number' && w.periodHours <= 24) || /five|5h|primary|hour|daily/i.test(`${w.id} ${w.label}`);
  const isLong = (w) =>
    (typeof w.periodHours === 'number' && w.periodHours >= 48) || /seven|7d|week|month|secondary/i.test(`${w.id} ${w.label}`);
  const tightest = (list) => (list.length ? list.reduce((m, c) => (c.remainingPercent < m.remainingPercent ? c : m)) : null);

  const shortW = tightest(valid.filter(isShort));
  const longW = tightest(valid.filter((w) => w !== shortW && !isShort(w) && isLong(w)));
  const toInfo = (w, kind) =>
    w ? { pct: clamp(w.remainingPercent, 0, 100), resetAtMs: w.resetAtMs ?? null, tag: windowTag(w, kind), kind } : null;

  let short = toInfo(shortW, 'short');
  const long = toInfo(longW, 'long');
  if (!short && !long && typeof sub.remainingPercent === 'number') {
    short = { pct: clamp(sub.remainingPercent, 0, 100), resetAtMs: sub.soonestResetAtMs ?? null, tag: '', kind: 'short' };
  }
  return { short, long };
}

/**
 * Which windows to draw as rings, outer first, for a window mode:
 * 'short' → 5h only, 'weekly' → weekly only, anything else → both.
 * `focus` is the ring whose number is shown (the tightest one).
 */
function ringsFor(sub, windowMode, color) {
  const { short, long } = splitWindows(sub);
  let list;
  if (windowMode === 'short') list = [short || long];
  else if (windowMode === 'weekly') list = [long || short];
  else list = [short, long];
  list = list.filter(Boolean);
  const rings = list.map((w, i) => ({ ...w, color: i === 0 ? color : secondaryTone(color) }));
  const focus = rings.length ? rings.reduce((m, c) => (c.pct < m.pct ? c : m)) : null;
  return { rings, focus };
}

function computeCenterMetric(subs, centerMetric = 'avg') {
  const valid = subs.filter((s) => s.status === 'ok' && typeof s.remainingPercent === 'number');
  if (valid.length === 0) {
    return { value: '--', suffix: '', label: `${subs.length} subs, no data`, numeric: null };
  }
  const avg = Math.round(valid.reduce((acc, s) => acc + s.remainingPercent, 0) / valid.length);
  const min = Math.round(Math.min(...valid.map((s) => s.remainingPercent)));
  if (centerMetric === 'min') return { value: min, suffix: '%', label: `${min}% lowest left`, numeric: min };
  if (centerMetric === 'count') return { value: valid.length, suffix: '', label: `${valid.length} active subs`, numeric: avg };
  return { value: avg, suffix: '%', label: `${avg}% average left`, numeric: avg };
}

/** Account colour: the n-th account of a provider always gets the n-th variant, on every key. */
function accountColor(sub, index, theme, fallbackOcc = 0) {
  const occ = hasSiblings(sub) ? sub.dupIndex - 1 : fallbackOcc;
  return getSubscriptionColor(sub, index, occ, theme);
}

function assignColors(subs, theme) {
  const counts = new Map();
  return subs.map((sub, i) => {
    const occ = counts.get(sub.provider) || 0;
    counts.set(sub.provider, occ + 1);
    return accountColor(sub, i, theme, occ);
  });
}

function numberColor(numeric) {
  return numeric !== null && numeric <= LOW ? ERROR_COLOR : TEXT;
}

function lowestFirst(subs, limit) {
  if (subs.length <= limit) return subs;
  return [...subs].sort((a, b) => (a.remainingPercent ?? -1) - (b.remainingPercent ?? -1)).slice(0, limit);
}

function subsLabel(subs) {
  return subs
    .map((s) => `${s.displayTitle || s.providerLabel || s.provider} ${s.status === 'error' ? 'error' : `${Math.round(pctOf(s) ?? 0)}%`}`)
    .join(', ');
}

function hasSiblings(sub) {
  return sub.dupIndex !== null && sub.dupIndex !== undefined;
}

/**
 * Provider logo for a subscription. When a provider has several accounts, each account's logo
 * is drawn in that account's own ring colour so logo and ring visibly belong together, and with
 * `showIndex` the account number is set beside the logo at full text size (a badge digit would
 * be ~4px on a 72px key).
 */
function logo(sub, { cx, cy, size, color, theme, showIndex = false }) {
  const mono = theme === 'mono' || hasSiblings(sub);
  const fallbackLabel = sub.shortCode || sub.providerLabel;
  if (!(showIndex && hasSiblings(sub))) {
    return renderProviderIcon(sub.provider, { cx, cy, size, color, fallbackLabel, mono });
  }
  const digit = String(sub.dupIndex);
  const fs = size * 0.95;
  const gap = size * 0.14;
  const digitW = fs * 0.6 * digit.length;
  const total = size + gap + digitW;
  const left = cx - total / 2;
  return (
    renderProviderIcon(sub.provider, { cx: left + size / 2, cy, size, color, fallbackLabel, mono }) +
    textEl(left + size + gap + digitW / 2, cy + fs * 0.02, digit, { size: fs, weight: 800, color })
  );
}

function emptyGauge() {
  return renderStatusGauge({ kind: 'empty', title: 'NO SUBS', subtitle: 'TAP SYNC' });
}

/* ---------------------------------------------------------------- all-subs styles */

/**
 * Style "concentric" (default): Activity rings.
 * One nested 270° ring per subscription (outer → inner), all showing the same limit (5h or
 * weekly, `ringsWindow`), the overall number in the middle, and the matching logos in the open
 * bottom, left → right = outer → inner.
 */
export function renderConcentricGauge(subs, options = {}) {
  const { theme = 'provider', centerMetric = 'avg' } = options;
  // Every ring shows the same limit, so rings (and the middle number) compare like with like.
  const limit = options.ringsWindow === 'weekly' ? 'weekly' : 'short';
  if (!subs || subs.length === 0) return emptyGauge();
  if (subs.length === 1) return renderSingleSubGauge(subs[0], { ...options, windowMode: limit });

  const limited = subs.map((sub) => {
    if (sub.status !== 'ok') return sub;
    const w = splitWindows(sub);
    const chosen = limit === 'weekly' ? w.long || w.short : w.short || w.long;
    return { ...sub, remainingPercent: chosen ? chosen.pct : null };
  });
  const displaySubs = lowestFirst(limited, 6);
  const count = displaySubs.length;
  const colors = assignColors(displaySubs, theme);
  const metric = computeCenterMetric(limited, centerMetric);
  const limitName = limit === 'weekly' ? 'weekly' : '5h';

  const cy = 64;
  const start = 225;
  const sweep = 270;
  const layouts = {
    2: { outer: 61, w: 13, gap: 2.5, num: 32, logo: 22 },
    3: { outer: 62, w: 11, gap: 2, num: 28, logo: 21 },
    4: { outer: 62.5, w: 9, gap: 1.8, num: 25, logo: 19 },
    5: { outer: 63, w: 7.6, gap: 1.6, num: 22, logo: 17 },
    6: { outer: 63, w: 6.6, gap: 1.4, num: 20, logo: 15.5 },
  };
  const L = layouts[count] || layouts[6];

  const rings = displaySubs
    .map((sub, i) => {
      const r = L.outer - L.w / 2 - i * (L.w + L.gap);
      return ring(CX, cy, r, L.w, start, sweep, pctOf(sub), colors[i], { error: sub.status === 'error' });
    })
    .join('\n  ');

  const spacing = L.logo + 6;
  const rowStartX = CX - ((count - 1) * spacing) / 2;
  const logos = displaySubs
    .map((sub, i) => logo(sub, { cx: rowStartX + i * spacing, cy: 130, size: L.logo, color: colors[i], theme }))
    .join('');

  const innerR = L.outer - count * (L.w + L.gap) + L.gap;
  const center = bigNumber(CX, cy, metric.value, {
    size: L.num,
    suffix: metric.suffix,
    color: numberColor(metric.numeric),
    maxWidth: innerR * 2 - 8,
  });

  return svgDoc(`${rings}\n  ${center}\n  ${logos}`, `${limitName} limit: ${metric.label}. ${subsLabel(displaySubs)}`);
}

/**
 * Style "grid": a watch face of small complications, one per subscription. Each shows the
 * provider logo inside its ring(s) — outer = 5h, inner = weekly when both are shown — and the
 * number when there is room (up to 4 subscriptions).
 */
export function renderMiniDonutsGrid(subs, options = {}) {
  const { theme = 'provider', windowMode = 'bottleneck' } = options;
  if (!subs || subs.length === 0) return emptyGauge();
  if (subs.length === 1) return renderSingleSubGauge(subs[0], options);

  const displaySubs = lowestFirst(subs, 6);
  const count = displaySubs.length;
  const colors = assignColors(displaySubs, theme);

  let positions;
  let R; // outer radius of each complication
  if (count === 2) {
    positions = [{ x: 36.5, y: 72 }, { x: 107.5, y: 72 }];
    R = 34;
  } else if (count <= 4) {
    positions = [{ x: 36, y: 36 }, { x: 108, y: 36 }, { x: 36, y: 108 }, { x: 108, y: 108 }];
    if (count === 3) positions = [positions[0], positions[1], { x: 72, y: 108 }];
    R = 34;
  } else {
    positions = [
      { x: 24, y: 47 }, { x: 72, y: 47 }, { x: 120, y: 47 },
      { x: 24, y: 97 }, { x: 72, y: 97 }, { x: 120, y: 97 },
    ];
    if (count === 5) positions = [...positions.slice(0, 3), { x: 48, y: 97 }, { x: 96, y: 97 }];
    R = 23;
  }
  const small = count > 4;

  const cells = displaySubs
    .map((sub, i) => {
      const { x, y } = positions[i];
      const error = sub.status === 'error';
      const { rings: rs, focus } = ringsFor(sub, windowMode, colors[i]);
      const drawn = error || rs.length === 0 ? [{ pct: null, color: colors[i] }] : rs;
      const two = drawn.length === 2;
      const w = small ? (two ? 4.6 : 6) : two ? 6.5 : 8;
      const gap = 1.5;

      let out = drawn
        .map((d, k) => ring(x, y, R - w / 2 - k * (w + gap), w, 0, 360, d.pct, d.color, { error }))
        .join('');
      const clear = R - drawn.length * (w + gap);

      if (small) {
        out += logo(sub, { cx: x, cy: y, size: Math.min(20, clear * 1.3), color: colors[i], theme });
      } else {
        const logoSize = two ? 16 : 19;
        out += logo(sub, { cx: x, cy: y - clear * 0.42, size: logoSize, color: colors[i], theme, showIndex: true });
        const val = error ? '!' : focus ? `${Math.round(focus.pct)}` : '--';
        const col = error ? ERROR_COLOR : numberColor(focus ? focus.pct : null);
        out += textEl(x, y + clear * 0.42, val, { size: fitSize(val, two ? 19 : 23, clear * 1.6, DIGIT_W), color: col });
      }
      return out;
    })
    .join('\n  ');

  return svgDoc(cells, subsLabel(displaySubs));
}

/**
 * Style "segmented": one thick ring split into an arc per subscription with the logo inside
 * each arc and the overall number in the middle.
 */
export function renderSegmentedHaloGauge(subs, options = {}) {
  const { theme = 'provider', centerMetric = 'avg', windowMode = 'bottleneck' } = options;
  if (!subs || subs.length === 0) return emptyGauge();
  if (subs.length === 1) return renderSingleSubGauge(subs[0], options);

  const displaySubs = lowestFirst(subs, 8);
  const count = displaySubs.length;
  const colors = assignColors(displaySubs, theme);
  const metric = computeCenterMetric(subs, centerMetric);

  const outerR = 62;
  const strokeW = count <= 4 ? 13 : count <= 6 ? 11.5 : 10;
  const ringR = outerR - strokeW / 2;
  const capDeg = ((strokeW + 7) / (2 * Math.PI * ringR)) * 360;
  const gapDeg = Math.max(capDeg, count === 2 ? 16 : 0);
  const slotSpan = (360 - gapDeg * count) / count;
  const capPad = (strokeW / 2 / (2 * Math.PI * ringR)) * 360;
  const logoSize = count <= 3 ? 23 : count === 4 ? 21 : count <= 6 ? 18 : 15;
  const logoR = ringR - strokeW / 2 - 4 - logoSize / 2;
  const baseRotation = count === 3 ? -60 : 0;

  // "5h + weekly": split each arc into two bands, outer = 5h, inner = weekly — the same
  // outer/inner rule as the grid and the detail key. Above 6 subs the bands get too thin.
  const splitBands = count <= 6 && windowMode !== 'short' && windowMode !== 'weekly';
  const capPadAt = (w, r) => (w / 2 / (2 * Math.PI * r)) * 360;

  const segments = displaySubs
    .map((sub, i) => {
      const startDeg = baseRotation + i * (slotSpan + gapDeg) + gapDeg / 2;
      const endDeg = startDeg + slotSpan;
      const error = sub.status === 'error';
      const bands = !error && splitBands ? ringsFor(sub, windowMode, colors[i]).rings : [];
      let arc;
      if (bands.length === 2) {
        const bandGap = 1.6;
        const w1 = strokeW * 0.58;
        const w2 = strokeW - w1 - bandGap;
        const r1 = ringR + (strokeW - w1) / 2;
        const r2 = r1 - w1 / 2 - bandGap - w2 / 2;
        arc =
          ring(CX, CY, r1, w1, startDeg + capPadAt(w1, r1), slotSpan - 2 * capPadAt(w1, r1), bands[0].pct, bands[0].color) +
          ring(CX, CY, r2, w2.toFixed(2), startDeg + capPadAt(w2, r2), slotSpan - 2 * capPadAt(w2, r2), bands[1].pct, bands[1].color);
      } else {
        const s0 = startDeg + capPad;
        const s1 = endDeg - capPad;
        arc = ring(CX, CY, ringR, strokeW, s0, s1 - s0, pctOf(sub), colors[i], { error });
      }
      const pt = polarToCartesian(CX, CY, logoR, startDeg + slotSpan / 2);
      return arc + logo(sub, { cx: pt.x, cy: pt.y, size: logoSize, color: colors[i], theme });
    })
    .join('\n  ');

  const innerClear = logoR - logoSize / 2 - 3;
  const center = bigNumber(CX, CY, metric.value, {
    size: count <= 4 ? 32 : 28,
    suffix: metric.suffix,
    color: numberColor(metric.numeric),
    maxWidth: innerClear * 2 - 4,
  });

  return svgDoc(`${segments}\n  ${center}`, `${metric.label}. ${subsLabel(displaySubs)}`);
}

/**
 * Dispatcher for the All Subscriptions action.
 */
export function renderAllSubsGauge(subs, options = {}) {
  const style = options.gaugeStyle || 'concentric';
  if (style === 'segmented') return renderSegmentedHaloGauge(subs, options);
  if (style === 'grid') return renderMiniDonutsGrid(subs, options);
  return renderConcentricGauge(subs, options);
}

/* ---------------------------------------------------------------- single subscription */

/**
 * One subscription, Activity style: outer ring = 5h window, inner ring = weekly window (or a
 * single thicker ring when only one is shown). Logo on top, the tightest window's % left in
 * the middle, and "<window> <time to reset>" in the open bottom.
 */
export function renderSingleSubGauge(sub, options = {}) {
  if (!sub) return renderStatusGauge({ kind: 'empty', title: 'NO SUB', subtitle: 'PICK ONE' });

  const { theme = 'provider', showReset = true, nowMs = Date.now(), windowMode = 'bottleneck' } = options;
  const error = sub.status === 'error';
  const color = accountColor(sub, 0, theme);
  const { rings: rs, focus } = ringsFor(sub, windowMode, color);
  const drawn = error || rs.length === 0 ? [{ pct: null, color }] : rs;
  const two = drawn.length === 2;

  const start = 225;
  const sweep = 270;
  const outer = 66;
  const w = two ? 12 : 15;
  const gap = 2.5;
  const ringsSvg = drawn
    .map((d, k) => ring(CX, CY, outer - w / 2 - k * (w + gap), w, start, sweep, d.pct, d.color, { error }))
    .join('\n  ');
  const clear = outer - drawn.length * (w + gap) + gap; // inner edge of innermost ring

  const logoSize = two ? 24 : 28;
  const logoCy = two ? 47 : 44;
  const logoSvg = logo(sub, { cx: CX, cy: logoCy, size: logoSize, color, theme, showIndex: true });

  const numY = two ? 81 : 83;
  let value;
  if (error) {
    value = textEl(CX, numY, 'ERR', { size: 30, color: ERROR_COLOR });
  } else if (focus) {
    const dy = numY + 12 - CY;
    value = bigNumber(CX, numY, Math.round(focus.pct), {
      size: two ? 33 : 40,
      color: numberColor(focus.pct),
      suffixColor: focus.pct <= LOW ? ERROR_COLOR : focus.color,
      maxWidth: 2 * Math.sqrt(Math.max(0, clear ** 2 - dy ** 2)) - 4,
    });
  } else {
    value = bigNumber(CX, numY, '--', { size: 32, suffix: '' });
  }

  const reset = showReset && focus ? formatResetCountdown(focus.resetAtMs ?? sub.soonestResetAtMs, nowMs) : null;
  let caption;
  if (error) {
    caption = captionEl(CX, 130, '', String(sub.error || 'error').replace(/^HTTP\s*/i, '').slice(0, 8), { size: 19, maxWidth: 112 });
  } else if (reset) {
    caption = captionEl(CX, 130, two ? focus.tag : '', reset, { size: 20, tagColor: focus.color, maxWidth: 116 });
  } else {
    const fallback = sub.plan ? String(sub.plan) : sub.displayTitle || sub.providerLabel || '';
    caption = captionEl(CX, 130, '', fallback.toUpperCase().slice(0, 9), { size: 18, maxWidth: 112 });
  }

  const name = sub.displayTitle || sub.providerLabel || sub.provider;
  const label = error
    ? `${name}: error`
    : `${name}: ${rs.map((r) => `${r.tag || 'quota'} ${Math.round(r.pct)}% left`).join(', ')}${reset ? `, resets in ${reset}` : ''}`;
  return svgDoc(`${ringsSvg}\n  ${logoSvg}\n  ${value}\n  ${caption}`, label);
}

/* ---------------------------------------------------------------- transient states */

/**
 * Sync spinner (frame 0..7 rotates 45° per step): bright head with a fading tail.
 */
export function renderLoadingGauge(frame = 0, subtitle = 'SYNC') {
  const rot = (frame * 45) % 360;
  const r = 59;
  const w = 12;
  const body = [
    `<circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="${TRACK_COLOR}" stroke-width="${w}"/>`,
    arcStroke(CX, CY, r, rot - 70, rot - 25, '#ffffff', w, ' stroke-opacity="0.2"'),
    arcStroke(CX, CY, r, rot - 35, rot + 10, '#ffffff', w, ' stroke-opacity="0.45"'),
    arcStroke(CX, CY, r, rot, rot + 70, '#ffffff', w),
    textEl(CX, CY, subtitle, { size: fitSize(subtitle, 22, 84), color: TEXT_DIM, spacing: 1 }),
  ].join('\n  ');
  return svgDoc(body, 'Syncing quotas');
}

/**
 * Status ring for setup, auth error, offline, or empty states. Words auto-fit the ring.
 */
export function renderStatusGauge({ kind = 'setup', title = 'SETUP', subtitle = 'OPEN PI' } = {}) {
  const accentMap = {
    setup: '#0a84ff',
    auth: '#ffd60a',
    offline: '#ff453a',
    empty: '#98989d',
    error: '#ff453a',
  };
  const accent = accentMap[kind] || '#98989d';
  const body = [
    `<circle cx="${CX}" cy="${CY}" r="60" fill="none" stroke="${accent}" stroke-width="9"/>`,
    textEl(CX, CY - 9, title, { size: fitSize(title, 30, 90) }),
    textEl(CX, CY + 18, subtitle, { size: fitSize(subtitle, 17, 80, 0.66), color: accent, spacing: 0.4 }),
  ].join('\n  ');
  return svgDoc(body, `${title} ${subtitle}`);
}
