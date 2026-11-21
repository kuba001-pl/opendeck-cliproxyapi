#!/usr/bin/env node
/**
 * OpenDeck / Stream Deck plugin entrypoint for CLIProxyAPI Quotas.
 * Strictly read-only — queries CLIProxyAPI Management API and renders circular SVG gauges.
 */

import {
  CliProxyClient,
  CliProxyError,
  formatResetCountdown,
  isBcryptHash,
  normalizeBaseUrl,
  prepareSubscriptionsForDisplay,
} from '../lib/cliproxy.mjs';
import { getSubscriptionColor } from '../lib/colors.mjs';
import { renderProviderIconSvg } from '../lib/icons.mjs';
import {
  renderAllSubsGauge,
  renderLoadingGauge,
  renderSingleSubGauge,
  renderStatusGauge,
  svgToDataUri,
} from '../lib/renderer.mjs';
import { parseLaunchArgs, StreamDeckClient } from '../lib/streamdeck.mjs';

const ACTION_ALL_SUBS = 'dev.cliproxyapi.opendeck.allsubs';
const ACTION_SINGLE_SUB = 'dev.cliproxyapi.opendeck.singlesub';

const GAUGE_STYLES = ['concentric', 'grid', 'segmented'];

const DEFAULT_GLOBAL_SETTINGS = {
  baseUrl: 'http://127.0.0.1:8317',
  managementKey: '',
  refreshIntervalSec: 300,
  includeDisabled: false,
};

function defaultActionSettings(action) {
  if (action === ACTION_SINGLE_SUB) {
    return {
      targetSubscription: '',
      windowMode: 'bottleneck',
      theme: 'provider',
      showReset: true,
    };
  }
  return {
    gaugeStyle: 'concentric',
    centerMetric: 'avg',
    windowMode: 'bottleneck',
    ringsWindow: 'short',
    groupMode: 'account',
    theme: 'provider',
  };
}

const launch = parseLaunchArgs();
if (!launch.port || !launch.pluginUUID) {
  console.error('[cliproxyapi-opendeck] Missing -port or -pluginUUID launch arguments.');
  process.exit(1);
}

const sd = new StreamDeckClient(launch);
const client = new CliProxyClient(DEFAULT_GLOBAL_SETTINGS);

let globalSettings = { ...DEFAULT_GLOBAL_SETTINGS };
let hasLoadedGlobalSettings = false;
const instances = new Map(); // context -> { context, action, settings }
const activePIs = new Map(); // context -> action

let cache = {
  rawSubscriptions: [],
  fetchedAt: 0,
  apiMode: null,
  lastError: null, // { kind, code, status, message }
  inFlight: null,
};

let autoRefreshTimer = null;
let spinnerTimer = null;
let spinnerFrame = 0;

function log(msg) {
  const line = `[cliproxyapi] ${msg}`;
  console.log(line);
  sd.logMessage(line);
}

function stopSpinner() {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
}

function startSpinner(contexts) {
  stopSpinner();
  spinnerFrame = 0;
  const drawFrame = () => {
    const uri = svgToDataUri(renderLoadingGauge(spinnerFrame, 'SYNC'));
    for (const ctx of contexts) {
      if (instances.has(ctx)) {
        sd.setImage(ctx, uri);
      }
    }
    spinnerFrame = (spinnerFrame + 1) % 8;
  };
  drawFrame();
  spinnerTimer = setInterval(drawFrame, 190);
}

function renderErrorStatusSvg(err) {
  if (!err) {
    return renderStatusGauge({ kind: 'error', title: 'ERROR', subtitle: 'TAP SYNC' });
  }
  if (err.code === 'bcrypt_hash') {
    return renderStatusGauge({ kind: 'auth', title: 'HASH?', subtitle: 'USE PLAIN' });
  }
  if (err.code === 'banned' || err.status === 403) {
    return renderStatusGauge({ kind: 'auth', title: 'LOCKED', subtitle: '403 BAN' });
  }
  if (err.kind === 'auth') {
    return renderStatusGauge({ kind: 'auth', title: 'AUTH', subtitle: 'CHECK KEY' });
  }
  if (err.kind === 'offline') {
    return renderStatusGauge({ kind: 'offline', title: 'OFFLINE', subtitle: 'TAP SYNC' });
  }
  return renderStatusGauge({ kind: 'error', title: 'ERROR', subtitle: 'TAP SYNC' });
}

