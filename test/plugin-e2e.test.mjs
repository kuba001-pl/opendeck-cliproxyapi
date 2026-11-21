import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ENTRY = path.join(__dirname, '..', 'dev.cliproxyapi.opendeck.sdPlugin', 'bin', 'plugin.mjs');

function encodeWsTextFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  const hdr = Buffer.alloc(4);
  hdr[0] = 0x81;
  hdr[1] = 126;
  hdr.writeUInt16BE(payload.length, 2);
  return Buffer.concat([hdr, payload]);
}

function createMockWsServer() {
  const received = [];
  let clientSocket = null;
  let buf = Buffer.alloc(0);
  const waiters = [];

  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    clientSocket = socket;
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          offset = 10;
        }
        const maskLen = masked ? 4 : 0;
        if (buf.length < offset + maskLen + len) return;
        const data = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + len));
        if (masked) {
          const mask = buf.subarray(offset, offset + 4);
          for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4];
        }
        buf = buf.subarray(offset + maskLen + len);
        if (opcode === 0x01) {
          const msg = JSON.parse(data.toString('utf8'));
          received.push(msg);
          for (let i = waiters.length - 1; i >= 0; i -= 1) {
            if (waiters[i].pred(msg)) {
              const w = waiters.splice(i, 1)[0];
              w.resolve(msg);
            }
          }
        }
      }
    });
  });

  return {
    server,
    received,
    send(obj) {
      if (!clientSocket) throw new Error('No WS client connected');
      clientSocket.write(encodeWsTextFrame(JSON.stringify(obj)));
    },
    waitFor(pred, timeoutMs = 4000) {
      const existing = received.find(pred);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for WS event')), timeoutMs);
        waiters.push({
          pred,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
        });
      });
    },
  };
}

test('end-to-end plugin lifecycle: connect, fetch v8 quotas, render black SVG, and click-to-reload', async () => {
  let claudeUtilization = 30; // 70% left initially
  const proxyRequests = [];

  const apiServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      proxyRequests.push({ method: req.method, url: req.url });
      assert.equal(req.headers.authorization, 'Bearer test-mgmt-key');

      if (req.method === 'GET' && req.url === '/v8/management/credentials') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            files: [
              { name: 'claude-1.json', provider: 'claude', auth_index: 'a1', email: 'one@example.com' },
              { name: 'codex-1.json', provider: 'codex', auth_index: 'a2', email: 'two@example.com', plan_type: 'plus' },
            ],
          }),
        );
        return;
      }

      if (req.method === 'POST' && req.url === '/v8/management/requests/api-call') {
        const parsed = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (parsed.auth_index === 'a1') {
          res.end(
            JSON.stringify({
              status_code: 200,
              body: JSON.stringify({ five_hour: { utilization: claudeUtilization, resets_at: '2026-11-21T20:00:00Z' } }),
            }),
          );
          return;
        }
        if (parsed.auth_index === 'a2') {
          res.end(
            JSON.stringify({
              status_code: 200,
              body: JSON.stringify({
                plan_type: 'plus',
                rate_limit: {
                  primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_after_seconds: 7200 },
                },
              }),
            }),
          );
          return;
        }
      }

      res.writeHead(404);
      res.end('not found');
    });
  });

  const wsMock = createMockWsServer();

  await new Promise((r) => apiServer.listen(0, '127.0.0.1', r));
  await new Promise((r) => wsMock.server.listen(0, '127.0.0.1', r));

  const apiPort = apiServer.address().port;
  const wsPort = wsMock.server.address().port;

  const child = spawn(process.execPath, [
    PLUGIN_ENTRY,
    '-port',
    String(wsPort),
    '-pluginUUID',
    'dev.cliproxyapi.opendeck.sdPlugin',
    '-registerEvent',
    'registerPlugin',
    '-info',
    JSON.stringify({ application: { platform: 'linux' } }),
  ]);

  try {
    await wsMock.waitFor((m) => m.event === 'registerPlugin' && m.uuid === 'dev.cliproxyapi.opendeck.sdPlugin');
    await wsMock.waitFor((m) => m.event === 'getGlobalSettings');

    wsMock.send({
      event: 'willAppear',
      action: 'dev.cliproxyapi.opendeck.allsubs',
      context: 'ctx-key-0',
      payload: { settings: { gaugeStyle: 'concentric', centerMetric: 'avg', theme: 'provider' } },
    });

    wsMock.send({
      event: 'didReceiveGlobalSettings',
      payload: {
        settings: {
          baseUrl: `http://127.0.0.1:${apiPort}`,
          managementKey: 'test-mgmt-key',
          refreshIntervalSec: 0,
        },
      },
    });

    const firstGauge = await wsMock.waitFor((m) => {
      if (m.event !== 'setImage' || m.context !== 'ctx-key-0') return false;
      const svg = Buffer.from(m.payload.image.split(',')[1], 'base64').toString('utf8');
      return svg.includes('80% average left');
    });
    const firstSvg = Buffer.from(firstGauge.payload.image.split(',')[1], 'base64').toString('utf8');
    assert.ok(firstSvg.includes('fill="#000000"'));
    assert.ok(firstSvg.includes('<g transform="translate('));

    // Now simulate quota dropping and user clicking button to reload!
    claudeUtilization = 70; // Claude drops to 30% left -> average of 30% & 90% = 60%
    wsMock.send({
      event: 'keyDown',
      action: 'dev.cliproxyapi.opendeck.allsubs',
      context: 'ctx-key-0',
      payload: { settings: {} },
    });

    const refreshedGauge = await wsMock.waitFor((m) => {
      if (m.event !== 'setImage' || m.context !== 'ctx-key-0') return false;
      const svg = Buffer.from(m.payload.image.split(',')[1], 'base64').toString('utf8');
      return svg.includes('60% average left');
    });
    assert.ok(refreshedGauge);

    // Ensure strictly read-only endpoints were used (never PUT/PATCH/DELETE or config/cooldown writes)
    for (const req of proxyRequests) {
      assert.ok(
        (req.method === 'GET' && req.url === '/v8/management/credentials') ||
          (req.method === 'POST' && req.url === '/v8/management/requests/api-call'),
        `Unexpected CLIProxyAPI request: ${req.method} ${req.url}`,
      );
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
    wsMock.server.close();
    apiServer.close();
  }
});
