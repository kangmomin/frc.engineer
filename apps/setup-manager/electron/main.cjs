const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { stopSenderProcess } = require('./sender-lifecycle.cjs');
const {
  isTrustedMicrophoneCheck,
  isTrustedMicrophoneRequest,
  isTrustedRendererURL,
} = require('./intercom-policy.cjs');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (error) {
  console.warn('[updater] electron-updater unavailable:', error.message);
}

const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
const isDev = !app.isPackaged && !fs.existsSync(distIndex);
const isWin = process.platform === 'win32';
const SENDER_STORAGE_ROOT_KEY = 'frc_sender_storage_root';
const OVERLAY_HOTKEYS_KEY = 'overlay_hotkeys';
const DEFAULT_SENDER_API_BASE = 'http://localhost:8099';
const INTERCOM_BRIDGE_TOKEN = crypto.randomBytes(32).toString('hex');
const rendererPolicyOptions = { isDev, distIndex };
let trustedRendererWebContentsId = null;

// ─── Persistent settings (survives app updates) ───
const settingsPath = path.join(app.getPath('userData'), 'user-settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch (error) {
    // 파일 없음(첫 실행)은 정상 — 빈 설정으로 시작
    if (error && error.code === 'ENOENT') {
      return {};
    }
    // 파싱 실패 등은 손상 가능성 — 백업으로 복구 시도
    console.warn('[settings] Failed to read settings, trying backup:', error.message);
    try {
      return JSON.parse(fs.readFileSync(settingsPath + '.bak', 'utf-8'));
    } catch {
      return {};
    }
  }
}

function writeSettings(data) {
  // tmp 에 쓰고 rename 으로 원자적 교체 — 쓰기 도중 크래시로 설정이 깨지는 것을 방지
  const tmpPath = settingsPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  try {
    if (fs.existsSync(settingsPath)) {
      fs.copyFileSync(settingsPath, settingsPath + '.bak');
    }
  } catch {
    // 백업 실패는 치명적이지 않음
  }
  fs.renameSync(tmpPath, settingsPath);
}

ipcMain.handle('get-setting', (_event, key) => {
  return readSettings()[key] ?? null;
});

ipcMain.handle('set-setting', (_event, key, value) => {
  const data = readSettings();
  data[key] = value;
  writeSettings(data);
});

ipcMain.handle('get-all-settings', () => {
  return readSettings();
});

ipcMain.handle('get-intercom-bridge-token', (event) => {
  const frameURL = event.senderFrame?.url;
  if (event.sender.id !== trustedRendererWebContentsId || !isTrustedRendererURL(frameURL, rendererPolicyOptions)) {
    throw new Error('Intercom bridge capability is unavailable to this renderer.');
  }
  return INTERCOM_BRIDGE_TOKEN;
});

ipcMain.handle('set-overlay-hotkeys', (_event, hotkeys) => {
  const result = registerOverlayHotkeys(hotkeys || {});
  const data = readSettings();
  data[OVERLAY_HOTKEYS_KEY] = result.hotkeys;
  writeSettings(data);
  return result;
});

ipcMain.handle('get-overlay-hotkeys', () => {
  return readSettings()[OVERLAY_HOTKEYS_KEY] ?? null;
});

function normalizeHotkeyValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('+');
}

function toElectronAccelerator(value) {
  const normalized = normalizeHotkeyValue(value);
  if (!normalized) {
    return '';
  }
  return normalized
    .split('+')
    .map((part) => {
      const lower = part.toLowerCase();
      switch (lower) {
        case 'ctrl':
        case 'control':
          return 'CommandOrControl';
        case 'cmd':
        case 'command':
          return process.platform === 'darwin' ? 'Command' : 'Super';
        case 'meta':
        case 'super':
        case 'win':
        case 'windows':
          return 'Super';
        case 'option':
          return 'Alt';
        case 'esc':
        case 'escape':
          return 'Esc';
        case 'return':
          return 'Enter';
        case 'arrowup':
          return 'Up';
        case 'arrowdown':
          return 'Down';
        case 'arrowleft':
          return 'Left';
        case 'arrowright':
          return 'Right';
        case 'plus':
          return 'Plus';
        default:
          if (/^f\d{1,2}$/i.test(part)) {
            return part.toUpperCase();
          }
          if (part.length === 1) {
            return part.toUpperCase();
          }
          return part[0].toUpperCase() + part.slice(1);
      }
    })
    .join('+');
}