function renderInstance(instance) {
  const { context, action, settings } = instance;

  if (!client.isConfigured()) {
    sd.setImage(
      context,
      svgToDataUri(renderStatusGauge({ kind: 'setup', title: 'SETUP', subtitle: 'OPEN PI' })),
    );
    return;
  }

  if (cache.lastError && cache.rawSubscriptions.length === 0) {
    sd.setImage(context, svgToDataUri(renderErrorStatusSvg(cache.lastError)));
    return;
  }

  const displaySubs = prepareSubscriptionsForDisplay(cache.rawSubscriptions, {
    windowMode: settings.windowMode || 'bottleneck',
    groupMode: action === ACTION_ALL_SUBS ? (settings.groupMode || 'account') : 'account',
  });

  if (action === ACTION_SINGLE_SUB) {
    let selected = null;
    if (settings.targetSubscription) {
      selected = displaySubs.find(
        (s) => s.id === settings.targetSubscription || s.name === settings.targetSubscription,
      );
    }
    if (!selected && displaySubs.length > 0) {
      // Auto-select lowest remaining active sub (or first available)
      const okSubs = displaySubs.filter((s) => s.status === 'ok' && s.remainingPercent !== null);
      selected = okSubs.length > 0
        ? okSubs.reduce((min, cur) => (cur.remainingPercent < min.remainingPercent ? cur : min), okSubs[0])
        : displaySubs[0];
    }
    const svg = renderSingleSubGauge(selected, {
      windowMode: settings.windowMode || 'bottleneck',
      theme: settings.theme || 'provider',
      showReset: settings.showReset !== false,
    });
    sd.setImage(context, svgToDataUri(svg));
    return;
  }

  const svg = renderAllSubsGauge(displaySubs, {
    windowMode: settings.windowMode || 'bottleneck',
    ringsWindow: settings.ringsWindow || 'short',
    gaugeStyle: settings.gaugeStyle || 'concentric',
    centerMetric: settings.centerMetric || 'avg',
    theme: settings.theme || 'provider',
  });
  sd.setImage(context, svgToDataUri(svg));
}

function renderAllInstances() {
  for (const instance of instances.values()) {
    renderInstance(instance);
  }
}

