import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CliProxyClient,
  CliProxyError,
  extractChatgptAccountId,
  formatResetCountdown,
  isBcryptHash,
  normalizeBaseUrl,
  parseAntigravityQuotaBody,
  parseClaudeQuotaBody,
  parseCodexQuotaBody,
  parseKimiQuotaBody,
  prepareSubscriptionsForDisplay,
} from '../dev.cliproxyapi.opendeck.sdPlugin/lib/cliproxy.mjs';

test('normalizeBaseUrl trims slashes and management suffixes', () => {
  assert.equal(normalizeBaseUrl('127.0.0.1:8317/'), 'http://127.0.0.1:8317');
  assert.equal(normalizeBaseUrl('http://localhost:8317/v8/management/'), 'http://localhost:8317');
  assert.equal(normalizeBaseUrl('https://proxy.local/v0/management'), 'https://proxy.local');
  assert.equal(normalizeBaseUrl(''), 'http://127.0.0.1:8317');
});

test('parseClaudeQuotaBody converts utilization to remaining percentage', () => {
  const res = parseClaudeQuotaBody({
    five_hour: { utilization: 36, resets_at: '2026-11-21T18:00:00Z' },
    seven_day: { utilization: 12.5, resets_at: '2026-11-26T00:00:00Z' },
  });
  assert.ok(res);
  assert.equal(res.windows.length, 2);
  assert.equal(res.windows[0].remainingPercent, 64);
  assert.equal(res.windows[1].remainingPercent, 87.5);
});

test('parseCodexQuotaBody extracts 5h, weekly, and plan type', () => {
  const now = 1_700_000_000_000;
  const res = parseCodexQuotaBody(
    JSON.stringify({
      plan_type: 'plus',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_after_seconds: 3600 },
        secondary_window: { used_percent: 55, limit_window_seconds: 604800, reset_at: 1700500000 },
      },
    }),
    now,
  );
  assert.ok(res);
  assert.equal(res.plan, 'plus');
  assert.equal(res.windows.length, 2);
  assert.equal(res.windows[0].remainingPercent, 80);
  assert.equal(res.windows[0].resetAtMs, now + 3_600_000);
  assert.equal(res.windows[1].remainingPercent, 45);
});

test('extractChatgptAccountId decodes JWT id_token payload', () => {
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acc_test_123' } }),
  ).toString('base64url');
  const fakeJwt = `eyJhbGciOiJub25lIn0.${payload}.sig`;
  assert.equal(extractChatgptAccountId({ id_token: fakeJwt }), 'acc_test_123');
});

test('parseAntigravityQuotaBody parses groups and remainingFraction buckets', () => {
  const res = parseAntigravityQuotaBody({
    groups: [
      {
        displayName: 'Gemini Pro',
        buckets: [
          { bucketId: 'b1', window: '5h', remainingFraction: 0.84, resetTime: '2026-11-21T20:00:00Z' },
          { bucketId: 'b2', window: 'weekly', remainingFraction: 0.5, resetTime: '2026-11-27T00:00:00Z' },
        ],
      },
    ],
  });
  assert.ok(res);
  assert.equal(res.windows.length, 2);
  assert.equal(res.windows[0].remainingPercent, 84);
  assert.equal(res.windows[1].remainingPercent, 50);
});

test('parseKimiQuotaBody computes remaining percentage from limit and used', () => {
  const res = parseKimiQuotaBody({ usage: { limit: 1000, used: 250 } });
  assert.ok(res);
  assert.equal(res.windows[0].remainingPercent, 75);
});

test('prepareSubscriptionsForDisplay numbers duplicate providers and supports grouping', () => {
  const raw = [
    {
      id: 'c1',
      name: 'claude-a.json',
      provider: 'claude',
      providerLabel: 'Claude',
      accountLabel: 'a',
      status: 'ok',
      windows: [{ id: 'five-hour', label: '5h', remainingPercent: 80, resetAtMs: null, periodHours: 5 }],
      fetchedAt: 1,
    },
    {
      id: 'c2',
      name: 'claude-b.json',
      provider: 'claude',
      providerLabel: 'Claude',
      accountLabel: 'b',
      status: 'ok',
      windows: [{ id: 'five-hour', label: '5h', remainingPercent: 40, resetAtMs: null, periodHours: 5 }],
      fetchedAt: 1,
    },
    {
      id: 'cx',
      name: 'codex.json',
      provider: 'codex',
      providerLabel: 'Codex',
      accountLabel: 'c',
      status: 'ok',
      windows: [{ id: 'five-hour', label: '5h', remainingPercent: 90, resetAtMs: null, periodHours: 5 }],
      fetchedAt: 1,
    },
  ];

  const perAccount = prepareSubscriptionsForDisplay(raw, { groupMode: 'account' });
  assert.deepEqual(
    perAccount.map((s) => s.shortCode),
    ['C1', 'C2', 'CX'],
  );

  const byProvider = prepareSubscriptionsForDisplay(raw, { groupMode: 'provider' });
  assert.equal(byProvider.length, 2);
  assert.equal(byProvider[0].provider, 'claude');
  assert.equal(byProvider[0].remainingPercent, 60);
});