function normalizeStoredPath(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return path.resolve(trimmed);
}

// ─── Sender process management ───
let senderProcess = null;
let senderStopPromise = null;
let senderInstallPending = false;
let isQuitting = false;
let registeredOverlayHotkeys = {};
// 강제 업데이트 게이트 상태 — { version, phase: 'downloading' | 'installing' | 'failed' }
// phase 가 'failed' 면 fail-open 상태(게이트 해제)이므로 sender 기동을 다시 허용한다.
let mandatoryUpdate = null;

function isUpdateGateActive() {
  return Boolean(mandatoryUpdate) && mandatoryUpdate.phase !== 'failed';
}

async function postSenderToggle(kind) {
  const endpointMap = {
    radar: '/api/radar/toggle',
    weather: '/api/weather/toggle',
    strategy: '/api/strategy/toggle',
  };
  const endpoint = endpointMap[kind];
  if (!endpoint) {
    return;
  }
  try {
    const response = await fetch(`${DEFAULT_SENDER_API_BASE}${endpoint}`, {
      method: 'POST',
    });
    if (!response.ok) {
      console.error(`[hotkey] Failed to toggle ${kind}: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`[hotkey] Failed to toggle ${kind}:`, error instanceof Error ? error.message : String(error));
  }
}

function unregisterOverlayHotkeys() {
  Object.values(registeredOverlayHotkeys).forEach((accelerator) => {
    if (accelerator && globalShortcut.isRegistered(accelerator)) {
      globalShortcut.unregister(accelerator);
    }
  });
  registeredOverlayHotkeys = {};
}

function registerOverlayHotkeys(hotkeys) {
  const normalizedHotkeys = {
    radar: normalizeHotkeyValue(hotkeys?.radar),
    weather: normalizeHotkeyValue(hotkeys?.weather),
    strategy: normalizeHotkeyValue(hotkeys?.strategy),
  };
  const errors = [];
  const seenAccelerators = new Map();

  unregisterOverlayHotkeys();

  for (const [kind, value] of Object.entries(normalizedHotkeys)) {
    if (!value) {
      continue;
    }
    const accelerator = toElectronAccelerator(value);
    if (!accelerator) {
      errors.push(`${kind}: invalid hotkey`);
      continue;
    }
    const duplicateKind = seenAccelerators.get(accelerator);
    if (duplicateKind) {
      errors.push(`${kind}: duplicates ${duplicateKind}`);
      continue;
    }

    try {
      const registered = globalShortcut.register(accelerator, () => {
        void postSenderToggle(kind);
      });
      if (!registered) {
        errors.push(`${kind}: failed to register ${value}`);
        continue;
      }
      seenAccelerators.set(accelerator, kind);
      registeredOverlayHotkeys[kind] = accelerator;
    } catch (error) {
      errors.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    hotkeys: normalizedHotkeys,
    errors,
    registered: {
      radar: Boolean(registeredOverlayHotkeys.radar),
      weather: Boolean(registeredOverlayHotkeys.weather),
      strategy: Boolean(registeredOverlayHotkeys.strategy),
    },
  };
}

function findSenderBinary() {
  const candidates = [
    // Packaged: extraResources
    path.join(process.resourcesPath || '', 'sender', 'frc-pitwall-sender.exe'),
    // Dev: project build artifacts
    path.join(__dirname, '..', '..', '..', 'build', 'artifacts', 'frc-pitwall-sender.exe'),
    path.join(__dirname, '..', '..', '..', 'build', 'source-deploy-1', 'frc-pitwall-sender.exe'),
    // Same directory as app
    path.join(__dirname, '..', 'frc-pitwall-sender.exe'),
    path.join(app.getAppPath(), 'frc-pitwall-sender.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getSelectedSenderStorageRoot() {
  return normalizeStoredPath(readSettings()[SENDER_STORAGE_ROOT_KEY]);
}

function getDefaultSenderStorageRoot() {
  return path.join(app.getPath('userData'), 'sender');
}

function getLegacyPackagedSenderStorageRoot() {
  if (!app.isPackaged) {
    return null;
  }
  const bin = findSenderBinary();
  if (!bin) {
    return null;
  }
  const root = path.dirname(bin);
  return root === getDefaultSenderStorageRoot() ? null : root;
}

// data/strategy 는 extraResources 로 배포되는 정적 자산이라 마이그레이션 대상이 아님
// (userData 로 복사되면 업데이트로 갱신된 strategy 데이터를 영구히 가린다)
const DEPLOYED_STRATEGY_SUBDIR = path.join('data', 'strategy');

function isDeployedStrategyAsset(legacyRoot, absPath) {
  const rel = path.relative(legacyRoot, absPath);
  return rel === DEPLOYED_STRATEGY_SUBDIR || rel.startsWith(DEPLOYED_STRATEGY_SUBDIR + path.sep);
}

// 진짜 사용자 산출물(sender-config.json, 녹화 등)이 있는지 — 배포 자산(strategy)만 있으면 false
function hasUserArtifacts(legacyRoot, name) {
  const dir = path.join(legacyRoot, name);
  if (!fs.existsSync(dir)) {
    return false;
  }
  if (name !== 'data') {
    return true;
  }
  return fs.readdirSync(dir).some((entry) => entry !== 'strategy');
}

function migrateSenderStorageIfNeeded(targetRoot) {
  const selected = getSelectedSenderStorageRoot();
  if (selected || !targetRoot) {
    return;
  }

  const legacyRoot = getLegacyPackagedSenderStorageRoot();
  if (!legacyRoot) {
    return;
  }

  const names = ['data', 'logs'];
  const hasLegacyData = names.some((name) => hasUserArtifacts(legacyRoot, name));
  if (!hasLegacyData) {
    return;
  }

  fs.mkdirSync(targetRoot, { recursive: true });
  for (const name of names) {
    const source = path.join(legacyRoot, name);
    const destination = path.join(targetRoot, name);
    if (!hasUserArtifacts(legacyRoot, name) || fs.existsSync(destination)) {
      continue;
    }
    fs.cpSync(source, destination, {
      recursive: true,
      filter: (src) => !isDeployedStrategyAsset(legacyRoot, src),
    });
    console.log(`[sender] Migrated ${name} from legacy storage:`, source, '->', destination);
  }
}

// 과거 마이그레이션이 복사해 둔 배포 자산 사본을 정리 — sender 는 실행 파일 옆 자산으로 폴백한다
function cleanupCopiedStrategyAssets() {
  const strategyDir = path.join(getDefaultSenderStorageRoot(), DEPLOYED_STRATEGY_SUBDIR);
  if (!fs.existsSync(strategyDir)) {
    return;
  }
  fs.rmSync(strategyDir, { recursive: true, force: true });
  console.log('[sender] Removed stale copied strategy assets:', strategyDir);
}

function getSenderStorageInfo() {
  const selected = getSelectedSenderStorageRoot();
  const effective = selected || getDefaultSenderStorageRoot();
  return {
    selected,
    effective,
    usingCustom: Boolean(selected),
  };
}

ipcMain.handle('get-sender-storage-info', () => {
  return getSenderStorageInfo();
});

ipcMain.handle('select-directory', async (_event, defaultPath) => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: typeof defaultPath === 'string' && defaultPath.trim() ? defaultPath.trim() : undefined,
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  return result.filePaths[0];
});

function startSender() {
  if (senderProcess || senderStopPromise || senderInstallPending || isQuitting) {
    return;
  }
  // 강제 업데이트 중에는 구버전 sender 가 다시 뜨지 않도록 차단
  if (isUpdateGateActive()) {
    console.log('[sender] Start skipped: mandatory update in progress');
    return;
  }

  const bin = findSenderBinary();
  if (!bin) {
    console.log('[sender] Binary not found, running without sender backend');
    return;
  }

  console.log('[sender] Starting:', bin);
  const cwd = path.dirname(bin);
  const senderStorageRoot = getSenderStorageInfo().effective;
  // 마이그레이션/정리 실패가 앱 시작을 막지 않도록 방어
  try {
    cleanupCopiedStrategyAssets();
    migrateSenderStorageIfNeeded(senderStorageRoot);
  } catch (error) {
    console.error('[sender] Storage migration failed:', error instanceof Error ? error.message : String(error));
  }
  const env = {
    ...process.env,
    SETTINGS_PORT: '8099',
    FRC_NO_BROWSER: '1',
    DRIVER_PACK_EMBEDDED: '1',
    FRC_MANAGED_STDIN: '1',
    SAVE_FILES: 'true',
    FRC_INTERCOM_BRIDGE_TOKEN: INTERCOM_BRIDGE_TOKEN,
  };
  env.FRC_STORAGE_DIR = senderStorageRoot;
  console.log('[sender] Using storage root:', senderStorageRoot);

  const proc = spawn(bin, [], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env,
  });
  senderProcess = proc;
  proc.stdout?.on('data', d => console.log('[sender]', d.toString().trim()));
  proc.stderr?.on('data', d => console.error('[sender]', d.toString().trim()));
  proc.on('error', err => console.error('[sender] Failed to start:', err.message));
  proc.on('exit', (code, signal) => {
    console.log(`[sender] Exited: code=${code} signal=${signal}`);
    if (senderProcess === proc) senderProcess = null;
  });
}

function stopSender() {
  if (senderStopPromise) return senderStopPromise;
  const proc = senderProcess;
  if (!proc) return Promise.resolve();
  console.log('[sender] Stopping...');
  senderStopPromise = stopSenderProcess(proc, {
    forceStop: (child) => {
      console.warn('[sender] Graceful stop timed out or pipe unavailable; forcing exit.');
      if (!isWin) {
        child.kill('SIGKILL');
        return;
      }
      return new Promise((resolve, reject) => {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
          stdio: 'ignore', windowsHide: true,
        });
        killer.once('error', reject);
        killer.once('exit', (code) => {
          if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
          else reject(new Error(`taskkill failed with exit code ${code}`));
        });
      });
    },
  }).finally(() => {
    if (senderProcess === proc && (proc.exitCode !== null || proc.signalCode !== null || !proc.pid)) {
      senderProcess = null;
    }
    senderStopPromise = null;
  });
  return senderStopPromise;
}

ipcMain.handle('restart-sender', async () => {
  // 게이트를 우회해 sender 를 되살리는 경로 차단
  if (isUpdateGateActive() || senderInstallPending) {
    console.log('[sender] Restart blocked: mandatory update in progress');
    return;
  }
  await stopSender();
  // stopSender 대기 중 앱 종료가 시작됐으면 재기동하지 않음
  if (isQuitting) {
    return;
  }
  startSender();
});

// ─── Auto-updater ───
const UPDATE_FAILURES_KEY = 'mandatory_update_failures';
const MAX_GATE_FAILURES = 3; // 동일 버전이 이만큼 실패하면 그 버전은 강제하지 않는다
const MAX_DOWNLOAD_RETRIES = 2;
const INSTALL_WATCHDOG_MS = 15000;
// electron.net 의 ClientRequest 는 'socket' 이벤트를 내지 않아 electron-updater 의
// 소켓 타임아웃(httpExecutor.addTimeOutHandler)이 설치되지 않는다. 반열림 연결에서
// 다운로드가 에러 없이 멈추면 빠져나갈 경로가 없으므로 진행률 기준 자체 워치독을 둔다.
const DOWNLOAD_STALL_MS = 120000;
const RELEASES_URL = 'https://github.com/kangmomin/frc.engineer-deploy/releases';

// 마지막 상태를 캐시하고 모든 창에 브로드캐스트 — 창이 재생성되거나
// 렌더러 마운트 전에 이벤트가 도착해도 상태가 유실되지 않는다.
let lastUpdateStatus = null;

function broadcastUpdateStatus(payload) {
  lastUpdateStatus = payload;
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('update-status', payload);
    }
  });
}

ipcMain.handle('get-update-status', () => lastUpdateStatus);

function readUpdateFailures(version) {
  const record = readSettings()[UPDATE_FAILURES_KEY];
  return record && record.version === version ? Number(record.count) || 0 : 0;
}

// NSIS 설치는 성공/실패를 알려주지 않는다 — NsisUpdater.doInstall 은 spawn 직후
// 무조건 true 를 반환하고 앱은 곧바로 종료된다. 그래서 "실패를 감지해서" 세는 것이
// 불가능하므로 **시도 시점에 미리** 센다. 설치가 실제로 성공했다면 다음 실행에서
// clearUpdateFailuresIfInstalled() 가 지운다.
function recordUpdateFailure(version) {
  const count = readUpdateFailures(version) + 1;
  try {
    const data = readSettings();
    data[UPDATE_FAILURES_KEY] = { version, count };
    writeSettings(data);
  } catch (error) {
    console.error('[updater] Failed to persist failure count:', error.message);
  }
  return count;
}

function clearUpdateFailuresIfInstalled() {
  const data = readSettings();
  const record = data[UPDATE_FAILURES_KEY];
  // 기록된 버전으로 지금 실행 중이면 그 설치는 성공한 것이다
  if (!record || record.version !== app.getVersion()) {
    return;
  }
  delete data[UPDATE_FAILURES_KEY];
  try {
    writeSettings(data);
  } catch (error) {
    console.error('[updater] Failed to clear failure count:', error.message);
  }
}

function setupAutoUpdater(win) {
  if (!autoUpdater) {
    console.warn('[updater] Auto updates disabled because electron-updater is unavailable.');
    win.webContents.once('did-finish-load', () => {
      broadcastUpdateStatus({ status: 'unavailable' });
    });
    ipcMain.removeAllListeners('install-update');
    ipcMain.on('install-update', () => {
      console.warn('[updater] Install update requested while updater is unavailable.');
    });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let downloadRetries = 0;
  let stallTimer = null;
  let optionalInstallTimer = null;

  function failOptionalInstall(error, install = senderInstallPending) {
    if (!install || senderInstallPending !== install) return;
    clearTimeout(optionalInstallTimer);
    senderInstallPending = false;
    console.error('[updater] Optional install failed:', error.message);
    startSender();
    broadcastUpdateStatus({ status: 'error', releasesUrl: RELEASES_URL });
  }

  // fail-open: 강제 게이트를 풀고 앱을 다시 사용 가능한 상태로 되돌린다.
  // 업데이터가 깨진 릴리스를 배포해도 전체 사용자가 영구히 잠기지 않도록 하는 안전장치.
  function releaseGate(version) {
    clearTimeout(stallTimer);
    mandatoryUpdate = { version, phase: 'failed' };
    registerOverlayHotkeys(readSettings()[OVERLAY_HOTKEYS_KEY] || {});
    startSender();
    broadcastUpdateStatus({ status: 'error', version, releasesUrl: RELEASES_URL });
  }

  // 진행률이 갱신될 때마다 다시 건다 — 느리지만 진행 중인 다운로드는 죽이지 않고,
  // 완전히 멈춘 연결만 걸러낸다.
  function armStallWatchdog(version) {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (mandatoryUpdate && mandatoryUpdate.phase === 'downloading') {
        const failures = recordUpdateFailure(version);
        console.error(`[updater] Download stalled for ${DOWNLOAD_STALL_MS}ms (failures=${failures}) — releasing gate`);
        releaseGate(version);
      }
    }, DOWNLOAD_STALL_MS);
  }

  async function installMandatoryUpdate(version) {
    clearTimeout(stallTimer);
    const update = mandatoryUpdate;
    await stopSender();
    if (mandatoryUpdate !== update || !isUpdateGateActive()) {
      startSender();
      return;
    }
    // 설치 결과는 알 수 없으므로(위 recordUpdateFailure 주석 참조) 시도 직전에 카운트한다.
    // writeSettings 는 동기라 곧바로 이어지는 app.quit() 이후에도 남는다.
    recordUpdateFailure(version);
    // quitAndInstall 이 종료 없이 반환되는 경로(BaseUpdater.install → false)를 대비한 워치독
    setTimeout(() => {
      if (mandatoryUpdate === update && mandatoryUpdate.phase === 'installing') {
        console.error(`[updater] Install did not quit within ${INSTALL_WATCHDOG_MS}ms — releasing gate`);
        releaseGate(version);
      }
    }, INSTALL_WATCHDOG_MS);
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (error) {
      console.error('[updater] quitAndInstall threw:', error.message);
    }
  }

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);
    const failures = readUpdateFailures(info.version);
    if (failures >= MAX_GATE_FAILURES) {
      // 이 버전은 이미 여러 번 설치에 실패했다 — 강제하지 않고 기존 선택형 흐름으로 되돌린다
      console.warn(`[updater] Skipping mandatory gate for ${info.version} (failures=${failures})`);
      broadcastUpdateStatus({ status: 'available', version: info.version });
      return;
    }
    mandatoryUpdate = { version: info.version, phase: 'downloading' };
    // 오버레이 핫키가 게이트 뒤에서 계속 동작하지 않도록 해제
    unregisterOverlayHotkeys();
    armStallWatchdog(info.version);
    broadcastUpdateStatus({ status: 'mandatory', phase: 'downloading', version: info.version, percent: 0 });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    if (mandatoryUpdate && mandatoryUpdate.phase === 'downloading') {
      armStallWatchdog(mandatoryUpdate.version);
      broadcastUpdateStatus({ status: 'mandatory', phase: 'downloading', version: mandatoryUpdate.version, percent });
      return;
    }
    // 게이트가 생략된 경우 — 기존 하단 진행 바 유지
    broadcastUpdateStatus({ status: 'downloading', percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Update downloaded:', info.version);
    if (!isUpdateGateActive()) {
      // 게이트가 생략/해제된 경우 — 기존 배너로 안내만 하고 설치는 사용자에게 맡긴다
      broadcastUpdateStatus({ status: 'ready', version: info.version });
      return;
    }
    mandatoryUpdate = { version: info.version, phase: 'installing' };
    broadcastUpdateStatus({ status: 'mandatory', phase: 'installing', version: info.version });
    void installMandatoryUpdate(info.version).catch((error) => {
      console.error('[updater] Could not stop Sender for update:', error.message);
      releaseGate(info.version);
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message);
    failOptionalInstall(err);
    if (!isUpdateGateActive()) {
      return;
    }
    const { version, phase } = mandatoryUpdate;
    if (phase === 'downloading' && downloadRetries < MAX_DOWNLOAD_RETRIES) {
      downloadRetries += 1;
      const delay = downloadRetries * 5000;
      console.log(`[updater] Retrying download in ${delay}ms (${downloadRetries}/${MAX_DOWNLOAD_RETRIES})`);
      setTimeout(() => {
        autoUpdater.downloadUpdate().catch((error) => {
          console.error('[updater] Retry failed:', error.message);
        });
      }, delay);
      return;
    }
    // installing 단계는 installMandatoryUpdate 가 이미 선기록했으므로 중복 카운트하지 않는다
    if (phase === 'downloading') {
      const failures = recordUpdateFailure(version);
      console.error(`[updater] Mandatory download failed (failures=${failures}) — releasing gate`);
    }
    releaseGate(version);
  });

  ipcMain.removeAllListeners('install-update');
  ipcMain.on('install-update', () => {
    if (senderInstallPending || isUpdateGateActive()) return;
    // Take ownership before awaiting a shared stop: an earlier restart handler
    // must not launch a new Sender in the gap before quitAndInstall runs.
    const install = {};
    senderInstallPending = install;
    void stopSender().then(() => {
      if (senderInstallPending !== install) {
        startSender();
        return;
      }
      optionalInstallTimer = setTimeout(() => {
        failOptionalInstall(new Error('Installer did not quit the application.'), install);
      }, INSTALL_WATCHDOG_MS);
      autoUpdater.quitAndInstall(true, true);
    }).catch((error) => failOptionalInstall(error, install));
  });

  setTimeout(() => {
    autoUpdater
      .checkForUpdates()
      .then((result) => {
        // AppUpdater 는 다운로드 실패 시 dispatchError 후 rethrow 하므로,
        // 여기서 흡수하지 않으면 unhandled rejection 이 남는다.
        result?.downloadPromise?.catch(() => {});
      })
      .catch((err) => {
        console.error('[updater] Check failed:', err.message);
      });
  }, 3000);
}

// ─── Window ───
function createWindow() {
  const winOpts = {
    width: 680,
    height: 960,
    minWidth: 560,
    minHeight: 700,
    backgroundColor: '#131314',
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, 'icon.ico'),
    show: false,
  };

  if (isWin) {
    winOpts.titleBarOverlay = { color: '#131314', symbolColor: '#849396', height: 32 };
  }

  const win = new BrowserWindow(winOpts);
  trustedRendererWebContentsId = win.webContents.id;
  Menu.setApplicationMenu(null);

  const permissionSession = win.webContents.session;
  permissionSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isTrustedMicrophoneRequest({
      permission,
      details,
      requestingURL: details.requestingUrl,
      webContentsId: webContents.id,
      trustedWebContentsId: trustedRendererWebContentsId,
      options: rendererPolicyOptions,
    }));
  });
  permissionSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => (
    isTrustedMicrophoneCheck({
      permission,
      details,
      requestingURL: webContents?.getURL() || requestingOrigin,
      webContentsId: webContents?.id,
      trustedWebContentsId: trustedRendererWebContentsId,
      options: rendererPolicyOptions,
    })
  ));

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL('http://localhost:5173');
    // win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(distIndex);
  }

  const fallbackShowTimer = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 3000);
  win.once('closed', () => {
    clearTimeout(fallbackShowTimer);
    if (trustedRendererWebContentsId === win.webContents.id) trustedRendererWebContentsId = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // 외부 링크는 기본 브라우저로 — http/https 스킴만 허용해 임의 스킴 실행을 차단
    try {
      const { protocol } = new URL(url);
      if (protocol === 'http:' || protocol === 'https:') {
        require('electron').shell.openExternal(url);
      }
    } catch {
      // 잘못된 URL 은 무시
    }
    return { action: 'deny' };
  });

  // 렌더러가 로컬 origin 밖으로 이동하면 원격 페이지가 preload 의 electronAPI 를 획득할 수 있어 차단
  win.webContents.on('will-navigate', (event, targetUrl) => {
    let allowed = false;
    try {
      const target = new URL(targetUrl);
      // dev 는 Vite 서버 origin, prod 는 file:// 로컬 리소스만 허용
      allowed = isDev ? target.origin === 'http://localhost:5173' : target.protocol === 'file:';
    } catch {
      allowed = false;
    }
    if (!allowed) event.preventDefault();
  });

  return win;
}

// ─── Lifecycle ───
// 중복 실행 시 sender 포트(8099)/스토리지가 충돌하므로 단일 인스턴스만 허용
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    // 이 버전으로 실행됐다는 것은 설치가 성공했다는 뜻 — 선기록한 실패 카운트를 지운다
    clearUpdateFailuresIfInstalled();
    registerOverlayHotkeys(readSettings()[OVERLAY_HOTKEYS_KEY] || {});
    startSender();
    const win = createWindow();
    if (app.isPackaged) {
      setupAutoUpdater(win);
    }
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  isQuitting = true;
  if (!senderProcess && !senderStopPromise) return;
  // Resume quit only after exit; autoInstallOnAppQuit then sees closed files.
  event.preventDefault();
  void stopSender().then(() => app.quit()).catch((error) => {
    isQuitting = false;
    console.error('[sender] Could not stop Sender:', error.message);
  });
});

app.on('will-quit', () => {
  unregisterOverlayHotkeys();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
