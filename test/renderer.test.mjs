import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderAllSubsGauge,
  renderConcentricGauge,
  renderLoadingGauge,
  renderMiniDonutsGrid,
  renderSegmentedHaloGauge,
  renderSingleSubGauge,
  renderStatusGauge,
  splitWindows,
  svgToDataUri,
} from '../dev.cliproxyapi.opendeck.sdPlugin/lib/renderer.mjs';
import { renderProviderIcon } from '../dev.cliproxyapi.opendeck.sdPlugin/lib/icons.mjs';

const sampleSubs = [
  {
    id: 'ag',
    name: 'antigravity.json',
    provider: 'antigravity',
    providerLabel: 'Antigravity',
    displayTitle: 'Antigravity',
    shortCode: 'AG',
    accountLabel: 'user',
    status: 'ok',
    remainingPercent: 90,
    primaryWindow: { label: '5h', remainingPercent: 90 },
    secondaryWindow: null,
    soonestResetAtMs: Date.now() + 7200_000,
  },
  {
    id: 'c1',
    name: 'claude-1.json',
    provider: 'claude',
    providerLabel: 'Claude',
    displayTitle: 'Claude 1',
    shortCode: 'C1',
    accountLabel: 'user1',
    status: 'ok',
    remainingPercent: 60,
    primaryWindow: { label: '5h', remainingPercent: 60 },
    secondaryWindow: { label: '7d', remainingPercent: 80 },
    soonestResetAtMs: Date.now() + 3600_000,
  },
  {
    id: 'c2',
    name: 'claude-2.json',
    provider: 'claude',
    providerLabel: 'Claude',
    displayTitle: 'Claude 2',
    shortCode: 'C2',
    accountLabel: 'user2',
    status: 'ok',
    remainingPercent: 0,
    primaryWindow: { label: '5h', remainingPercent: 0 },
    secondaryWindow: null,
    soonestResetAtMs: Date.now() + 1800_000,
  },
  {
    id: 'cx',
    name: 'codex.json',
    provider: 'codex',
    providerLabel: 'Codex',
    displayTitle: 'Codex',
    shortCode: 'CX',
    accountLabel: 'user',
    plan: 'plus',
    status: 'ok',
    remainingPercent: 100,
    primaryWindow: { label: '5h', remainingPercent: 100 },
    secondaryWindow: { label: '7d', remainingPercent: 70 },
    soonestResetAtMs: Date.now() + 10800_000,
  },
];

function assertValidSvg(svg) {
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"'));
  assert.ok(svg.trim().endsWith('</svg>'));
  assert.ok(!svg.includes('NaN'));
  assert.ok(!svg.includes('undefined'));
}

test('renderConcentricGauge renders a valid 144x144 SVG for 1 to 7 subscriptions', () => {
  for (let count = 1; count <= 7; count += 1) {
    const list = Array.from({ length: count }, (_, i) => ({
      ...sampleSubs[i % sampleSubs.length],
      id: `sub-${i}`,
    }));
    const svg = renderConcentricGauge(list, { theme: 'provider', centerMetric: 'avg' });
    assertValidSvg(svg);
  }
});

test('renderSegmentedHaloGauge renders arcs, provider logos and the middle number', () => {
  const svg = renderSegmentedHaloGauge(sampleSubs, { theme: 'provider', centerMetric: 'min' });
  assertValidSvg(svg);
  assert.ok(svg.includes('fill="#000000"'));
  assert.ok(svg.includes('0% lowest left'));
  assert.ok(svg.includes('0%'));
  assert.ok(svg.includes('<g transform="translate('));

  // Adaptive scaling with dynamically added unknown provider uses monogram icon
  const withDynamic = [
    ...sampleSubs,
    { ...sampleSubs[0], id: 'zp', provider: 'zhipu', providerLabel: 'Zhipu', shortCode: 'ZP' },
  ];
  const svgDyn = renderSegmentedHaloGauge(withDynamic, { theme: 'provider', centerMetric: 'avg' });
  assertValidSvg(svgDyn);
  assert.ok(svgDyn.includes('>Z<'), 'unknown providers fall back to a monogram tile');
});

test('renderMiniDonutsGrid renders 2x2 grid for 4 subs and 3x2 for 6 subs with provider icons', () => {
  const svg4 = renderMiniDonutsGrid(sampleSubs, { theme: 'traffic' });
  assertValidSvg(svg4);
  assert.ok(svg4.includes('>90<'));
  assert.ok(svg4.includes('>60<'));
  assert.ok(svg4.includes('>0<'));
  assert.ok(svg4.includes('>100<'));
  assert.ok(svg4.includes('<g transform="translate('));

  const subs6 = [
    ...sampleSubs,
    { ...sampleSubs[0], id: 'km', provider: 'kimi', shortCode: 'KM', remainingPercent: 84 },
    { ...sampleSubs[0], id: 'gk', provider: 'xai', shortCode: 'GK', remainingPercent: 45 },
  ];
  const svg6 = renderMiniDonutsGrid(subs6, { theme: 'mono' });
  assertValidSvg(svg6);
  assert.ok(svg6.includes('fill="#000000"'));
  // 5-6 cells are too small for numbers on a 72px key: logos + rings only, values in the label
  assert.ok(svg6.includes('84%'));
  assert.ok(svg6.includes('45%'));
});

test('renderSingleSubGauge shows provider icon, percentage, and reset countdown', () => {
  const svg = renderSingleSubGauge({ ...sampleSubs[1], dupIndex: 1 }, { showReset: true });
  assertValidSvg(svg);
  assert.ok(svg.includes('<g transform="translate('));
  assert.ok(svg.includes('60%'));
  assert.ok(svg.includes('59m') || svg.includes('1h'));
});

