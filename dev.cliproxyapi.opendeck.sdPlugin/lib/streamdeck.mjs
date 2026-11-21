/**
 * Zero-dependency OpenDeck / Elgato Stream Deck WebSocket SDK client.
 * Uses native globalThis.WebSocket (Node 22+) with a lightweight RFC 6455
 * client fallback for Node 20 runtimes where WebSocket is not enabled by default.
 */

import crypto from 'node:crypto';
import EventEmitter from 'node:events';
import http from 'node:http';

/**
 * Parse Stream Deck / OpenDeck plugin CLI arguments:
 * -port <port> -pluginUUID <uuid> -registerEvent <event> -info <json>
 */
export function parseLaunchArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key.startsWith('-') && i + 1 < argv.length) {
      args[key.replace(/^-+/, '')] = argv[i + 1];
      i += 1;
    }
  }
  let info = {};
  if (args.info) {
    try {
      info = JSON.parse(args.info);
    } catch {
      info = {};
    }
  }
  return {
    port: Number(args.port),
    pluginUUID: args.pluginUUID || '',
    registerEvent: args.registerEvent || 'registerPlugin',
    info,
  };
}

/**
 * Minimal RFC 6455 text WebSocket client for localhost (Node 20 fallback).
 */
class MinimalWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.readyState = 0; // CONNECTING
    this._socket = null;
    this._buffer = Buffer.alloc(0);
    this._connect(new URL(url));
  }

  _connect(parsed) {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: parsed.hostname,
      port: Number(parsed.port || 80),
      path: `${parsed.pathname}${parsed.search}` || '/',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });

    req.on('upgrade', (_res, socket, head) => {
      this._socket = socket;
      this.readyState = 1; // OPEN
      if (head && head.length > 0) {
        this._buffer = Buffer.concat([this._buffer, head]);
        this._drainFrames();
      }
      socket.on('data', (chunk) => {
        this._buffer = Buffer.concat([this._buffer, chunk]);
        this._drainFrames();
      });
      socket.on('close', () => {
        this.readyState = 3;
        this.emit('close');
      });
      socket.on('error', (err) => this.emit('error', err));
      this.emit('open');
    });

    req.on('error', (err) => this.emit('error', err));
    req.end();
  }

  send(text) {
    if (this.readyState !== 1 || !this._socket) return;
    const payload = Buffer.from(String(text), 'utf8');
    const mask = crypto.randomBytes(4);
    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x81;
      header[1] = 0x80 | payload.length;
      mask.copy(header, 2);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      mask.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
      mask.copy(header, 10);
    }
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i += 1) {
      masked[i] = payload[i] ^ mask[i % 4];
    }
    this._socket.write(Buffer.concat([header, masked]));
  }

  _sendControl(opcode, payload = Buffer.alloc(0)) {
    if (this.readyState !== 1 || !this._socket) return;
    const mask = crypto.randomBytes(4);
    const header = Buffer.alloc(6);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | Math.min(payload.length, 125);
    mask.copy(header, 2);
    const body = Buffer.alloc(Math.min(payload.length, 125));
    for (let i = 0; i < body.length; i += 1) {
      body[i] = payload[i] ^ mask[i % 4];
    }
    this._socket.write(Buffer.concat([header, body]));
  }

  _drainFrames() {
    while (this._buffer.length >= 2) {
      const b0 = this._buffer[0];
      const b1 = this._buffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let length = b1 & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this._buffer.length < 4) return;
        length = this._buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this._buffer.length < 10) return;
        length = Number(this._buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      if (this._buffer.length < offset + maskLen + length) return;

      let payload = this._buffer.subarray(offset + maskLen, offset + maskLen + length);
      if (masked) {
        const maskKey = this._buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.alloc(length);
        for (let i = 0; i < length; i += 1) {
          unmasked[i] = payload[i] ^ maskKey[i % 4];
        }
        payload = unmasked;
      }
      this._buffer = this._buffer.subarray(offset + maskLen + length);

      if (opcode === 0x01) {
        this.emit('message', payload.toString('utf8'));
      } else if (opcode === 0x08) {
        this._sendControl(0x08);
        this.readyState = 3;
        this._socket?.end();
      } else if (opcode === 0x09) {
        this._sendControl(0x0a, payload);
      }
    }
  }
}

export class StreamDeckClient extends EventEmitter {
  constructor({ port, pluginUUID, registerEvent, info }) {
    super();
    this.port = port;
    this.pluginUUID = pluginUUID;
    this.registerEvent = registerEvent;
    this.info = info;
    this.ws = null;
    this.connected = false;
    this._queue = [];
  }

  connect() {
    const url = `ws://127.0.0.1:${this.port}`;
    if (typeof globalThis.WebSocket === 'function') {
      const ws = new globalThis.WebSocket(url);
      this.ws = ws;
      ws.addEventListener('open', () => this._onOpen());
      ws.addEventListener('message', (ev) => this._onMessage(ev.data));
      ws.addEventListener('close', () => {
        this.connected = false;
        this.emit('close');
      });
      ws.addEventListener('error', (err) => this.emit('error', err));
    } else {
      const ws = new MinimalWebSocket(url);
      this.ws = ws;
      ws.on('open', () => this._onOpen());
      ws.on('message', (data) => this._onMessage(data));
      ws.on('close', () => {
        this.connected = false;
        this.emit('close');
      });
      ws.on('error', (err) => this.emit('error', err));
    }
  }

  _onOpen() {
    this.connected = true;
    this._sendRaw({
      event: this.registerEvent,
      uuid: this.pluginUUID,
    });
    while (this._queue.length > 0) {
      this._sendRaw(this._queue.shift());
    }
    this.emit('connected');
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg.event !== 'string') return;
    this.emit('event', msg);
    this.emit(msg.event, msg);
  }

  _sendRaw(obj) {
    if (!this.connected || !this.ws) {
      this._queue.push(obj);
      return;
    }
    try {
      this.ws.send(JSON.stringify(obj));
    } catch (err) {
      this.emit('error', err);
    }
  }

  setImage(context, dataUri, state = undefined) {
    const payload = { image: dataUri };
    if (typeof state === 'number') payload.state = state;
    this._sendRaw({ event: 'setImage', context, payload });
  }

  setTitle(context, title, state = undefined) {
    const payload = { title };
    if (typeof state === 'number') payload.state = state;
    this._sendRaw({ event: 'setTitle', context, payload });
  }

  showOk(context) {
    this._sendRaw({ event: 'showOk', context });
  }

  showAlert(context) {
    this._sendRaw({ event: 'showAlert', context });
  }

  getGlobalSettings() {
    this._sendRaw({ event: 'getGlobalSettings', context: this.pluginUUID });
  }

  setGlobalSettings(payload) {
    this._sendRaw({ event: 'setGlobalSettings', context: this.pluginUUID, payload });
  }

  getSettings(context) {
    this._sendRaw({ event: 'getSettings', context });
  }

  setSettings(context, payload) {
    this._sendRaw({ event: 'setSettings', context, payload });
  }

  sendToPropertyInspector(context, action, payload) {
    this._sendRaw({
      event: 'sendToPropertyInspector',
      context,
      action,
      payload,
    });
  }

  logMessage(message) {
    this._sendRaw({
      event: 'logMessage',
      payload: { message: String(message) },
    });
  }
}