function buildPiStatusPayload(context) {
  const instance = instances.get(context);
  const windowMode = instance?.settings?.windowMode || 'bottleneck';
  const groupMode = instance?.action === ACTION_ALL_SUBS ? (instance?.settings?.groupMode || 'account') : 'account';
  const theme = instance?.settings?.theme || 'provider';
  const displaySubs = prepareSubscriptionsForDisplay(cache.rawSubscriptions, { windowMode, groupMode });
  const accountSubs = prepareSubscriptionsForDisplay(cache.rawSubscriptions, { windowMode, groupMode: 'account' });

  let previewSvg = '';
  if (instance) {
    if (!client.isConfigured()) {
      previewSvg = renderStatusGauge({ kind: 'setup', title: 'SETUP', subtitle: 'OPEN PI' });
    } else if (cache.lastError && cache.rawSubscriptions.length === 0) {
      previewSvg = renderErrorStatusSvg(cache.lastError);
    } else if (instance.action === ACTION_SINGLE_SUB) {
      const target = instance.settings.targetSubscription
        ? accountSubs.find((s) => s.id === instance.settings.targetSubscription || s.name === instance.settings.targetSubscription)
        : accountSubs[0];
      previewSvg = renderSingleSubGauge(target || null, {
        windowMode,
        theme,
        showReset: instance.settings.showReset !== false,
      });
    } else {
      previewSvg = renderAllSubsGauge(displaySubs, {
        windowMode,
        ringsWindow: instance.settings.ringsWindow || 'short',
        gaugeStyle: instance.settings.gaugeStyle || 'concentric',
        centerMetric: instance.settings.centerMetric || 'avg',
        theme,
      });
    }
  }

  const providerCounts = new Map();
  return {
    type: 'state',
    configured: client.isConfigured(),
    authBlocked: client.isAuthBlocked(),
    loading: Boolean(cache.inFlight),
    apiMode: cache.apiMode,
    fetchedAt: cache.fetchedAt,
    error: cache.lastError,
    previewSvg,
    subscriptions: accountSubs.map((s, idx) => {
      const occ = providerCounts.get(s.provider) || 0;
      providerCounts.set(s.provider, occ + 1);
      const color = getSubscriptionColor(s, idx, occ, theme);
      return {
        id: s.id,
        name: s.name,
        provider: s.provider,
        providerLabel: s.providerLabel,
        displayTitle: s.displayTitle || s.providerLabel,
        shortCode: s.shortCode,
        color,
        iconSvg: renderProviderIconSvg(s.provider, color, 18, { mono: theme === 'mono' || s.dupIndex != null }),
        accountLabel: s.accountLabel,
        plan: s.plan,
        status: s.status,
        error: s.error,
        remainingPercent: s.remainingPercent,
        resetCountdown: formatResetCountdown(s.soonestResetAtMs),
        windows: (s.windows || []).map((w) => ({
          label: w.label,
          remainingPercent: w.remainingPercent,
          resetCountdown: formatResetCountdown(w.resetAtMs),
        })),
      };
    }),
  };
}

function broadcastToAllPIs() {
  for (const [context, action] of activePIs.entries()) {
    sd.sendToPropertyInspector(context, action, buildPiStatusPayload(context));
  }
}

function rescheduleAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  const sec = Number(globalSettings.refreshIntervalSec ?? 300);
  if (!Number.isFinite(sec) || sec <= 0) return;
  const intervalMs = Math.max(30, sec) * 1000;
  autoRefreshTimer = setInterval(() => {
    if (instances.size === 0) return;
    if (!client.isConfigured() || client.isAuthBlocked()) return;
    refreshAll({ force: false, showSpinner: false }).catch(() => {});
  }, intervalMs);
}

async function refreshAll({ force = false, showSpinner = false, spinnerContexts = null } = {}) {
  if (!client.isConfigured()) {
    cache.lastError = { kind: 'config', code: null, status: null, message: 'Enter CLIProxyAPI URL & Management Key' };
    renderAllInstances();
    broadcastToAllPIs();
    return;
  }

  if (isBcryptHash(globalSettings.managementKey)) {
    cache.rawSubscriptions = [];
    cache.lastError = {
      kind: 'auth',
      code: 'bcrypt_hash',
      status: 400,
      message: 'That is a bcrypt hash ($2a$/$2b$) from config.yaml — enter the plaintext Control Panel password instead.',
    };
    renderAllInstances();
    broadcastToAllPIs();
    return;
  }

  if (force) {
    client.resetAuthCircuitBreaker();
  } else if (client.isAuthBlocked()) {
    renderAllInstances();
    broadcastToAllPIs();
    return;
  }

  if (cache.inFlight) {
    return cache.inFlight;
  }

  const targets = spinnerContexts || Array.from(instances.keys());
  if (showSpinner && targets.length > 0) {
    startSpinner(targets);
  }

  const run = (async () => {
    try {
      const result = await client.fetchAllQuotas({
        includeDisabled: Boolean(globalSettings.includeDisabled),
      });
      cache.rawSubscriptions = result.subscriptions;
      cache.fetchedAt = result.fetchedAt;
      cache.apiMode = result.apiMode;
      cache.lastError = null;
    } catch (err) {
      const kind = err instanceof CliProxyError ? err.kind : 'network';
      const code = err instanceof CliProxyError ? err.code : null;
      const status = err instanceof CliProxyError ? err.status : null;
      const message = err?.message || 'Failed to read CLIProxyAPI';
      cache.lastError = { kind, code, status, message };
      if (kind === 'auth') {
        cache.rawSubscriptions = [];
        log(`Auth rejected by CLIProxyAPI (${message}); auto-refresh paused.`);
      } else {
        log(`Refresh failed (${kind}): ${message}`);
      }
    } finally {
      cache.inFlight = null;
      stopSpinner();
      renderAllInstances();
      broadcastToAllPIs();
    }
  })();

  cache.inFlight = run;
  broadcastToAllPIs();
  return run;
}

