#!/usr/bin/env node
/**
 * Renders example keys from sample data:
 *   docs/keys/*.svg      images used by the README
 *   dist/preview.html    a gallery of every style and state, for checking changes by eye
 *
 *   npm run preview
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareSubscriptionsForDisplay } from '../dev.cliproxyapi.opendeck.sdPlugin/lib/cliproxy.mjs';
import {
  renderAllSubsGauge,
  renderLoadingGauge,
  renderSingleSubGauge,
  renderStatusGauge,
} from '../dev.cliproxyapi.opendeck.sdPlugin/lib/renderer.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Fixed clock so the images don't change on every run.
const now = Date.UTC(2026, 0, 1, 12, 0, 0);
const hours = (h) => now + h * 3600_000;

function sub(id, provider, label, plan, windows) {
  return {
    id,
    name: `${id}.json`,
    provider,
    providerLabel: label,
    accountLabel: `${id}@example.com`,
    plan,
    status: 'ok',
    error: null,
    fetchedAt: now,
    windows: windows.map(([pct, resetH, periodHours]) => ({
      id: periodHours <= 24 ? 'five-hour' : 'seven-day',
      label: periodHours <= 24 ? '5h' : '7d',
      remainingPercent: pct,
      resetAtMs: hours(resetH),
      periodHours,
    })),
  };
}

const raw = [
  sub('antigravity', 'antigravity', 'Antigravity', 'Pro', [[92, 4, 5]]),
  sub('claude-a', 'claude', 'Claude', 'Max', [[64, 2.2, 5], [81, 96, 168]]),
  sub('claude-b', 'claude', 'Claude', 'Pro', [[12, 0.87, 5], [54, 48, 168]]),
  sub('codex', 'codex', 'Codex', 'Plus', [[86, 3.5, 5], [73, 120, 168]]),
  sub('kimi', 'kimi', 'Kimi', 'Coding', [[84, 8, 24]]),
];
const subs = prepareSubscriptionsForDisplay(raw, { windowMode: 'bottleneck', groupMode: 'account' });
const four = subs.slice(0, 4);

const keys = [
  { file: 'rings', title: 'Rings', note: 'One ring per subscription, 5h left', svg: renderAllSubsGauge(four, { gaugeStyle: 'concentric' }) },
  { file: 'grid', title: 'Grid', note: 'Outer ring 5h, inner ring weekly', svg: renderAllSubsGauge(four, { gaugeStyle: 'grid' }) },
  { file: 'dial', title: 'Dial', note: 'One arc per subscription, 5h and weekly bands', svg: renderAllSubsGauge(four, { gaugeStyle: 'segmented' }) },
  { file: 'detail', title: 'Detail', note: 'Claude 2: 12% of 5h left, resets in 52m', svg: renderSingleSubGauge(subs[2], { nowMs: now }) },
  { file: 'detail-weekly', title: 'Detail, weekly', note: 'Codex, weekly limit only', svg: renderSingleSubGauge(subs[3], { nowMs: now, windowMode: 'weekly' }) },
];
const states = [
  { title: 'Syncing', svg: renderLoadingGauge(2, 'SYNC') },
  { title: 'Not set up', svg: renderStatusGauge({ kind: 'setup', title: 'SETUP', subtitle: 'OPEN PI' }) },
  { title: 'Wrong password', svg: renderStatusGauge({ kind: 'auth', title: 'AUTH', subtitle: 'CHECK KEY' }) },
  { title: 'Offline', svg: renderStatusGauge({ kind: 'offline', title: 'OFFLINE', subtitle: 'TAP SYNC' }) },
];

const docsDir = path.join(root, 'docs', 'keys');
fs.mkdirSync(docsDir, { recursive: true });
for (const k of keys) fs.writeFileSync(path.join(docsDir, `${k.file}.svg`), `${k.svg}\n`);

const tile = (t) => `<figure><div class="key">${t.svg}</div><figcaption><b>${t.title}</b>${t.note ? `<br>${t.note}` : ''}</figcaption></figure>`;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Key preview</title>
<style>
  body { margin: 0; padding: 24px; background: #171717; color: #d4d4d4; font: 13px/1.4 system-ui, sans-serif; }
  h2 { font-size: 13px; font-weight: 600; color: #a3a3a3; margin: 24px 0 12px; }
  .row { display: flex; flex-wrap: wrap; gap: 16px; }
  figure { margin: 0; width: 144px; }
  .key { width: 144px; height: 144px; border-radius: 16px; overflow: hidden; background: #000; }
  .key.small { width: 72px; height: 72px; border-radius: 10px; }
  .key svg { display: block; width: 100%; height: 100%; }
  figcaption { margin-top: 8px; color: #a3a3a3; }
  figcaption b { color: #f5f5f5; font-weight: 600; }
</style>
</head>
<body>
  <h2>Keys</h2>
  <div class="row">${keys.map(tile).join('')}</div>
  <h2>Actual size on a Stream Deck MK.2 (72px)</h2>
  <div class="row">${keys.map((k) => `<div class="key small">${k.svg}</div>`).join('')}</div>
  <h2>States</h2>
  <div class="row">${states.map(tile).join('')}</div>
</body>
</html>
`;
const distDir = path.join(root, 'dist');
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, 'preview.html'), html);
console.log(`Wrote ${keys.length} images to docs/keys and dist/preview.html`);
