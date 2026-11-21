/**
 * Strictly READ-ONLY CLIProxyAPI v8 / v0 Management API client & subscription quota fetcher.
 *
 * Never mutates CLIProxyAPI configuration, credentials, cooldowns, or usage queues.
 * Supports: Claude, Codex (ChatGPT), Antigravity, Kimi, xAI/Grok, and v8 QuotaProvider plugins.
 */

const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
];

const ANTIGRAVITY_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'antigravity/hub/2.23.0 darwin/arm64',
};

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'User-Agent': 'claude-cli/2.1.280 (external, cli)',
  'anthropic-beta': 'oauth-2025-04-20',
};

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)',
};

const KIMI_COM_USAGE_URL = 'https://api.kimi.com/coding/v1/usages';
const KIMI_AI_USAGE_URL = 'https://api.kimi.ai/coding/v1/usages';
const KIMI_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
};

const XAI_BILLING_URLS = [
  'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
  'https://cli-chat-proxy.grok.com/v1/billing',
];
const XAI_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'x-xai-token-auth': 'xai-grok-cli',
  'x-grok-client-version': '1.0.70',
  accept: '*/*',
  'user-agent': 'grok-pager/1.0.70 grok-shell/1.0.70 (macos; aarch64)',
};

const PROVIDER_SHORT_PREFIX = {
  antigravity: 'AG',
  claude: 'CL',
  codex: 'CX',
  gemini: 'GM',
  kimi: 'KM',
  xai: 'GK',
  devin: 'DV',
  meta: 'MT',
  qwen: 'QW',
  copilot: 'CP',
  cursor: 'CR',
  plugin: 'PL',
  other: 'AI',
};

const PROVIDER_LABELS = {
  antigravity: 'Antigravity',
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  kimi: 'Kimi',
  xai: 'Grok',
  devin: 'Devin',
  meta: 'Meta',
  qwen: 'Qwen',
  copilot: 'Copilot',
  cursor: 'Cursor',
  plugin: 'Plugin',
  other: 'Other',
};

const PROVIDER_ORDER = [
  'antigravity',
  'claude',
  'codex',
  'gemini',
  'kimi',
  'xai',
  'devin',
  'meta',
  'qwen',
  'copilot',
  'cursor',
  'plugin',
  'other',
];

export class CliProxyError extends Error {
  constructor(message, { kind = 'network', status = null, code = null } = {}) {
    super(message);
    this.name = 'CliProxyError';
    this.kind = kind; // 'auth' | 'offline' | 'http' | 'config' | 'network'
    this.status = status;
    this.code = code; // 'bcrypt_hash' | 'unauthorized' | 'banned' | null
  }
}

export function isBcryptHash(value) {
  const s = String(value || '').trim();
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{20,}$/.test(s);
}

export function normalizeBaseUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return 'http://127.0.0.1:8317';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '').replace(/\/v[08]\/management$/i, '');
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asString(value) {
  if (typeof value === 'string') {
    const t = value.trim();
    return t || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asFraction(value) {
  const num = asNumber(value);
  if (num !== null) return num;
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    const n = Number(value.trim().slice(0, -1));
    if (Number.isFinite(n)) return n / 100;
  }
  return null;
}

function asBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(t)) return true;
    if (['false', '0', 'no', 'off'].includes(t)) return false;
  }
  return false;
}

function clampPercent(val) {
  if (val == null || !Number.isFinite(val)) return null;
  return Math.max(0, Math.min(100, Math.round(val * 10) / 10));
}

function parseTimestampMs(candidates, nowMs = Date.now()) {
  for (const val of candidates) {
    if (val == null) continue;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed) continue;
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric < 1e11 ? numeric * 1000 : numeric;
      }
      const normalized = trimmed.replace(/(\.\d{6})\d+/, '$1');
      const parsed = Date.parse(normalized);
      if (Number.isFinite(parsed)) return parsed;
    } else if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      return val < 1e11 ? val * 1000 : val;
    }
  }
  return null;
}

function parseResetAfterMs(secondsVal, nowMs = Date.now()) {
  const sec = asNumber(secondsVal);
  if (sec == null || sec <= 0) return null;
  return nowMs + sec * 1000;
}

function tryParseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function decodeJwtPayload(token) {
  const obj = asObject(token);
  if (obj) return obj;
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  const parsed = tryParseJson(trimmed);
  if (asObject(parsed)) return parsed;
  const parts = trimmed.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return asObject(JSON.parse(json));
  } catch {
    return null;
  }
}