test('formatResetCountdown formats minutes, hours and days', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatResetCountdown(now + 30_000, now), '<1m');
  assert.equal(formatResetCountdown(now + 42 * 60_000, now), '42m');
  assert.equal(formatResetCountdown(now + (2 * 60 + 15) * 60_000, now), '2h 15m');
  assert.equal(formatResetCountdown(now + (3 * 24 + 5) * 3600_000, now), '3d 5h');
});

test('CliProxyClient falls back from v8 to v0 and reads quotas without mutations', async () => {
  const calls = [];
  const mockFetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    if (url.endsWith('/v8/management/credentials')) {
      return new Response('not found', { status: 404 });
    }
    if (url.endsWith('/v0/management/auth-files')) {
      return new Response(
        JSON.stringify({
          files: [
            { name: 'claude-1.json', provider: 'claude', auth_index: 'idx-1', email: 'u@example.com' },
            { name: 'disabled.json', provider: 'codex', auth_index: 'idx-2', disabled: true },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.endsWith('/v0/management/api-call')) {
      return new Response(
        JSON.stringify({
          status_code: 200,
          body: JSON.stringify({ five_hour: { utilization: 25, resets_at: '2026-11-21T20:00:00Z' } }),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('unexpected', { status: 500 });
  };

  const client = new CliProxyClient({
    baseUrl: 'http://127.0.0.1:8317',
    managementKey: 'secret-test',
    fetchImpl: mockFetch,
  });

  const res = await client.fetchAllQuotas();
  assert.equal(res.apiMode, 'v0');
  assert.equal(res.subscriptions.length, 1);
  assert.equal(res.subscriptions[0].status, 'ok');
  assert.equal(res.subscriptions[0].windows[0].remainingPercent, 75);
  assert.ok(calls.some((c) => c.url.endsWith('/v0/management/api-call')));
});

test('CliProxyClient trips auth circuit breaker on 401 to prevent IP bans', async () => {
  let hits = 0;
  const mockFetch = async () => {
    hits += 1;
    return new Response('unauthorized', { status: 401 });
  };
  const client = new CliProxyClient({
    baseUrl: 'http://127.0.0.1:8317',
    managementKey: 'wrong-key',
    fetchImpl: mockFetch,
  });

  await assert.rejects(() => client.fetchAllQuotas(), (err) => err instanceof CliProxyError && err.kind === 'auth');
  assert.equal(client.isAuthBlocked(), true);
  assert.equal(hits, 1);

  // Subsequent automatic attempt must NOT hit network!
  await assert.rejects(() => client.fetchAllQuotas(), (err) => err instanceof CliProxyError && err.kind === 'auth');
  assert.equal(hits, 1);

  // Updating key resets circuit breaker
  client.configure({ baseUrl: 'http://127.0.0.1:8317', managementKey: 'new-key' });
  assert.equal(client.isAuthBlocked(), false);
});

test('CliProxyClient rejects bcrypt hash client-side without sending any HTTP request', async () => {
  let hits = 0;
  const mockFetch = async () => {
    hits += 1;
    return new Response('should not be called', { status: 401 });
  };
  const hash = '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1';
  assert.equal(isBcryptHash(hash), true);
  assert.equal(isBcryptHash('my-plaintext-password'), false);

  const client = new CliProxyClient({
    baseUrl: 'http://127.0.0.1:8317',
    managementKey: hash,
    fetchImpl: mockFetch,
  });

  await assert.rejects(
    () => client.fetchAllQuotas(),
    (err) => err instanceof CliProxyError && err.kind === 'auth' && err.code === 'bcrypt_hash',
  );
  assert.equal(hits, 0);
});

test('CliProxyClient distinguishes 403 IP lockout and auto-discovers v8 quota plugins', async () => {
  const banClient = new CliProxyClient({
    baseUrl: 'http://127.0.0.1:8317',
    managementKey: 'plaintext-key',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'IP temporarily blocked' }), { status: 403 }),
  });
  await assert.rejects(
    () => banClient.fetchAllQuotas(),
    (err) => err instanceof CliProxyError && err.status === 403 && err.code === 'banned',
  );

  // Dynamic v8 plugin discovery for a brand-new provider ("deepseek")
  const pluginClient = new CliProxyClient({
    baseUrl: 'http://127.0.0.1:8317',
    managementKey: 'plaintext-key',
    fetchImpl: async (url) => {
      if (url.endsWith('/v8/management/credentials')) {
        return new Response(
          JSON.stringify({ files: [{ name: 'ds-1.json', provider: 'deepseek', auth_index: 'ds-1' }] }),
          { status: 200 },
        );
      }
      if (url.endsWith('/v8/management/plugins')) {
        return new Response(
          JSON.stringify({
            plugins: [{ id: 'deepseek-quota', registered: true, supportsQuota: true, quotaProvider: 'deepseek' }],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/v8/management/plugins/deepseek-quota/quota')) {
        return new Response(
          JSON.stringify({ groups: [{ label: 'Daily', remainingFraction: 0.55 }] }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    },
  });

  const res = await pluginClient.fetchAllQuotas();
  assert.equal(res.subscriptions.length, 1);
  assert.equal(res.subscriptions[0].provider, 'deepseek');
  assert.equal(res.subscriptions[0].status, 'ok');
  assert.equal(res.subscriptions[0].windows[0].remainingPercent, 55);
});

