import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const results = [];
const row = (page, check, result, evidence) => {
  results.push({ page, check, result, evidence: String(evidence ?? '') });
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectSocket(url) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('connect-timeout'));
    }, 6000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'connect', auth: {}, role: 'ui' }));
    });

    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (msg.type === 'connected') {
        clearTimeout(timer);
        resolve(ws);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function request(ws, payload, expectedTypes, timeoutMs = 7000) {
  const expected = Array.isArray(expectedTypes) ? expectedTypes : [expectedTypes];
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('timeout'));
    }, timeoutMs);

    const onMessage = (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (expected.includes(msg.type)) {
        ws.off('message', onMessage);
        clearTimeout(timer);
        resolve(msg);
      }
    };

    ws.on('message', onMessage);
    ws.send(JSON.stringify(payload));
  });
}

function sanitize(value) {
  return String(value).replace(/\|/g, '/').replace(/\n/g, ' ');
}

async function main() {
  const gateway = spawn('node', ['packages/gateway/dist/index.js'], {
    stdio: 'ignore',
    detached: false,
  });

  try {
    let ready = false;
    for (let i = 0; i < 30; i += 1) {
      try {
        const ws = await connectSocket('ws://127.0.0.1:19800');
        ws.close();
        ready = true;
        break;
      } catch {
        await sleep(500);
      }
    }

    if (!ready) {
      row('Dashboard', 'connect', 'FAIL', 'gateway not reachable on ws://127.0.0.1:19800');
      printResults();
      process.exitCode = 1;
      return;
    }

    const ws = await connectSocket('ws://127.0.0.1:19800');
    row('Dashboard', 'connect', 'PASS', 'connected');

    try {
      const msg = await request(ws, { type: 'status.query' }, 'status.reply');
      row('Dashboard', 'status.query', 'PASS', `clients=${msg.connectedClients}`);
    } catch (err) {
      row('Dashboard', 'status.query', 'FAIL', err.message);
    }

    try {
      const msg = await request(ws, { type: 'history.query', limit: 10 }, 'history.result');
      row('Dashboard', 'history.query', 'PASS', `entries=${Array.isArray(msg.entries) ? msg.entries.length : 0}`);
    } catch (err) {
      row('Dashboard', 'history.query', 'FAIL', err.message);
    }

    try {
      const msg = await request(ws, { type: 'runtime.config.get' }, 'runtime.config.report');
      row('Dashboard', 'runtime.config.get', 'PASS', `provider=${msg.config?.activeProviderId ?? ''}`);
    } catch (err) {
      row('Dashboard', 'runtime.config.get', 'FAIL', err.message);
    }

    try {
      const ack = await request(ws, { type: 'runtime.config.set', key: 'provider', value: 'anthropic' }, 'runtime.config.ack');
      row('Chat', 'runtime provider apply', ack.ok ? 'PASS' : 'FAIL', ack.message ?? '');
    } catch (err) {
      row('Chat', 'runtime provider apply', 'FAIL', err.message);
    }

    try {
      const ack = await request(ws, { type: 'runtime.config.set', key: 'model', value: 'claude-haiku-4-5' }, 'runtime.config.ack');
      row('Chat', 'runtime model apply', ack.ok ? 'PASS' : 'FAIL', ack.message ?? '');
    } catch (err) {
      row('Chat', 'runtime model apply', 'FAIL', err.message);
    }

    try {
      const accepted = await request(ws, { type: 'task', goal: 'Return one short line only: e2e-ok' }, 'task.accepted', 12000);
      row('Chat', 'task dispatch', 'PASS', `taskId=${accepted.taskId ?? ''}`);
    } catch (err) {
      row('Chat', 'task dispatch', 'FAIL', err.message);
    }

    try {
      const msg = await request(ws, { type: 'claude.mem.query' }, 'claude.mem.state');
      row('Chat', 'claude.mem.query', 'PASS', `sessions=${Object.keys(msg.payload?.sessionStateByConversation ?? {}).length}`);
    } catch (err) {
      row('Chat', 'claude.mem.query', 'FAIL', err.message);
    }

    const voiceChecks = [
      ['voice.lowLatency', true, 'voice.lowLatency'],
      ['voice.autoExecuteTranscript', true, 'voice.autoExecuteTranscript'],
      ['voice.siri.enabled', true, 'voice.siri.enabled'],
      ['voice.siri.mode', 'command', 'voice.siri.mode'],
      ['voice.siri.endpoint', 'http://127.0.0.1:9999/voice', 'voice.siri.endpoint'],
      ['voice.siri.token', 'e2e-token', 'voice.siri.token'],
      ['voice.wake.enabled', true, 'voice.wake.enabled'],
      ['voice.wake.phrase', 'hey omnistate', 'voice.wake.phrase'],
    ];

    for (const [key, value, check] of voiceChecks) {
      try {
        const ack = await request(ws, { type: 'runtime.config.set', key, value }, 'runtime.config.ack');
        row('Voice', check, ack.ok ? 'PASS' : 'FAIL', ack.message ?? '');
      } catch (err) {
        row('Voice', check, 'FAIL', err.message);
      }
    }

    const triggerChecks = [
      ['voice.wake.cooldownMs', 1300, 'wake.cooldownMs'],
      ['voice.wake.commandWindowSec', 18, 'wake.commandWindowSec'],
    ];

    for (const [key, value, check] of triggerChecks) {
      try {
        const ack = await request(ws, { type: 'runtime.config.set', key, value }, 'runtime.config.ack');
        row('Triggers', check, ack.ok ? 'PASS' : 'FAIL', ack.message ?? '');
      } catch (err) {
        row('Triggers', check, 'FAIL', err.message);
      }
    }

    try {
      const cfg = await request(ws, { type: 'runtime.config.get' }, 'runtime.config.report');
      const wake = cfg.config?.voice?.wake ?? {};
      const ok = Number(wake.cooldownMs) === 1300 && Number(wake.commandWindowSec) === 18;
      row('Triggers', 'verify wake persisted', ok ? 'PASS' : 'FAIL', `cooldown=${wake.cooldownMs},window=${wake.commandWindowSec}`);
    } catch (err) {
      row('Triggers', 'verify wake persisted', 'FAIL', err.message);
    }

    try {
      const ack = await request(
        ws,
        {
          type: 'claude.mem.sync',
          payload: {
            sharedMemorySummary: 'e2e-check',
            sharedMemoryLog: ['e2e'],
            sessionStateByConversation: {
              default: {
                memorySummary: 'e2e-session',
                memoryLog: ['USER: e2e'],
                provider: 'anthropic',
                model: 'claude-haiku-4-5',
                updatedAt: Date.now(),
              },
            },
          },
        },
        'claude.mem.ack',
      );
      row('Settings', 'claude.mem.sync', ack.ok ? 'PASS' : 'FAIL', ack.message ?? '');
    } catch (err) {
      row('Settings', 'claude.mem.sync', 'FAIL', err.message);
    }

    try {
      const cfg = await request(ws, { type: 'runtime.config.get' }, 'runtime.config.report');
      const siri = cfg.config?.voice?.siri ?? {};
      const wake = cfg.config?.voice?.wake ?? {};
      const ok = Boolean(siri.enabled) && String(siri.mode) === 'command' && Boolean(wake.enabled);
      row('Settings', 'runtime voice snapshot', ok ? 'PASS' : 'FAIL', `siri.enabled=${siri.enabled},mode=${siri.mode},wake.enabled=${wake.enabled}`);
    } catch (err) {
      row('Settings', 'runtime voice snapshot', 'FAIL', err.message);
    }

    ws.close();
    printResults();
  } finally {
    try {
      process.kill(gateway.pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }
}

function printResults() {
  console.log('| Page | Check | Result | Evidence |');
  console.log('|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.page} | ${r.check} | ${r.result} | ${sanitize(r.evidence)} |`);
  }
  const pass = results.filter((r) => r.result === 'PASS').length;
  const fail = results.length - pass;
  console.log(`SUMMARY pass=${pass} fail=${fail}`);
}

await main();