export function normalizeProvider(cred) {
  const raw = (asString(cred.provider ?? cred.type) || '').toLowerCase().replace(/_/g, '-');
  if (raw === 'anthropic' || raw === 'claude' || raw.startsWith('claude-')) return 'claude';
  if (raw === 'codex' || raw === 'openai' || raw === 'chatgpt') return 'codex';
  if (raw === 'antigravity') return 'antigravity';
  if (raw === 'gemini' || raw === 'gemini-cli' || raw === 'google' || raw === 'vertex') return 'gemini';
  if (raw === 'kimi' || raw === 'kimi-ai' || raw === 'kimi-com') return 'kimi';
  if (raw === 'xai' || raw === 'grok') return 'xai';
  if (raw === 'devin') return 'devin';
  if (raw === 'meta' || raw === 'muse') return 'meta';
  if (raw === 'qwen' || raw.startsWith('qwen-')) return 'qwen';
  if (raw === 'copilot' || raw === 'github-copilot' || raw === 'github') return 'copilot';
  if (raw === 'cursor') return 'cursor';

  const quotaProvider = (asString(cred.quota_provider ?? cred.quotaProvider) || '').toLowerCase().replace(/_/g, '-');
  if (quotaProvider) return quotaProvider;

  const name = (asString(cred.name) || '').toLowerCase();
  if (name.startsWith('antigravity')) return 'antigravity';
  if (name.startsWith('claude')) return 'claude';
  if (name.startsWith('codex')) return 'codex';
  if (name.startsWith('gemini')) return 'gemini';
  if (name.startsWith('kimi')) return 'kimi';
  if (name.startsWith('xai') || name.startsWith('grok')) return 'xai';
  if (name.startsWith('devin')) return 'devin';
  if (name.startsWith('qwen')) return 'qwen';
  if (name.startsWith('copilot') || name.startsWith('github')) return 'copilot';
  if (name.startsWith('cursor')) return 'cursor';
  return raw || 'other';
}

export function extractAccountLabel(cred) {
  const email = asString(cred.email);
  if (email) {
    const [user] = email.split('@');
    return user || email;
  }
  const account = asString(cred.account ?? cred.label);
  if (account) return account;
  const name = asString(cred.name) || 'account';
  return name.replace(/\.json$/i, '');
}

export function extractChatgptAccountId(cred) {
  const meta = asObject(cred.metadata);
  const attrs = asObject(cred.attributes);
  const direct = [
    cred.chatgpt_account_id,
    cred.chatgptAccountId,
    meta?.chatgpt_account_id,
    meta?.chatgptAccountId,
    attrs?.chatgpt_account_id,
    attrs?.chatgptAccountId,
  ];
  for (const val of direct) {
    const s = asString(val);
    if (s) return s;
  }
  const tokens = [cred.id_token, meta?.id_token, attrs?.id_token];
  for (const tok of tokens) {
    const payload = decodeJwtPayload(tok);
    if (!payload) continue;
    const auth = asObject(payload['https://api.openai.com/auth']);
    const id = asString(
      payload.chatgpt_account_id ??
      payload.chatgptAccountId ??
      auth?.chatgpt_account_id ??
      auth?.chatgptAccountId,
    );
    if (id) return id;
  }
  return null;
}

export function extractProjectIdFromObj(obj) {
  const root = asObject(obj);
  if (!root) return null;
  const meta = asObject(root.metadata);
  const attrs = asObject(root.attributes);
  const installed = asObject(root.installed);
  const web = asObject(root.web);
  const candidates = [
    root.project_id,
    root.projectId,
    meta?.project_id,
    meta?.projectId,
    attrs?.project_id,
    attrs?.projectId,
    attrs?.gemini_virtual_project,
    installed?.project_id,
    installed?.projectId,
    web?.project_id,
    web?.projectId,
  ];
  for (const val of candidates) {
    const s = asString(val);
    if (s) return s;
  }
  return null;
}

