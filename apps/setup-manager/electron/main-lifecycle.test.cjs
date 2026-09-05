const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');

// Execute the actual main-process event handlers with Electron/OS boundaries
// replaced. Child exit is explicit, so tests can hold a shutdown save in flight.
function mainProcess(t) {
  const app = new EventEmitter();
  const ipcMain = new EventEmitter();
  const handlers = new Map();
  ipcMain.handle = (name, handler) => handlers.set(name, handler);
  const children = [];
  const installs = [];
  const timers = new Set();
  let quits = 0;
  Object.assign(app, {
    isPackaged: true,
    getPath: () => '/test/user-data',
    getAppPath: () => '/test/app',
    getVersion: () => '4.51.0',
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    quit() {
      let prevented = false;
      app.emit('before-quit', { preventDefault() { prevented = true; } });
      if (!prevented) {
        quits += 1;
        app.emit('quit'); // electron-updater's autoInstallOnAppQuit listens here.
      }
    },
  });
  const autoUpdater = new EventEmitter();
  autoUpdater.quitAndInstall = () => {
    installs.push(children.filter((child) => child.exitCode === null).length);
  };
  const spawn = (_bin, _args, options) => {
    assert.equal(options.env.FRC_MANAGED_STDIN, '1');
    assert.equal(options.stdio[0], 'pipe');
    const child = new EventEmitter();
    Object.assign(child, { pid: children.length + 1, exitCode: null, signalCode: null, commands: [] });
    child.stdin = new EventEmitter();
    child.stdin.writable = true;
    child.stdin.end = (command) => { child.commands.push(command); child.stdin.writable = false; };
    child.exit = () => {
      child.exitCode = 0;
      child.emit('exit', 0, null);
    };
    children.push(child);
    return child;
  };
  const electron = {
    app, ipcMain, BrowserWindow: { getAllWindows: () => [] },
    globalShortcut: { isRegistered: () => false },
  };
  const mockedFS = {
    existsSync: (file) => file.endsWith('frc-pitwall-sender.exe'),
    readFileSync: () => '{}', writeFileSync() {}, renameSync() {},
  };
  const context = vm.createContext({
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === 'electron-updater') return { autoUpdater };
      if (name === 'child_process') return { spawn };
      if (name === 'fs') return mockedFS;
      return require(name);
    },
    __dirname, process, console: { log() {}, warn() {}, error() {} },
    setTimeout: (callback, ms) => { const timer = { callback, ms }; timers.add(timer); return timer; },
    clearTimeout: (timer) => timers.delete(timer),
  });
  vm.runInContext(fs.readFileSync(require.resolve('./main.cjs'), 'utf8'), context);
  vm.runInContext('startSender(); setupAutoUpdater({});', context);
  t.after(() => children.forEach((child) => { if (child.exitCode === null) child.exit(); }));
  return {
    app, ipcMain, autoUpdater, children, installs, timers,
    restart: () => handlers.get('restart-sender')(),
    get quits() { return quits; },
  };
}

const settle = () => new Promise(setImmediate);

test('closing all windows delays quit and auto-install until Sender exits', async (t) => {
  const main = mainProcess(t);
  let autoInstalled = false;
  main.app.on('quit', () => { autoInstalled = true; });
  main.app.emit('window-all-closed');
  assert.deepEqual(main.children[0].commands, ['shutdown\n']);
  assert.equal(main.quits, 0);
  assert.equal(autoInstalled, false);
  main.children[0].exit();
  await settle();
  assert.equal(main.quits, 1);
  assert.equal(autoInstalled, true);
  assert.equal(main.children.length, 1);
});

test('concurrent restarts share shutdown and launch one replacement after exit', async (t) => {
  const main = mainProcess(t);
  const restarts = [main.restart(), main.restart()];
  assert.equal(main.children.length, 1);
  assert.deepEqual(main.children[0].commands, ['shutdown\n']);
  main.children[0].exit();
  await Promise.all(restarts);
  assert.equal(main.children.length, 2);
});

