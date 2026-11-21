#!/usr/bin/env node
/**
 * Generates the plugin's brand mark, category icon, action-list icons and default key images.
 *
 *   node scripts/make-icons.mjs
 *
 * Design: the same Activity-style rings the keys use. Outer warm ring = 5h limit,
 * inner cool ring = weekly limit, round caps, tinted tracks, on black.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'dev.cliproxyapi.opendeck.sdPlugin', 'icons');

function pt(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arc(cx, cy, r, from, to) {
  const sweep = Math.min(to - from, 359.9);
  const [x1, y1] = pt(cx, cy, r, from);
  const [x2, y2] = pt(cx, cy, r, from + sweep);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const WARM = ['#FFB36B', '#FF6A3D']; // 5h ring
const COOL = ['#7FD4FF', '#2F7BFF']; // weekly ring
const WARM_TRACK = '#3A1D12';
const COOL_TRACK = '#0F2340';

function gradients(prefix) {
  return `<defs>
    <linearGradient id="${prefix}w" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${WARM[1]}"/><stop offset="1" stop-color="${WARM[0]}"/></linearGradient>
    <linearGradient id="${prefix}c" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${COOL[1]}"/><stop offset="1" stop-color="${COOL[0]}"/></linearGradient>
  </defs>`;
}

/** Two open 270° rings, like the detail key. */
function twoRings({ cx, cy, outerR, w, gap, warmPct, coolPct, prefix, tracks = true }) {
  const start = 225;
  const sweep = 270;
  const r1 = outerR - w / 2;
  const r2 = r1 - w - gap;
  const track = (r, color) =>
    tracks ? `<path d="${arc(cx, cy, r, start, start + sweep)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>` : '';
  return `${track(r1, WARM_TRACK)}${track(r2, COOL_TRACK)}
  <path d="${arc(cx, cy, r1, start, start + (sweep * warmPct) / 100)}" fill="none" stroke="url(#${prefix}w)" stroke-width="${w}" stroke-linecap="round"/>
  <path d="${arc(cx, cy, r2, start, start + (sweep * coolPct) / 100)}" fill="none" stroke="url(#${prefix}c)" stroke-width="${w}" stroke-linecap="round"/>`;
}

function write(name, svg) {
  fs.writeFileSync(path.join(iconsDir, name), `${svg.trim()}\n`);
  console.log('wrote', name);
}

// Brand mark: black squircle, two rings, soft top sheen. Used as the plugin icon.
function brandMark(size) {
  const s = size / 144;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 144 144">
  ${gradients('b')}
  <defs>
    <linearGradient id="bs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26262b"/><stop offset="1" stop-color="#050506"/></linearGradient>
  </defs>
  <rect width="144" height="144" rx="34" fill="url(#bs)"/>
  <rect x="0.75" y="0.75" width="142.5" height="142.5" rx="33.25" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1.5"/>
  ${twoRings({ cx: 72, cy: 74, outerR: 52, w: 15, gap: 5, warmPct: 72, coolPct: 46, prefix: 'b' })}
</svg>`.replace(/\n\s*\n/g, '\n') + (s ? '' : '');
}

write('plugin.svg', brandMark(144));
fs.writeFileSync(path.join(root, 'assets', 'icon.svg'), `${brandMark(144).trim()}\n`);
console.log('wrote assets/icon.svg');

// Category icon: 20px glyph next to the category name on OpenDeck's dark sidebar → single colour.
write(
  'category.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <path d="${arc(24, 25, 18, 225, 225 + 270)}" fill="none" stroke="#e5e5e5" stroke-opacity="0.28" stroke-width="6" stroke-linecap="round"/>
  <path d="${arc(24, 25, 18, 225, 225 + 195)}" fill="none" stroke="#e5e5e5" stroke-width="6" stroke-linecap="round"/>
  <path d="${arc(24, 25, 8, 225, 225 + 270)}" fill="none" stroke="#e5e5e5" stroke-opacity="0.28" stroke-width="6" stroke-linecap="round"/>
  <path d="${arc(24, 25, 8, 225, 225 + 125)}" fill="none" stroke="#e5e5e5" stroke-width="6" stroke-linecap="round"/>
</svg>`,
);

// "All subscriptions": three nested rings in provider-like colours, one per subscription.
function allSubsArt() {
  const rings = [
    { r: 55, c: '#3186FF', p: 82 },
    { r: 41, c: '#D97757', p: 58 },
    { r: 27, c: '#F4F4F5', p: 34 },
  ];
  const tint = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const k = 0.24;
    return `#${[16, 8, 0].map((sh) => Math.round(((n >> sh) & 255) * k).toString(16).padStart(2, '0')).join('')}`;
  };
  const body = rings
    .map(
      ({ r, c, p }) =>
        `<path d="${arc(72, 72, r, 225, 495)}" fill="none" stroke="${tint(c)}" stroke-width="12" stroke-linecap="round"/>` +
        `<path d="${arc(72, 72, r, 225, 225 + 2.7 * p)}" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round"/>`,
    )
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" fill="#000000"/>
  ${body}
</svg>`;
}

// "Subscription detail": the two-ring 5h/weekly mark, bigger and bolder.
function singleArt() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  ${gradients('s')}
  <rect width="144" height="144" fill="#000000"/>
  ${twoRings({ cx: 72, cy: 74, outerR: 64, w: 17, gap: 5, warmPct: 72, coolPct: 46, prefix: 's' })}
</svg>`;
}

write('action-all-subs.svg', allSubsArt());
write('action-single-sub.svg', singleArt());
write('key-all-subs.svg', allSubsArt());
write('key-single-sub.svg', singleArt());