export function parseClaudeQuotaBody(body, nowMs = Date.now()) {
  const data = asObject(tryParseJson(body));
  if (!data) return null;

  const knownKeys = [
    { key: 'five_hour', id: 'five-hour', label: '5h', periodHours: 5 },
    { key: 'seven_day', id: 'seven-day', label: '7d', periodHours: 168 },
    { key: 'seven_day_sonnet', id: 'seven-day-sonnet', label: '7d Sonnet', periodHours: 168 },
    { key: 'seven_day_opus', id: 'seven-day-opus', label: '7d Opus', periodHours: 168 },
    { key: 'seven_day_oauth_apps', id: 'seven-day-oauth', label: '7d OAuth', periodHours: 168 },
    { key: 'seven_day_cowork', id: 'seven-day-cowork', label: '7d Cowork', periodHours: 168 },
  ];

  const windows = [];
  for (const def of knownKeys) {
    const entry = asObject(data[def.key]);
    if (!entry || !('utilization' in entry)) continue;
    const used = asNumber(entry.utilization);
    if (used === null) continue;
    const remainingPercent = clampPercent(100 - used);
    const resetAtMs = parseTimestampMs([entry.resets_at, entry.reset_at], nowMs);
    windows.push({
      id: def.id,
      label: def.label,
      remainingPercent,
      resetAtMs,
      periodHours: def.periodHours,
    });
  }

  // Also check array-style `limits` if present
  if (Array.isArray(data.limits)) {
    for (let i = 0; i < data.limits.length; i += 1) {
      const lim = asObject(data.limits[i]);
      if (!lim) continue;
      const used = asNumber(lim.percent ?? lim.utilization);
      if (used === null) continue;
      const modelName = asString(lim.scope?.model?.display_name);
      const kind = asString(lim.kind) || `limit-${i + 1}`;
      windows.push({
        id: `limit-${i}`,
        label: modelName ? `7d ${modelName}` : kind,
        remainingPercent: clampPercent(100 - used),
        resetAtMs: parseTimestampMs([lim.resets_at, lim.reset_at], nowMs),
        periodHours: kind.includes('weekly') ? 168 : null,
      });
    }
  }

  if (windows.length === 0) return null;
  return { windows, plan: null };
}

export function parseCodexQuotaBody(body, nowMs = Date.now()) {
  const data = asObject(tryParseJson(body));
  if (!data) return null;

  const rateLimit = asObject(data.rate_limit ?? data.rateLimit);
  const windows = [];

  const pushWindow = (win, fallbackId, fallbackLabel, limitReached, allowed) => {
    const w = asObject(win);
    if (!w) return;
    const windowSec = asNumber(w.limit_window_seconds ?? w.limitWindowSeconds);
    const periodHours = windowSec != null && windowSec > 0 ? windowSec / 3600 : null;
    let used = asNumber(w.used_percent ?? w.usedPercent);
    if (used === null && (limitReached === true || allowed === false)) {
      used = 100;
    }
    if (used === null) return;
    const resetAtMs =
      parseTimestampMs([w.reset_at, w.resetAt], nowMs) ??
      parseResetAfterMs(w.reset_after_seconds ?? w.resetAfterSeconds, nowMs);

    let id = fallbackId;
    let label = fallbackLabel;
    if (periodHours !== null) {
      if (Math.abs(periodHours - 5) < 0.5) {
        id = 'five-hour';
        label = '5h';
      } else if (periodHours >= 160 && periodHours <= 176) {
        id = 'weekly';
        label = '7d';
      } else if (periodHours >= 672) {
        id = 'monthly';
        label = '30d';
      }
    }
    windows.push({
      id,
      label,
      remainingPercent: clampPercent(100 - used),
      resetAtMs,
      periodHours,
    });
  };

  if (rateLimit) {
    const limitReached = rateLimit.limit_reached ?? rateLimit.limitReached;
    const allowed = rateLimit.allowed;
    pushWindow(rateLimit.primary_window ?? rateLimit.primaryWindow, 'five-hour', '5h', limitReached, allowed);
    pushWindow(rateLimit.secondary_window ?? rateLimit.secondaryWindow, 'weekly', '7d', limitReached, allowed);
  }

  if (windows.length === 0) return null;
  const plan = asString(data.plan_type ?? data.planType);
  return { windows, plan };
}

export function parseAntigravityQuotaBody(body, nowMs = Date.now()) {
  let data = asObject(tryParseJson(body));
  if (!data) return null;
  if (!Array.isArray(data.groups) && data.body) {
    const nested = asObject(tryParseJson(data.body));
    if (nested) data = nested;
  }
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const windows = [];

  for (let gi = 0; gi < groups.length; gi += 1) {
    const group = asObject(groups[gi]);
    if (!group) continue;
    const groupLabel = asString(group.displayName ?? group.display_name ?? group.label) || `Group ${gi + 1}`;
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    if (buckets.length === 0) {
      const directFrac = asFraction(group.remainingFraction ?? group.remaining_fraction);
      if (directFrac !== null) {
        windows.push({
          id: asString(group.id ?? group.groupId) || `ag-${gi}`,
          label: groupLabel,
          remainingPercent: clampPercent(directFrac * 100),
          resetAtMs: parseTimestampMs([group.resetTime, group.reset_time], nowMs),
          periodHours: null,
        });
      }
      continue;
    }
    for (let bi = 0; bi < buckets.length; bi += 1) {
      const bucket = asObject(buckets[bi]);
      if (!bucket) continue;
      const frac = asFraction(bucket.remainingFraction ?? bucket.remaining_fraction);
      if (frac === null) continue;
      const winStr = (asString(bucket.window) || '').toLowerCase();
      let periodHours = null;
      if (winStr === '5h' || winStr === 'five-hour' || winStr === 'five_hour') periodHours = 5;
      else if (winStr === 'weekly' || winStr === 'week') periodHours = 168;

      const label = asString(bucket.displayName ?? bucket.display_name) ||
        (winStr ? `${groupLabel} ${winStr}` : groupLabel);
      const resetAtMs = parseTimestampMs([bucket.resetTime, bucket.reset_time], nowMs);
      windows.push({
        id: asString(bucket.bucketId ?? bucket.bucket_id) || `ag-${gi}-${bi}`,
        label,
        remainingPercent: clampPercent(frac * 100),
        resetAtMs,
        periodHours,
      });
    }
  }

  if (windows.length === 0) return null;
  return { windows, plan: null };
}