test('quit during a pending restart prevents a replacement Sender', async (t) => {
  const main = mainProcess(t);
  const restarting = main.restart();
  main.app.quit();
  main.children[0].exit();
  await restarting;
  await settle();
  assert.equal(main.quits, 1);
  assert.equal(main.children.length, 1);
});

test('optional install takes ownership over an earlier pending restart', async (t) => {
  const main = mainProcess(t);
  const restarting = main.restart();
  main.ipcMain.emit('install-update');
  main.ipcMain.emit('install-update');
  assert.deepEqual(main.installs, []);
  main.children[0].exit();
  await restarting;
  await settle();
  assert.deepEqual(main.installs, [0]);
  assert.equal(main.children.length, 1);
  await main.restart();
  assert.equal(main.children.length, 1);
});

test('mandatory update waits for Sender exit and blocks restart', async (t) => {
  const main = mainProcess(t);
  main.autoUpdater.emit('update-available', { version: '4.52.0' });
  main.autoUpdater.emit('update-downloaded', { version: '4.52.0' });
  await main.restart();
  assert.deepEqual(main.installs, []);
  main.children[0].exit();
  await settle();
  assert.deepEqual(main.installs, [0]);
  assert.equal(main.children.length, 1);
});

test('updater failure while stopping cancels mandatory installation', async (t) => {
  const main = mainProcess(t);
  const restarting = main.restart();
  main.autoUpdater.emit('update-available', { version: '4.52.0' });
  main.autoUpdater.emit('update-downloaded', { version: '4.52.0' });
  main.autoUpdater.emit('error', new Error('updater failed'));
  main.children[0].exit();
  await restarting;
  await settle();
  assert.deepEqual(main.installs, []);
  assert.equal(main.children.length, 2);
});

test('an old mandatory watchdog cannot release a replacement install', async (t) => {
  const main = mainProcess(t);
  main.autoUpdater.emit('update-available', { version: '4.52.0' });
  main.autoUpdater.emit('update-downloaded', { version: '4.52.0' });
  main.children[0].exit();
  await settle();
  const oldWatchdog = [...main.timers].find((timer) => timer.ms === 15000);
  assert.ok(oldWatchdog);
  main.autoUpdater.emit('error', new Error('first installer failed'));
  main.autoUpdater.emit('update-available', { version: '4.53.0' });
  main.autoUpdater.emit('update-downloaded', { version: '4.53.0' });
  main.children[1].exit();
  await settle();
  oldWatchdog.callback();
  await main.restart();
  assert.deepEqual(main.installs, [0, 0]);
  assert.equal(main.children.length, 2);
});

test('retry after optional updater failure cannot revive the cancelled install', async (t) => {
  const main = mainProcess(t);
  main.ipcMain.emit('install-update');
  main.autoUpdater.emit('error', new Error('updater failed'));
  main.ipcMain.emit('install-update');
  main.children[0].exit();
  await settle();
  assert.deepEqual(main.installs, [0]);
  assert.equal(main.children.length, 1);
});

for (const failure of ['error-before-exit', 'installer-throws', 'watchdog']) {
  test(`optional install restores Sender on ${failure}`, async (t) => {
    const main = mainProcess(t);
    if (failure === 'installer-throws') {
      main.autoUpdater.quitAndInstall = () => { throw new Error('installer unavailable'); };
    }
    main.ipcMain.emit('install-update');
    if (failure === 'error-before-exit') main.autoUpdater.emit('error', new Error('updater failed'));
    main.children[0].exit();
    await settle();
    if (failure === 'watchdog') {
      const watchdog = [...main.timers].find((timer) => timer.ms === 15000);
      assert.ok(watchdog);
      watchdog.callback();
    }
    assert.equal(main.children.length, 2);
    if (failure === 'error-before-exit') assert.deepEqual(main.installs, []);
  });
}