function applyGlobalSettings(raw = {}, { autoFetch = false } = {}) {
  const merged = {
    baseUrl: normalizeBaseUrl(raw.baseUrl ?? DEFAULT_GLOBAL_SETTINGS.baseUrl),
    managementKey: String(raw.managementKey ?? '').trim(),
    refreshIntervalSec:
      raw.refreshIntervalSec !== undefined && Number.isFinite(Number(raw.refreshIntervalSec))
        ? Number(raw.refreshIntervalSec)
        : DEFAULT_GLOBAL_SETTINGS.refreshIntervalSec,
    includeDisabled: Boolean(raw.includeDisabled),
  };

  const credsChanged =
    merged.baseUrl !== globalSettings.baseUrl ||
    merged.managementKey !== globalSettings.managementKey;
  const includeDisabledChanged = merged.includeDisabled !== globalSettings.includeDisabled;

  globalSettings = merged;
  client.configure(globalSettings);
  rescheduleAutoRefresh();

  if (!client.isConfigured()) {
    cache.rawSubscriptions = [];
    cache.lastError = null;
    renderAllInstances();
    broadcastToAllPIs();
    return;
  }

  if (isBcryptHash(globalSettings.managementKey)) {
    cache.rawSubscriptions = [];
    cache.lastError = {
      kind: 'auth',
      code: 'bcrypt_hash',
      status: 400,
      message: 'That is a bcrypt hash ($2a$/$2b$) from config.yaml — enter the plaintext Control Panel password instead.',
    };
    renderAllInstances();
    broadcastToAllPIs();
    return;
  }

  if (autoFetch && (credsChanged || includeDisabledChanged || cache.fetchedAt === 0)) {
    refreshAll({ force: true, showSpinner: instances.size > 0 }).catch(() => {});
  } else if (includeDisabledChanged && !credsChanged && !client.isAuthBlocked() && cache.fetchedAt > 0) {
    refreshAll({ force: false, showSpinner: false }).catch(() => {});
  } else {
    renderAllInstances();
    broadcastToAllPIs();
  }
}

// --- OpenDeck / Stream Deck Event Handlers ---

sd.on('connected', () => {
  log('Connected to OpenDeck WebSocket server.');
  sd.getGlobalSettings();
});

sd.on('didReceiveGlobalSettings', (ev) => {
  const isInitial = !hasLoadedGlobalSettings;
  hasLoadedGlobalSettings = true;
  // Auto-fetch once on initial startup; subsequent saves wait for explicit Save & Reload Now
  // so editing/saving never accidentally burns CLIProxyAPI auth attempts.
  applyGlobalSettings(ev?.payload?.settings || {}, { autoFetch: isInitial });
});

sd.on('willAppear', (ev) => {
  const { context, action, payload } = ev;
  const settings = {
    ...defaultActionSettings(action),
    ...(payload?.settings || {}),
  };
  instances.set(context, { context, action, settings });

  if (!client.isConfigured()) {
    renderInstance(instances.get(context));
    sd.getGlobalSettings();
    return;
  }

  const stale = Date.now() - cache.fetchedAt > 60_000;
  if (!client.isAuthBlocked() && (cache.fetchedAt === 0 || stale)) {
    renderInstance(instances.get(context));
    refreshAll({ force: false, showSpinner: cache.fetchedAt === 0, spinnerContexts: [context] }).catch(() => {});
  } else {
    renderInstance(instances.get(context));
  }
});

sd.on('willDisappear', (ev) => {
  instances.delete(ev.context);
  activePIs.delete(ev.context);
  if (instances.size === 0) {
    stopSpinner();
  }
});

