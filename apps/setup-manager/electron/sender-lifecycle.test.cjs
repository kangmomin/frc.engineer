const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stopSenderProcess } = require('./sender-lifecycle.cjs');

function child(t, script, args = []) {
  const proc = spawn(process.execPath, ['-e', script, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL'); });
  return proc;
}

test('graceful stop waits for the child to finish saving and exit', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sender-stop-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'checkpoint.json');
  const proc = child(t, `
    require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
      if (line === 'shutdown') setTimeout(() => {
        require('node:fs').writeFileSync(process.argv[1], '{"finalizeTrigger":"shutdown"}');
        process.exit(0);
      }, 30);
    });
  `, [file]);
  let forced = false;
  await stopSenderProcess(proc, { forceStop: () => { forced = true; proc.kill('SIGKILL'); } });
  assert.equal(forced, false);
  assert.equal(proc.exitCode, 0);
  assert.equal(JSON.parse(fs.readFileSync(file)).finalizeTrigger, 'shutdown');
});

test('a stalled child is forcibly stopped only after the grace period', async (t) => {
  const proc = child(t, 'setInterval(() => {}, 1000);');
  let forced = 0;
  await stopSenderProcess(proc, {
    graceMs: 50,
    forceStop: (child) => { forced += 1; child.kill('SIGKILL'); },
  });
  assert.equal(forced, 1);
  assert.equal(proc.signalCode, 'SIGKILL');
});

test('a failed forced stop rejects instead of permitting restart or install', async (t) => {
  const proc = child(t, 'setInterval(() => {}, 1000);');
  await assert.rejects(stopSenderProcess(proc, {
    graceMs: 20, forceMs: 20, forceStop: () => {},
  }), /did not exit/);
  assert.equal(proc.exitCode, null);
  assert.equal(proc.signalCode, null);
});

test('an already exited child does not need a shutdown command', async (t) => {
  const proc = child(t, 'process.exit(0);');
  await once(proc, 'exit');
  await stopSenderProcess(proc, { forceStop: () => assert.fail('must not kill an exited process') });
});
