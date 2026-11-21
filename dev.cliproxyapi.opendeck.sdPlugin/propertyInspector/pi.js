/* OpenDeck / Stream Deck Property Inspector controller for CLIProxyAPI Quotas */

const ACTION_ALL_SUBS = 'dev.cliproxyapi.opendeck.allsubs';
const ACTION_SINGLE_SUB = 'dev.cliproxyapi.opendeck.singlesub';
const DEFAULT_URL = 'http://127.0.0.1:8317';
const REFRESH_CHOICES = [0, 60, 300, 900, 1800];

let ws = null;
let piUuid = '';
let actionUuid = ACTION_ALL_SUBS;
let actionContext = '';

let globalSettings = {
  baseUrl: DEFAULT_URL,
  managementKey: '',
  refreshIntervalSec: 300,
  includeDisabled: false,
};

let actionSettings = {};
let lastState = null;
let lastSubscriptions = [];
let tabTouched = false; // once the user picks a tab, stop switching tabs for them

const $ = (id) => document.getElementById(id);
const isSingle = () => actionUuid === ACTION_SINGLE_SUB;
// Rings draw one ring per subscription, so they show a single limit (5h or weekly) chosen
// separately from the other styles' Limits setting.
const isRings = () => !isSingle() && getRadio('gaugeStyle') === 'concentric';

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

/* ---------------------------------------------------------------- helpers */

function getRadio(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : '';
}

function setRadio(name, value) {
  const inputs = [...document.querySelectorAll(`input[name="${name}"]`)];
  const match = inputs.find((i) => i.value === String(value)) || inputs[0];
  if (match) match.checked = true;
}

function nearestRefresh(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n)) return 300;
  return REFRESH_CHOICES.reduce((best, c) => (Math.abs(c - n) < Math.abs(best - n) ? c : best), REFRESH_CHOICES[0]);
}

function normalizeWindowMode(mode) {
  return mode === 'short' || mode === 'weekly' ? mode : 'bottleneck';
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{20,}$/.test(String(value || '').trim());
}

let svgSeq = 0;
/**
 * Inline SVGs share one document here, and logos reuse gradient/mask ids. A reference to an id
 * that lives in a hidden tab doesn't render (Antigravity/Codex show as solid squares), so give
 * every inserted SVG its own ids.
 */