sd.on('didReceiveSettings', (ev) => {
  const existing = instances.get(ev.context);
  const action = ev.action || existing?.action || ACTION_ALL_SUBS;
  const settings = {
    ...defaultActionSettings(action),
    ...(ev?.payload?.settings || {}),
  };
  const updated = { context: ev.context, action, settings };
  instances.set(ev.context, updated);
  renderInstance(updated);
  broadcastToAllPIs();
});

sd.on('keyDown', (ev) => {
  const context = ev.context;
  if (!client.isConfigured()) {
    sd.showAlert(context);
    renderAllInstances();
    return;
  }
  refreshAll({ force: true, showSpinner: true, spinnerContexts: [context] }).catch(() => {});
});

sd.on('dialDown', (ev) => {
  const context = ev.context;
  if (!client.isConfigured()) {
    sd.showAlert(context);
    return;
  }
  refreshAll({ force: true, showSpinner: true, spinnerContexts: [context] }).catch(() => {});
});

sd.on('touchTap', (ev) => {
  const context = ev.context;
  if (!client.isConfigured()) return;
  refreshAll({ force: true, showSpinner: true, spinnerContexts: [context] }).catch(() => {});
});

sd.on('dialRotate', (ev) => {
  const instance = instances.get(ev.context);
  if (!instance) return;
  const ticks = Number(ev?.payload?.ticks || 0);
  if (ticks === 0) return;

  if (instance.action === ACTION_ALL_SUBS) {
    const curIdx = Math.max(0, GAUGE_STYLES.indexOf(instance.settings.gaugeStyle || 'concentric'));
    const nextIdx = (curIdx + (ticks > 0 ? 1 : -1) + GAUGE_STYLES.length) % GAUGE_STYLES.length;
    instance.settings = { ...instance.settings, gaugeStyle: GAUGE_STYLES[nextIdx] };
    sd.setSettings(instance.context, instance.settings);
    renderInstance(instance);
    broadcastToAllPIs();
  } else if (instance.action === ACTION_SINGLE_SUB) {
    const subs = prepareSubscriptionsForDisplay(cache.rawSubscriptions, {
      windowMode: instance.settings.windowMode || 'bottleneck',
      groupMode: 'account',
    });
    if (subs.length === 0) return;
    const curIdx = Math.max(0, subs.findIndex((s) => s.id === instance.settings.targetSubscription));
    const nextIdx = (curIdx + (ticks > 0 ? 1 : -1) + subs.length) % subs.length;
    instance.settings = { ...instance.settings, targetSubscription: subs[nextIdx].id };
    sd.setSettings(instance.context, instance.settings);
    renderInstance(instance);
    broadcastToAllPIs();
  }
});

sd.on('propertyInspectorDidAppear', (ev) => {
  activePIs.set(ev.context, ev.action);
  sd.sendToPropertyInspector(ev.context, ev.action, buildPiStatusPayload(ev.context));
});

sd.on('propertyInspectorDidDisappear', (ev) => {
  activePIs.delete(ev.context);
});

sd.on('sendToPlugin', (ev) => {
  const payload = ev?.payload;
  if (!payload || typeof payload !== 'object') return;
  activePIs.set(ev.context, ev.action);

  if (payload.type === 'getState') {
    sd.sendToPropertyInspector(ev.context, ev.action, buildPiStatusPayload(ev.context));
    return;
  }

  if (payload.type === 'refreshNow') {
    if (payload.connection) {
      applyGlobalSettings({ ...globalSettings, ...payload.connection }, { autoFetch: false });
    }
    refreshAll({ force: true, showSpinner: true }).catch(() => {});
  }
});

sd.on('error', (err) => {
  console.error('[cliproxyapi] WebSocket error:', err?.message || err);
});

sd.on('close', () => {
  stopSpinner();
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopSpinner();
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  process.exit(0);
});

process.on('SIGINT', () => {
  stopSpinner();
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  process.exit(0);
});

sd.connect();
