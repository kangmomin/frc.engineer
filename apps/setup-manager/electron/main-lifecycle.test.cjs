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
    child.stderr = new EventEmitter();
    child.stdin.writable = true;
    child.stdin.end = (command) => { child.commands.push(command); child.stdin.writable = false; };
    child.exit = (code = 0) => {
      child.exitCode = code;
      child.emit('exit', code, null);
    };
    children.push(child);
    return child;
  };
  const dialogs = [];
  const dialogResponses = [];
  const windowMessages = [];
  const windows = [];
  const electron = {
    app, ipcMain, BrowserWindow: { getAllWindows: () => windows },
    globalShortcut: { isRegistered: () => false },
    dialog: {
      showMessageBox: async (...args) => {
        dialogs.push(args.at(-1));
        return { response: dialogResponses.shift() ?? 1 };
      },
    },
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
  const baselineTimers = new Set(timers);
  t.after(() => children.forEach((child) => { if (child.exitCode === null) child.exit(); }));
  return {
    app, ipcMain, autoUpdater, children, installs, timers, dialogs, dialogResponses, windowMessages,
    addWindow() {
      windows.push({
        isDestroyed: () => false,
        isVisible: () => true,
        webContents: { send: (channel) => windowMessages.push(channel) },
      });
    },
    respawnTimer: () => [...timers].find((timer) => !baselineTimers.has(timer) && [1000, 3000, 10000].includes(timer.ms)),
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

const marker = (payload) => `FRC_SENDER_STARTUP_ERROR ${JSON.stringify(payload)}\n`;
const udpInUse = marker({ code: 'udp_port_unavailable', protocol: 'udp', port: 20777, reason: 'in_use', detail: 'bind: address already in use' });
const settingsInUse = marker({ code: 'settings_port_unavailable', protocol: 'tcp', port: 8099, reason: 'in_use', detail: 'bind: address already in use' });

test('UDP port conflict alert opens the UDP port settings without restarting the Sender', async (t) => {
  const main = mainProcess(t);
  main.addWindow();
  main.dialogResponses.push(0);
  // Split mid-line: stderr chunks do not respect line boundaries.
  main.children[0].stderr.emit('data', Buffer.from(udpInUse.slice(0, 30)));
  main.children[0].stderr.emit('data', Buffer.from(udpInUse.slice(30)));
  await settle();
  assert.equal(main.dialogs.length, 1);
  assert.match(main.dialogs[0].message, /UDP 포트 20777/);
  assert.deepEqual([...main.dialogs[0].buttons], ['UDP 포트 변경', '닫기']);
  assert.deepEqual(main.windowMessages, ['open-sender-udp-settings']);
  assert.equal(main.children.length, 1);
  assert.deepEqual(main.children[0].commands, []);
});

test('settings port conflict alert retry restarts the Sender', async (t) => {
  const main = mainProcess(t);
  main.dialogResponses.push(0);
  main.children[0].stderr.emit('data', Buffer.from(settingsInUse));
  await settle();
  assert.deepEqual([...main.dialogs[0].buttons], ['다시 시도', '닫기']);
  assert.deepEqual(main.children[0].commands, ['shutdown\n']);
  main.children[0].exit();
  await settle();
  assert.equal(main.children.length, 2);
});

test('closing the port alert leaves the Sender alone', async (t) => {
  const main = mainProcess(t);
  main.dialogResponses.push(1);
  main.children[0].stderr.emit('data', Buffer.from(settingsInUse));
  await settle();
  assert.equal(main.dialogs.length, 1);
  assert.deepEqual(main.children[0].commands, []);
  assert.equal(main.children.length, 1);
});

test('a crashed Sender is restarted with backoff, then the user is alerted', async (t) => {
  const main = mainProcess(t);
  for (const delay of [1000, 3000, 10000]) {
    main.children.at(-1).exit(2);
    const timer = main.respawnTimer();
    assert.equal(timer?.ms, delay);
    main.timers.delete(timer);
    timer.callback();
  }
  assert.equal(main.children.length, 4);
  main.dialogResponses.push(0);
  main.children.at(-1).exit(2);
  await settle();
  assert.equal(main.respawnTimer(), undefined);
  assert.equal(main.dialogs.length, 1);
  assert.match(main.dialogs[0].message, /반복해서 비정상 종료/);
  // "다시 시도" resets the crash budget and launches immediately.
  assert.equal(main.children.length, 5);
  main.children.at(-1).exit(2);
  assert.equal(main.respawnTimer()?.ms, 1000);
});

test('a clean Sender exit (tray Quit) is not restarted', (t) => {
  const main = mainProcess(t);
  main.children[0].exit(0);
  assert.equal(main.respawnTimer(), undefined);
  assert.equal(main.children.length, 1);
});

test('stopping or quitting cancels a pending crash restart', async (t) => {
  const main = mainProcess(t);
  main.children[0].exit(2);
  assert.ok(main.respawnTimer());
  main.app.quit();
  assert.equal(main.respawnTimer(), undefined);
  await settle();
  assert.equal(main.quits, 1);
  assert.equal(main.children.length, 1);
});

test('a manual restart replaces a pending crash restart', async (t) => {
  const main = mainProcess(t);
  main.children[0].exit(2);
  assert.ok(main.respawnTimer());
  await main.restart();
  assert.equal(main.respawnTimer(), undefined);
  assert.equal(main.children.length, 2);
});