export function parseKimiQuotaBody(body, nowMs = Date.now()) {
  const data = asObject(tryParseJson(body));
  if (!data) return null;

  const windows = [];
  const pushRow = (row, id, label, periodHours = null) => {
    const r = asObject(row);
    if (!r) return;
    const limit = asNumber(r.limit ?? r.total ?? r.quota);
    const used = asNumber(r.used ?? r.consumed);
    const rem = asNumber(r.remaining);
    let remainingPercent = null;
    if (limit !== null && limit > 0) {
      const actualRem = rem !== null ? rem : used !== null ? limit - used : null;
      if (actualRem !== null) remainingPercent = clampPercent((actualRem / limit) * 100);
    } else if (used !== null && used > 0) {
      remainingPercent = 0;
    }
    if (remainingPercent === null) return;
    const resetAtMs = parseTimestampMs([r.resetTime, r.reset_time, r.resetAt, r.reset_at], nowMs);
    windows.push({ id, label, remainingPercent, resetAtMs, periodHours });
  };

  if (asObject(data.usage)) {
    pushRow(data.usage, 'kimi-usage', 'Usage', 168);
  }
  if (Array.isArray(data.limits)) {
    data.limits.forEach((lim, idx) => {
      const detail = asObject(lim?.detail) || asObject(lim);
      const duration = asNumber(lim?.window?.duration);
      const unit = (asString(lim?.window?.timeUnit) || '').toLowerCase();
      let periodHours = null;
      if (duration && unit.includes('hour')) periodHours = duration;
      else if (duration && unit.includes('day')) periodHours = duration * 24;
      pushRow(detail, `kimi-limit-${idx}`, periodHours ? `${periodHours}h` : `Limit ${idx + 1}`, periodHours);
    });
  }

  if (windows.length === 0) return null;
  return { windows, plan: asString(data.plan?.name ?? data.membership?.level) };
}

export function parseXaiQuotaBody(body, nowMs = Date.now()) {
  const data = asObject(tryParseJson(body));
  if (!data) return null;
  const cfg = asObject(data.config) || data;
  const remaining = asNumber(cfg.remainingCredits ?? cfg.remaining_credits ?? cfg.remaining);
  const total = asNumber(cfg.totalCredits ?? cfg.total_credits ?? cfg.limit);
  if (remaining === null || total === null || total <= 0) return null;
  return {
    windows: [
      {
        id: 'xai-credits',
        label: 'Credits',
        remainingPercent: clampPercent((remaining / total) * 100),
        resetAtMs: parseTimestampMs([cfg.resetAt, cfg.reset_at], nowMs),
        periodHours: null,
      },
    ],
    plan: asString(cfg.planLabel ?? cfg.subscriptionTier),
  };
}

/**
 * Selects the representative remaining % and primary/secondary windows for a subscription.
 */