test('renderLoadingGauge and renderStatusGauge produce valid SVGs and base64 data URIs', () => {
  for (let f = 0; f < 8; f += 1) {
    assertValidSvg(renderLoadingGauge(f));
  }
  const statusSvg = renderStatusGauge({ kind: 'auth', title: 'AUTH', subtitle: 'CHECK KEY' });
  assertValidSvg(statusSvg);
  const uri = svgToDataUri(statusSvg);
  assert.ok(uri.startsWith('data:image/svg+xml;base64,'));
});

test('renderAllSubsGauge handles empty and error states gracefully', () => {
  assertValidSvg(renderAllSubsGauge([]));
  const withErr = [
    ...sampleSubs.slice(0, 2),
    { ...sampleSubs[2], status: 'error', remainingPercent: null, error: 'HTTP 429' },
  ];
  assertValidSvg(renderAllSubsGauge(withErr, { gaugeStyle: 'concentric' }));
  assertValidSvg(renderAllSubsGauge(withErr, { gaugeStyle: 'segmented' }));
  assertValidSvg(renderAllSubsGauge(withErr, { gaugeStyle: 'grid' }));
});

const twoWindowSub = {
  id: 'c1',
  name: 'claude-1.json',
  provider: 'claude',
  providerLabel: 'Claude',
  displayTitle: 'Claude',
  status: 'ok',
  remainingPercent: 40,
  windows: [
    { id: 'five-hour', label: '5h', remainingPercent: 64, resetAtMs: 1_000_000 + 2 * 3600_000, periodHours: 5 },
    { id: 'seven-day', label: '7d', remainingPercent: 40, resetAtMs: 1_000_000 + 50 * 3600_000, periodHours: 168 },
  ],
  soonestResetAtMs: 1_000_000 + 2 * 3600_000,
};

test('splitWindows separates the 5h and weekly windows and tags them', () => {
  const { short, long } = splitWindows(twoWindowSub);
  assert.equal(short.pct, 64);
  assert.equal(short.tag, '5H');
  assert.equal(long.pct, 40);
  assert.equal(long.tag, 'WK');
  const onlySummary = splitWindows({ remainingPercent: 70, windows: [] });
  assert.equal(onlySummary.short.pct, 70);
  assert.equal(onlySummary.long, null);
});

test('renderSingleSubGauge shows both windows and the tighter one with its reset time', () => {
  const svg = renderSingleSubGauge(twoWindowSub, { nowMs: 1_000_000 });
  assertValidSvg(svg);
  assert.ok(svg.includes('5H 64% left'));
  assert.ok(svg.includes('WK 40% left'));
  assert.ok(svg.includes('>40<tspan'), 'big number is the tighter (weekly) window');
  assert.ok(svg.includes('>WK<'), 'caption names the window');
  assert.ok(svg.includes('2d 2h'), 'caption shows that window\'s reset');

  const shortOnly = renderSingleSubGauge(twoWindowSub, { nowMs: 1_000_000, windowMode: 'short' });
  assert.ok(shortOnly.includes('>64<tspan'));
  assert.ok(shortOnly.includes('2h'));
  assert.ok(!shortOnly.includes('WK 40%'));
});

test('provider icons use the official logo marks, and colour marks stay visible on black', () => {
  const claude = renderProviderIcon('claude', { cx: 12, cy: 12, size: 24 });
  assert.ok(claude.includes('M4.709 15.955'), 'Claude logo path');
  const kimi = renderProviderIcon('kimi', { cx: 12, cy: 12, size: 24 });
  assert.ok(kimi.includes('color="#ffffff"'), 'currentColor parts default to white');
  const mono = renderProviderIcon('claude', { cx: 12, cy: 12, size: 24, color: '#abcdef', mono: true });
  assert.ok(mono.includes('fill="#abcdef"'));
});

test('Dial splits each arc into 5h and weekly bands only when both limits are shown', () => {
  const other = { ...twoWindowSub, id: 'cx', provider: 'codex', providerLabel: 'Codex' };
  const arcs = (svg) => (svg.match(/<path d="M[^"]*" fill="none" stroke=/g) || []).length;
  const both = renderSegmentedHaloGauge([twoWindowSub, other], { windowMode: 'bottleneck' });
  const shortOnly = renderSegmentedHaloGauge([twoWindowSub, other], { windowMode: 'short' });
  assertValidSvg(both);
  // per subscription: track + fill per band → 4 paths with two bands, 2 with one
  assert.equal(arcs(both), 8);
  assert.equal(arcs(shortOnly), 4);
});

test('Rings show the same limit on every ring: 5h by default, weekly when chosen', () => {
  const other = {
    ...twoWindowSub,
    id: 'cx',
    provider: 'codex',
    providerLabel: 'Codex',
    displayTitle: 'Codex',
    windows: [
      { id: 'five-hour', label: '5h', remainingPercent: 90, periodHours: 5 },
      { id: 'weekly', label: '7d', remainingPercent: 20, periodHours: 168 },
    ],
  };
  const fiveH = renderConcentricGauge([twoWindowSub, other], { centerMetric: 'avg' });
  assert.ok(fiveH.includes('5h limit: 77% average left'), 'avg of 64 and 90');
  assert.ok(fiveH.includes('Claude 64%') && fiveH.includes('Codex 90%'));

  const weekly = renderConcentricGauge([twoWindowSub, other], { centerMetric: 'avg', ringsWindow: 'weekly' });
  assert.ok(weekly.includes('weekly limit: 30% average left'), 'avg of 40 and 20');
  assert.ok(weekly.includes('Claude 40%') && weekly.includes('Codex 20%'));
});