function uniqueIds(svg) {
  if (!svg || !svg.includes('id="')) return svg || '';
  const suffix = `-u${++svgSeq}`;
  return svg
    .replace(/id="([^"]+)"/g, (_, id) => `id="${id}${suffix}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${id}${suffix})`)
    .replace(/href="#([^"]+)"/g, (_, id) => `href="#${id}${suffix}"`);
}

/* ---------------------------------------------------------------- tabs */

const TABS = ['key', 'subs', 'conn'];

function selectTab(name, { focus = false } = {}) {
  for (const t of TABS) {
    const tab = $(`tab-${t}`);
    const on = t === name;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
    if (on && focus) tab.focus();
  }
}

function bindTabs() {
  for (const t of TABS) {
    $(`tab-${t}`).addEventListener('click', () => {
      tabTouched = true;
      selectTab(t);
    });
    $(`tab-${t}`).addEventListener('keydown', (e) => {
      const i = TABS.indexOf(t);
      let next = null;
      if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
      else if (e.key === 'ArrowLeft') next = TABS[(i + TABS.length - 1) % TABS.length];
      else if (e.key === 'Home') next = TABS[0];
      else if (e.key === 'End') next = TABS[TABS.length - 1];
      if (next) {
        e.preventDefault();
        tabTouched = true;
        selectTab(next, { focus: true });
      }
    });
  }
}

/* ---------------------------------------------------------------- settings I/O */

function readConnectionForm() {
  return {
    baseUrl: ($('baseUrl').value || DEFAULT_URL).trim(),
    managementKey: ($('managementKey').value || '').trim(),
    refreshIntervalSec: Number(getRadio('refreshIntervalSec') || 0),
    includeDisabled: Boolean($('includeDisabled').checked),
  };
}

function pushGlobalSettings() {
  // OpenDeck resolves the plugin from inPropertyInspectorUUID when the PI sends setGlobalSettings.
  send({ event: 'setGlobalSettings', context: piUuid, payload: globalSettings });
}

function saveActionSettings() {
  const rings = isRings();
  const common = {
    windowMode: rings ? actionSettings.windowMode || 'bottleneck' : getRadio('windowMode') || 'bottleneck',
    theme: getRadio('theme') || 'provider',
  };
  actionSettings = isSingle()
    ? {
        ...common,
        targetSubscription: getRadio('targetSubscription') || '',
        showReset: Boolean($('showReset').checked),
      }
    : {
        ...common,
        gaugeStyle: getRadio('gaugeStyle') || 'concentric',
        centerMetric: getRadio('centerMetric') || 'avg',
        groupMode: $('groupMode').checked ? 'provider' : 'account',
        ringsWindow: rings ? (getRadio('windowMode') === 'weekly' ? 'weekly' : 'short') : actionSettings.ringsWindow || 'short',
      };
  send({ event: 'setSettings', context: actionContext, payload: actionSettings });
  syncVisibility();
}

/** Save the connection and fetch once. Never called on keystrokes (CLIProxyAPI bans IPs after 5 bad logins). */
function saveAndConnect() {
  if (updateKeyWarning()) {
    $('managementKey').focus();
    return;
  }
  globalSettings = readConnectionForm();
  pushGlobalSettings();
  send({
    event: 'sendToPlugin',
    action: actionUuid,
    context: actionContext,
    payload: { type: 'refreshNow', connection: globalSettings },
  });
  showSyncing();
}

function reloadNow() {
  send({ event: 'sendToPlugin', action: actionUuid, context: actionContext, payload: { type: 'refreshNow' } });
  showSyncing();
}

function showSyncing() {
  setStatus('sync', 'Updating…');
  $('reloadBtn').disabled = true;
  $('refreshBtn').disabled = true;
}

/* ---------------------------------------------------------------- rendering */

function setStatus(tone, text) {
  $('statusText').dataset.tone = tone;
  $('statusText').textContent = text;
  $('reloadBtn').classList.toggle('is-busy', tone === 'sync');
}

function updateKeyWarning(serverError = null) {
  const warn = $('keyWarning');
  const val = ($('managementKey').value || '').trim();

  if (isBcryptHash(val)) {
    warn.className = 'callout';
    warn.textContent =
      'This is the hashed password from config.yaml. Enter the plain password you use to sign in to the CLIProxyAPI Control Panel.';
    return true;
  }
  if (serverError && (serverError.code === 'banned' || serverError.status === 403)) {
    warn.className = 'callout err';
    warn.textContent =
      'CLIProxyAPI blocked this computer after too many wrong passwords. Wait about 30 minutes or restart CLIProxyAPI, then save again with the right password.';
    return false;
  }
  if (serverError && serverError.kind === 'auth') {
    warn.className = 'callout err';
    warn.textContent = 'CLIProxyAPI rejected this password. Check it and save again.';
    return false;
  }
  warn.className = 'callout hidden';
  warn.textContent = '';
  return false;
}

function populateGlobalForm() {
  $('baseUrl').value = globalSettings.baseUrl || DEFAULT_URL;
  $('managementKey').value = globalSettings.managementKey || '';
  setRadio('refreshIntervalSec', nearestRefresh(globalSettings.refreshIntervalSec ?? 300));
  $('includeDisabled').checked = Boolean(globalSettings.includeDisabled);
  updateKeyWarning();
}

function populateActionForm() {
  const single = isSingle();
  setRadio('theme', actionSettings.theme || 'provider');
  if (single) {
    $('showReset').checked = actionSettings.showReset !== false;
    renderSubPicker(lastSubscriptions);
  } else {
    setRadio('gaugeStyle', actionSettings.gaugeStyle || 'concentric');
    setRadio('centerMetric', actionSettings.centerMetric || 'avg');
    $('groupMode').checked = actionSettings.groupMode === 'provider';
  }
  showLimitsFor();
  syncVisibility();
}

/** Shows only the options that affect this key. */
function syncVisibility() {
  const single = isSingle();
  $('keyLayout').classList.toggle('is-single', single);
  $('styleRow').classList.toggle('hidden', single);
  $('singleBlock').classList.toggle('hidden', !single);
  $('groupRow').classList.toggle('hidden', single);
  $('resetRow').classList.toggle('hidden', !single);
  // The grid shows every number itself, so the middle number only applies to rings and dial.
  $('centerRow').classList.toggle('hidden', single || getRadio('gaugeStyle') === 'grid');
  describeLimits();
}

function describeLimits() {
  const rings = isRings();
  const mode = getRadio('windowMode');
  $('limitsBoth').closest('label').classList.toggle('hidden', rings);
  let hint;
  if (rings) hint = mode === 'weekly' ? 'Every ring shows weekly left.' : 'Every ring shows 5-hour left.';
  else if (mode === 'short') hint = 'Only the 5-hour limit.';
  else if (mode === 'weekly') hint = 'Only the weekly limit.';
  else hint = 'Both: outer ring 5-hour, inner ring weekly.';
  $('limitsHint').textContent = hint;
}

/** Puts the Limits control on the value stored for the current style. */
function showLimitsFor() {
  if (isRings()) setRadio('windowMode', actionSettings.ringsWindow === 'weekly' ? 'weekly' : 'short');
  else setRadio('windowMode', normalizeWindowMode(actionSettings.windowMode));
}

function renderStatus(state) {
  lastState = state;
  const err = state.error;
  const count = (state.subscriptions || []).length;

  if (state.loading) {
    setStatus('sync', 'Updating…');
  } else if (!state.configured) {
    setStatus('warn', 'Not connected');
  } else if (err) {
    if (err.code === 'bcrypt_hash') setStatus('err', 'Wrong kind of password');
    else if (err.code === 'banned' || err.status === 403) setStatus('err', 'Blocked by CLIProxyAPI');
    else if (err.kind === 'auth') setStatus('err', 'Password rejected');
    else setStatus('err', 'Can’t reach CLIProxyAPI');
  } else {
    const synced = state.fetchedAt
      ? new Date(state.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '—';
    setStatus('ok', `Updated ${synced}`);
  }
  $('reloadBtn').disabled = Boolean(state.loading) || !state.configured;
  $('refreshBtn').disabled = Boolean(state.loading);

  // Connection needs attention: flag its tab, and open it unless the user already chose a tab.
  const needsAttention = !state.configured || Boolean(err && !count);
  const dot = $('connDot');
  dot.classList.toggle('hidden', !needsAttention);
  dot.classList.toggle('err', Boolean(err));
  if (needsAttention && !tabTouched) selectTab('conn');

  updateKeyWarning(err || null);

  if (state.previewSvg) $('previewFrame').innerHTML = uniqueIds(state.previewSvg);

  lastSubscriptions = Array.isArray(state.subscriptions) ? state.subscriptions : [];
  if (isSingle()) renderSubPicker(lastSubscriptions);
  renderSubscriptionsList(lastSubscriptions);
}

/* ---------------------------------------------------------------- subscription views */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function logoEl(sub) {
  const wrap = el('span', 'sub-logo');
  wrap.setAttribute('aria-hidden', 'true');
  if (sub.iconSvg) wrap.innerHTML = uniqueIds(sub.iconSvg);
  return wrap;
}

function pctOf(sub) {
  return sub.status === 'ok' && typeof sub.remainingPercent === 'number' ? Math.round(sub.remainingPercent) : null;
}

function pctEl(sub) {
  const pct = pctOf(sub);
  const node = el('span', 'sub-pct', sub.status === 'error' ? 'Error' : pct !== null ? `${pct}%` : '—');
  if (sub.status === 'error') node.classList.add('err');
  else if (pct !== null && pct <= 15) node.classList.add('low');
  return node;
}

function barEl(pct, color) {
  const bar = el('div', 'bar-track');
  bar.style.background = /^#[0-9a-f]{6}$/i.test(color) ? `${color}33` : 'rgba(255,255,255,0.1)';
  const fill = el('div', 'bar-fill');
  fill.style.width = `${pct !== null ? Math.max(2, pct) : 0}%`;
  fill.style.background = color;
  bar.appendChild(fill);
  return bar;
}

function windowRows(sub) {
  const color = sub.color || '#a3a3a3';
  const windows = (sub.windows || []).filter((w) => typeof w.remainingPercent === 'number').slice(0, 4);
  if (sub.status === 'error' || windows.length === 0) {
    return [barEl(sub.status === 'error' ? null : pctOf(sub), color)];
  }
  return windows.map((w) => {
    const pct = Math.round(w.remainingPercent);
    const row = el('div', 'win-row');
    row.append(
      el('span', 'win-label', (w.label || '').toUpperCase()),
      barEl(pct, pct <= 15 ? '#ff5f57' : color),
      el('span', 'win-value', `${pct}%`),
      el('span', 'win-reset', w.resetCountdown ? `in ${w.resetCountdown}` : ''),
    );
    return row;
  });
}

function subHead(sub, { withAccount = true } = {}) {
  const head = el('div', 'sub-head');
  head.append(logoEl(sub), el('span', 'sub-name', sub.displayTitle || sub.providerLabel));
  if (withAccount) {
    const account = sub.plan ? `${sub.accountLabel} · ${sub.plan}` : sub.accountLabel || '';
    const acc = el('span', 'sub-account', account);
    acc.title = account;
    head.appendChild(acc);
  }
  return head;
}

function renderSubscriptionsList(subs) {
  const list = $('subList');
  const okCount = subs.filter((s) => s.status !== 'error').length;
  $('subCountBadge').textContent = subs.length ? String(subs.length) : '';
  $('subCountBadge').title = okCount === subs.length ? '' : `${okCount} of ${subs.length} working`;
  list.replaceChildren();

  if (subs.length === 0) {
    const empty = el('div', 'empty', lastState?.configured ? 'No subscriptions found in CLIProxyAPI.' : 'Connect to CLIProxyAPI to see your subscriptions.');
    if (!lastState?.configured) {
      const go = el('button', 'btn btn-primary', 'Set up connection');
      go.type = 'button';
      go.addEventListener('click', () => selectTab('conn', { focus: true }));
      empty.append(go);
    }
    list.appendChild(empty);
    return;
  }
  for (const sub of subs) {
    const card = el('div', 'sub-card');
    const head = subHead(sub);
    head.appendChild(pctEl(sub));
    card.append(head, ...windowRows(sub));
    if (sub.status === 'error' && sub.error) card.appendChild(el('p', 'sub-error', sub.error));
    list.appendChild(card);
  }
}

function pickRow(value, checked, buildHead) {
  const row = el('label', 'pick-row');
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'targetSubscription';
  input.value = value;
  input.checked = checked;
  input.addEventListener('change', saveActionSettings);
  const head = buildHead();
  head.style.flex = '1';
  head.style.minWidth = '0';
  const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  check.setAttribute('class', 'icon pick-check');
  check.setAttribute('aria-hidden', 'true');
  check.innerHTML = '<use href="#i-check"/>';
  row.append(input, head, check);
  return row;
}

function renderSubPicker(subs) {
  const picker = $('subPicker');
  const current = actionSettings.targetSubscription || '';
  picker.replaceChildren();

  picker.appendChild(
    pickRow('', current === '', () => {
      const head = el('div', 'sub-head');
      head.append(el('span', 'sub-name', 'Automatic'), el('span', 'sub-account', 'least left'));
      return head;
    }),
  );
  for (const sub of subs) {
    picker.appendChild(
      pickRow(sub.id, sub.id === current, () => {
        const head = subHead(sub, { withAccount: false });
        head.appendChild(pctEl(sub));
        return head;
      }),
    );
  }
  if (current && !subs.some((s) => s.id === current)) {
    picker.appendChild(
      pickRow(current, true, () => {
        const head = el('div', 'sub-head');
        head.append(el('span', 'sub-name', current), el('span', 'sub-account', 'not found right now'));
        return head;
      }),
    );
  }
}

/* ---------------------------------------------------------------- events */

function bindEvents() {
  bindTabs();

  $('toggleKeyBtn').addEventListener('click', () => {
    const input = $('managementKey');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const btn = $('toggleKeyBtn');
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
  });

  $('connForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveAndConnect();
  });
  $('reloadBtn').addEventListener('click', reloadNow);
  $('managementKey').addEventListener('input', () => updateKeyWarning());

  // These two don't touch credentials, so they save immediately.
  for (const input of document.querySelectorAll('input[name="refreshIntervalSec"]')) {
    input.addEventListener('change', () => {
      globalSettings = { ...globalSettings, refreshIntervalSec: Number(getRadio('refreshIntervalSec') || 0) };
      pushGlobalSettings();
    });
  }
  $('includeDisabled').addEventListener('change', () => {
    globalSettings = { ...globalSettings, includeDisabled: Boolean($('includeDisabled').checked) };
    pushGlobalSettings();
  });

  for (const input of document.querySelectorAll('input[name="gaugeStyle"]')) {
    input.addEventListener('change', () => {
      showLimitsFor();
      saveActionSettings();
    });
  }
  for (const name of ['centerMetric', 'windowMode', 'theme']) {
    for (const input of document.querySelectorAll(`input[name="${name}"]`)) {
      input.addEventListener('change', saveActionSettings);
    }
  }
  $('groupMode').addEventListener('change', saveActionSettings);
  $('showReset').addEventListener('change', saveActionSettings);
}

function connectSocket(inPort, inPropertyInspectorUUID, inRegisterEvent, _inInfo, inActionInfo) {
  piUuid = inPropertyInspectorUUID;
  const parsedAction = typeof inActionInfo === 'string' ? JSON.parse(inActionInfo) : inActionInfo;
  actionUuid = parsedAction?.action || ACTION_ALL_SUBS;
  actionContext = parsedAction?.context || inPropertyInspectorUUID;
  actionSettings = parsedAction?.payload?.settings || {};

  populateActionForm();
  populateGlobalForm();
  bindEvents();

  ws = new WebSocket(`ws://127.0.0.1:${inPort}`);
  ws.onopen = () => {
    send({ event: inRegisterEvent, uuid: piUuid });
    send({ event: 'getGlobalSettings', context: piUuid });
    send({ event: 'sendToPlugin', action: actionUuid, context: actionContext, payload: { type: 'getState' } });
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.event === 'didReceiveGlobalSettings') {
      globalSettings = { ...globalSettings, ...(msg.payload?.settings || {}) };
      populateGlobalForm();
    } else if (msg.event === 'didReceiveSettings') {
      actionSettings = msg.payload?.settings || {};
      populateActionForm();
    } else if (msg.event === 'sendToPropertyInspector' && msg.payload?.type === 'state') {
      renderStatus(msg.payload);
    }
  };
}

window.connectElgatoStreamDeckSocket = connectSocket;
window.connectOpenActionSocket = connectSocket;