export function summarizeWindows(windows, windowMode = 'bottleneck') {
  const valid = (windows || []).filter((w) => w && typeof w.remainingPercent === 'number' && Number.isFinite(w.remainingPercent));
  if (valid.length === 0) {
    return {
      remainingPercent: null,
      primaryWindow: null,
      secondaryWindow: null,
      soonestResetAtMs: null,
    };
  }

  const shortWin = valid.find(
    (w) => (w.periodHours !== null && w.periodHours <= 24) || /five|5h|primary/i.test(`${w.id} ${w.label}`),
  ) || null;
  const weeklyWin = valid.find(
    (w) => w !== shortWin && ((w.periodHours !== null && w.periodHours >= 48) || /seven|7d|week|month|secondary/i.test(`${w.id} ${w.label}`)),
  ) || null;

  const bottleneck = valid.reduce((min, cur) => (cur.remainingPercent < min.remainingPercent ? cur : min), valid[0]);

  let remainingPercent;
  if (windowMode === 'short') {
    remainingPercent = (shortWin || bottleneck).remainingPercent;
  } else if (windowMode === 'weekly') {
    remainingPercent = (weeklyWin || bottleneck).remainingPercent;
  } else if (windowMode === 'average') {
    const avg = valid.reduce((acc, w) => acc + w.remainingPercent, 0) / valid.length;
    remainingPercent = clampPercent(avg);
  } else {
    remainingPercent = bottleneck.remainingPercent;
  }

  let primaryWindow = shortWin || bottleneck;
  let secondaryWindow = weeklyWin || valid.find((w) => w !== primaryWindow) || null;
  if (windowMode === 'weekly' && weeklyWin) {
    primaryWindow = weeklyWin;
    secondaryWindow = shortWin || valid.find((w) => w !== primaryWindow) || null;
  } else if (windowMode === 'bottleneck') {
    primaryWindow = bottleneck;
    secondaryWindow = valid.find((w) => w !== bottleneck) || null;
  }

  const futureResets = valid
    .map((w) => w.resetAtMs)
    .filter((ts) => typeof ts === 'number' && Number.isFinite(ts));
  const soonestResetAtMs = futureResets.length > 0 ? Math.min(...futureResets) : null;

  return {
    remainingPercent,
    primaryWindow,
    secondaryWindow,
    soonestResetAtMs,
  };
}

/**
 * Formats a future epoch timestamp as a compact reset countdown (e.g. "2h 14m", "3d 5h", "42m").
 */
export function formatResetCountdown(resetAtMs, nowMs = Date.now()) {
  if (!resetAtMs || !Number.isFinite(resetAtMs)) return null;
  const diffMs = resetAtMs - nowMs;
  if (diffMs <= 0) return 'now';
  const totalMinutes = Math.floor(diffMs / 60000);
  if (totalMinutes < 1) return '<1m';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/**
 * Applies grouping ('account' vs 'provider') and assigns short codes (AG, C1, C2, CX...).
 */
export function prepareSubscriptionsForDisplay(rawSubs, { windowMode = 'bottleneck', groupMode = 'account' } = {}) {
  const active = rawSubs
    .filter((s) => s.status !== 'disabled' && s.status !== 'unsupported')
    .map((s) => {
      const summary = summarizeWindows(s.windows, windowMode);
      return {
        ...s,
        remainingPercent: s.status === 'ok' ? summary.remainingPercent : null,
        primaryWindow: summary.primaryWindow,
        secondaryWindow: summary.secondaryWindow,
        soonestResetAtMs: summary.soonestResetAtMs,
      };
    });

  active.sort((a, b) => {
    const pa = PROVIDER_ORDER.indexOf(a.provider);
    const pb = PROVIDER_ORDER.indexOf(b.provider);
    const oa = pa === -1 ? 99 : pa;
    const ob = pb === -1 ? 99 : pb;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });

  if (groupMode === 'provider') {
    const byProvider = new Map();
    for (const sub of active) {
      if (!byProvider.has(sub.provider)) byProvider.set(sub.provider, []);
      byProvider.get(sub.provider).push(sub);
    }
    const grouped = [];
    for (const [provider, list] of byProvider.entries()) {
      const okItems = list.filter((x) => x.status === 'ok' && x.remainingPercent !== null);
      const avg = okItems.length > 0
        ? clampPercent(okItems.reduce((a, b) => a + b.remainingPercent, 0) / okItems.length)
        : null;
      const resets = list.map((x) => x.soonestResetAtMs).filter(Boolean);
      const allWindows = list.flatMap((x) => x.windows || []);
      const summary = summarizeWindows(allWindows, windowMode);
      grouped.push({
        id: `provider:${provider}`,
        name: provider,
        provider,
        providerLabel: PROVIDER_LABELS[provider] || provider,
        shortCode: PROVIDER_SHORT_PREFIX[provider] || provider.slice(0, 2).toUpperCase(),
        accountLabel: list.length === 1 ? list[0].accountLabel : `${list.length} accounts`,
        plan: list.find((x) => x.plan)?.plan || null,
        status: okItems.length > 0 ? 'ok' : list[0].status,
        error: okItems.length > 0 ? null : list[0].error,
        remainingPercent: avg,
        primaryWindow: summary.primaryWindow,
        secondaryWindow: summary.secondaryWindow,
        windows: allWindows,
        soonestResetAtMs: resets.length > 0 ? Math.min(...resets) : null,
        fetchedAt: Math.max(...list.map((x) => x.fetchedAt || 0)),
      });
    }
    return grouped;
  }

  // Short codes and dupIndex; accounts are only numbered when a provider has more than one.
  const counts = new Map();
  for (const sub of active) {
    counts.set(sub.provider, (counts.get(sub.provider) || 0) + 1);
  }
  const seen = new Map();
  return active.map((sub) => {
    const idx = (seen.get(sub.provider) || 0) + 1;
    seen.set(sub.provider, idx);
    const totalForProvider = counts.get(sub.provider) || 1;
    const prefix = PROVIDER_SHORT_PREFIX[sub.provider] || sub.provider.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'AI';
    const shortCode = totalForProvider > 1 ? `${prefix[0]}${idx}` : prefix;
    const prettyLabel = sub.providerLabel
      ? sub.providerLabel.charAt(0).toUpperCase() + sub.providerLabel.slice(1)
      : 'Provider';
    return {
      ...sub,
      providerLabel: prettyLabel,
      shortCode,
      dupIndex: totalForProvider > 1 ? idx : null,
      displayTitle: totalForProvider > 1 ? `${prettyLabel} ${idx}` : prettyLabel,
    };
  });
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await worker(items[idx], idx);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

export class CliProxyClient {
  constructor({ baseUrl, managementKey, fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.managementKey = String(managementKey || '').trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this._apiMode = null; // 'v8' | 'v0'
    this._authTripped = false;
    this._pluginListCache = null;
  }

  configure({ baseUrl, managementKey }) {
    const nextUrl = normalizeBaseUrl(baseUrl);
    const nextKey = String(managementKey || '').trim();
    if (nextUrl !== this.baseUrl || nextKey !== this.managementKey) {
      this.baseUrl = nextUrl;
      this.managementKey = nextKey;
      this._apiMode = null;
      this._authTripped = false;
      this._pluginListCache = null;
    }
  }

  resetAuthCircuitBreaker() {
    this._authTripped = false;
  }

  isAuthBlocked() {
    return this._authTripped;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.managementKey);
  }

  async _mgmtRequest(path, { method = 'GET', body = undefined, rawText = false, timeoutMs = this.timeoutMs } = {}) {
    if (!this.managementKey) {
      throw new CliProxyError('Management key is not configured', { kind: 'config' });
    }
    if (isBcryptHash(this.managementKey)) {
      this._authTripped = true;
      throw new CliProxyError(
        'That is a bcrypt hash ($2a$/$2b$) from config.yaml — enter the plaintext Control Panel password instead.',
        { kind: 'auth', status: 400, code: 'bcrypt_hash' },
      );
    }
    if (this._authTripped) {
      throw new CliProxyError('Management key rejected (auto-polling paused to avoid IP ban)', {
        kind: 'auth',
        status: 401,
        code: 'unauthorized',
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.managementKey}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (res.status === 401 || res.status === 403) {
        this._authTripped = true;
        const rawTextErr = await res.text().catch(() => '');
        const parsedErr = tryParseJson(rawTextErr);
        const serverDetail = asString(
          parsedErr?.error?.message ?? parsedErr?.error ?? parsedErr?.message ?? rawTextErr,
        );
        if (res.status === 403) {
          throw new CliProxyError(
            serverDetail
              ? `Access blocked (403): ${serverDetail}`
              : 'IP temporarily locked (403) after 5 failed attempts — wait ~30m or restart CLIProxyAPI',
            { kind: 'auth', status: 403, code: 'banned' },
          );
        }
        throw new CliProxyError(
          serverDetail
            ? `Unauthorized (401): ${serverDetail}`
            : 'Unauthorized (401) — use your plaintext Control Panel management password',
          { kind: 'auth', status: 401, code: 'unauthorized' },
        );
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new CliProxyError(`HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`, {
          kind: 'http',
          status: res.status,
        });
      }

      return rawText ? await res.text() : await res.json();
    } catch (err) {
      if (err instanceof CliProxyError) throw err;
      const msg = err?.name === 'AbortError' ? 'Request timed out' : (err?.message || 'Connection failed');
      throw new CliProxyError(msg, { kind: 'offline' });
    } finally {
      clearTimeout(timer);
    }
  }

  async listCredentials() {
    if (this._apiMode === 'v0') {
      const res = await this._mgmtRequest('/v0/management/auth-files');
      return Array.isArray(res?.files) ? res.files : Array.isArray(res) ? res : [];
    }
    try {
      const res = await this._mgmtRequest('/v8/management/credentials');
      this._apiMode = 'v8';
      return Array.isArray(res?.files) ? res.files : Array.isArray(res) ? res : [];
    } catch (err) {
      if (err instanceof CliProxyError && err.status === 404) {
        const res = await this._mgmtRequest('/v0/management/auth-files');
        this._apiMode = 'v0';
        return Array.isArray(res?.files) ? res.files : Array.isArray(res) ? res : [];
      }
      throw err;
    }
  }

  async downloadCredentialText(name) {
    const encoded = encodeURIComponent(name);
    const path = this._apiMode === 'v0'
      ? `/v0/management/auth-files/download?name=${encoded}`
      : `/v8/management/credentials/download?name=${encoded}`;
    return this._mgmtRequest(path, { rawText: true });
  }

  async proxyApiCall({ authIndex, method = 'GET', url, header = {}, data = undefined }) {
    const payload = {
      auth_index: String(authIndex),
      method,
      url,
      header,
      ...(data !== undefined ? { data } : {}),
    };
    const path = this._apiMode === 'v0'
      ? '/v0/management/api-call'
      : '/v8/management/requests/api-call';
    const res = await this._mgmtRequest(path, { method: 'POST', body: payload });
    return {
      statusCode: Number(res?.status_code ?? 0),
      header: res?.header ?? {},
      body: res?.body ?? null,
    };
  }

  async _listQuotaPlugins() {
    if (this._apiMode === 'v0') return [];
    const now = Date.now();
    if (this._pluginListCache && this._pluginListCache.expiresAt > now) {
      return this._pluginListCache.plugins;
    }
    try {
      const res = await this._mgmtRequest('/v8/management/plugins');
      const plugins = Array.isArray(res?.plugins) ? res.plugins : [];
      this._pluginListCache = { plugins, expiresAt: now + 30_000 };
      return plugins;
    } catch {
      return [];
    }
  }

  async _fetchClaudeQuota(authIndex) {
    const res = await this.proxyApiCall({
      authIndex,
      method: 'GET',
      url: CLAUDE_USAGE_URL,
      header: CLAUDE_HEADERS,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Claude API ${res.statusCode}`);
    }
    const parsed = parseClaudeQuotaBody(res.body);
    if (!parsed) throw new Error('Empty Claude quota data');
    return parsed;
  }

  async _fetchCodexQuota(cred, authIndex) {
    const accountId = extractChatgptAccountId(cred);
    const header = { ...CODEX_HEADERS };
    if (accountId) header['Chatgpt-Account-Id'] = accountId;

    const res = await this.proxyApiCall({
      authIndex,
      method: 'GET',
      url: CODEX_USAGE_URL,
      header,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Codex API ${res.statusCode}`);
    }
    const parsed = parseCodexQuotaBody(res.body);
    if (!parsed) throw new Error('Empty Codex quota data');
    if (!parsed.plan) {
      parsed.plan = asString(cred.plan_type ?? cred.planType);
    }
    return parsed;
  }

  async _fetchAntigravityQuota(cred, authIndex) {
    let projectId = extractProjectIdFromObj(cred);
    if (!projectId && cred.name && !asBool(cred.runtime_only ?? cred.runtimeOnly)) {
      try {
        const rawText = await this.downloadCredentialText(cred.name);
        projectId = extractProjectIdFromObj(tryParseJson(rawText));
      } catch {
        // ignore download error
      }
    }
    if (!projectId) {
      throw new Error('Missing Antigravity project_id');
    }

    let lastErr = 'Empty Antigravity quota';
    const data = JSON.stringify({ project: projectId });
    for (const url of ANTIGRAVITY_QUOTA_URLS) {
      try {
        const res = await this.proxyApiCall({
          authIndex,
          method: 'POST',
          url,
          header: ANTIGRAVITY_HEADERS,
          data,
        });
        if (res.statusCode < 200 || res.statusCode >= 300) {
          lastErr = `Antigravity API ${res.statusCode}`;
          continue;
        }
        const parsed = parseAntigravityQuotaBody(res.body);
        if (parsed && parsed.windows.length > 0) return parsed;
      } catch (err) {
        if (err instanceof CliProxyError && err.kind === 'auth') throw err;
        lastErr = err?.message || lastErr;
      }
    }
    throw new Error(lastErr);
  }

  async _fetchKimiQuota(cred, authIndex) {
    const rawName = `${cred.id || ''} ${cred.name || ''} ${cred.provider || ''}`;
    const url = /kimi-ai|kimi\.ai/i.test(rawName) ? KIMI_AI_USAGE_URL : KIMI_COM_USAGE_URL;
    const res = await this.proxyApiCall({
      authIndex,
      method: 'GET',
      url,
      header: KIMI_HEADERS,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Kimi API ${res.statusCode}`);
    }
    const parsed = parseKimiQuotaBody(res.body);
    if (!parsed) throw new Error('Empty Kimi quota data');
    return parsed;
  }

  async _fetchXaiQuota(cred, authIndex) {
    const header = { ...XAI_HEADERS };
    const meta = asObject(cred.metadata);
    const userId = asString(cred.sub ?? cred.user_id ?? meta?.sub ?? meta?.user_id);
    if (userId) header['x-userid'] = userId;

    let lastErr = 'Empty Grok quota data';
    for (const url of XAI_BILLING_URLS) {
      const res = await this.proxyApiCall({ authIndex, method: 'GET', url, header });
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const parsed = parseXaiQuotaBody(res.body);
        if (parsed) return parsed;
      } else {
        lastErr = `Grok API ${res.statusCode}`;
      }
    }
    throw new Error(lastErr);
  }

  async _fetchPluginQuota(cred, authIndex, providerHint = '') {
    const target = (asString(cred.quota_provider ?? cred.quotaProvider) || providerHint || '').toLowerCase();
    let pluginId = asString(cred.quota_plugin_id ?? cred.quotaPluginId);
    if (!pluginId && target) {
      const plugins = await this._listQuotaPlugins();
      const eligible = plugins.filter((p) => p?.registered && p?.supportsQuota);
      const matched =
        eligible.find((p) => String(p.quotaProvider || '').toLowerCase() === target) ||
        eligible.find((p) => String(p.id || '').toLowerCase() === target) ||
        eligible.find((p) => String(p.oauthProvider || '').toLowerCase() === target) ||
        eligible.find((p) => Array.isArray(p.oauthProviders) && p.oauthProviders.some((op) => String(op).toLowerCase() === target));
      pluginId = matched?.id || null;
    }
    if (!pluginId) return null;

    const res = await this._mgmtRequest(`/v8/management/plugins/${encodeURIComponent(pluginId)}/quota`, {
      method: 'POST',
      body: { auth_index: String(authIndex) },
    });
    const parsed = parseAntigravityQuotaBody(res);
    if (!parsed) throw new Error('Empty plugin quota data');
    const plan = asString(res?.subscription?.tierName ?? res?.subscription?.plan);
    return { windows: parsed.windows, plan };
  }

  async fetchAllQuotas({ includeDisabled = false } = {}) {
    const credentials = await this.listCredentials();
    const fetchedAt = Date.now();

    const filtered = credentials.filter((c) => {
      if (!c || typeof c !== 'object') return false;
      if (!includeDisabled && asBool(c.disabled)) return false;
      return true;
    });

    const results = await mapWithConcurrency(filtered, 4, async (cred) => {
      const provider = normalizeProvider(cred);
      const providerLabel = PROVIDER_LABELS[provider] || (provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'Provider');
      const authIndex = asString(cred.auth_index ?? cred.authIndex);
      const name = asString(cred.name) || `${provider}-${authIndex || 'unknown'}`;
      const accountLabel = extractAccountLabel(cred);
      const hasExplicitPlugin = Boolean(asString(cred.quota_provider ?? cred.quotaProvider ?? cred.quota_plugin_id ?? cred.quotaPluginId));
      const base = {
        id: name,
        name,
        authIndex,
        provider,
        providerLabel,
        accountLabel,
        plan: asString(cred.plan_type ?? cred.planType),
        disabled: asBool(cred.disabled),
        fetchedAt,
      };

      if (base.disabled && !includeDisabled) {
        return { ...base, status: 'disabled', error: null, windows: [] };
      }
      if (!authIndex) {
        return { ...base, status: 'error', error: 'Missing auth_index', windows: [] };
      }

      try {
        let quota = null;
        if (hasExplicitPlugin) {
          quota = await this._fetchPluginQuota(cred, authIndex, provider);
          if (!quota) throw new Error('No matching quota plugin');
        } else if (provider === 'claude') {
          quota = await this._fetchClaudeQuota(authIndex);
        } else if (provider === 'codex') {
          quota = await this._fetchCodexQuota(cred, authIndex);
        } else if (provider === 'antigravity') {
          quota = await this._fetchAntigravityQuota(cred, authIndex);
        } else if (provider === 'kimi') {
          quota = await this._fetchKimiQuota(cred, authIndex);
        } else if (provider === 'xai') {
          quota = await this._fetchXaiQuota(cred, authIndex);
        } else {
          // Dynamically check if a registered CLIProxyAPI v8 plugin provides quota for this provider
          quota = await this._fetchPluginQuota(cred, authIndex, provider);
          if (!quota) {
            return { ...base, status: 'unsupported', error: null, windows: [] };
          }
        }

        return {
          ...base,
          plan: quota.plan || base.plan,
          status: 'ok',
          error: null,
          windows: quota.windows,
        };
      } catch (err) {
        if (err instanceof CliProxyError && err.kind === 'auth') {
          throw err;
        }
        return {
          ...base,
          status: 'error',
          error: err?.message || 'Quota fetch failed',
          windows: [],
        };
      }
    });

    return {
      apiMode: this._apiMode || 'v8',
      fetchedAt,
      totalCredentials: credentials.length,
      subscriptions: results,
    };
  }
}
