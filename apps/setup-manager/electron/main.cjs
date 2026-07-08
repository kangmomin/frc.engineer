const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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
let isQuitting = false;
let registeredOverlayHotkeys = {};

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
  if (senderProcess || isQuitting) {
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
    SAVE_FILES: 'true',
  };
  env.FRC_STORAGE_DIR = senderStorageRoot;
  console.log('[sender] Using storage root:', senderStorageRoot);

  senderProcess = spawn(bin, [], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env,
  });

  senderProcess.stdout?.on('data', d => console.log('[sender]', d.toString().trim()));
  senderProcess.stderr?.on('data', d => console.error('[sender]', d.toString().trim()));
  senderProcess.on('error', err => console.error('[sender] Failed to start:', err.message));
  senderProcess.on('exit', (code, signal) => {
    console.log(`[sender] Exited: code=${code} signal=${signal}`);
    senderProcess = null;
  });
}

async function stopSender() {
  const proc = senderProcess;
  if (!proc) return;
  console.log('[sender] Stopping...');
  senderProcess = null;

  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      resolve();
    };

    const timer = setTimeout(finish, 5000);
    proc.once('exit', () => {
      clearTimeout(timer);
      finish();
    });
    proc.once('error', () => {
      clearTimeout(timer);
      finish();
    });

    if (isWin && proc.pid) {
      const killer = spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        clearTimeout(timer);
        finish();
      });
      return;
    }

    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

ipcMain.handle('restart-sender', async () => {
  await stopSender();
  // stopSender 대기 중 앱 종료가 시작됐으면 재기동하지 않음
  if (isQuitting) {
    return;
  }
  startSender();
});

// ─── Auto-updater ───
function setupAutoUpdater(win) {
  // 창이 이미 파괴된 뒤 도착하는 updater 이벤트가 예외를 던지지 않도록 가드
  const sendStatus = (payload) => {
    if (!win.isDestroyed()) {
      win.webContents.send('update-status', payload);
    }
  };

  if (!autoUpdater) {
    console.warn('[updater] Auto updates disabled because electron-updater is unavailable.');
    win.webContents.once('did-finish-load', () => {
      sendStatus({ status: 'unavailable' });
    });
    ipcMain.removeAllListeners('install-update');
    ipcMain.on('install-update', () => {
      console.warn('[updater] Install update requested while updater is unavailable.');
    });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);
    sendStatus({ status: 'available', version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({
      status: 'downloading',
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Update downloaded:', info.version);
    sendStatus({ status: 'ready', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message);
  });

  ipcMain.on('install-update', () => {
    void stopSender().finally(() => {
      autoUpdater.quitAndInstall(true, true);
    });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
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
  Menu.setApplicationMenu(null);

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
  win.once('closed', () => clearTimeout(fallbackShowTimer));

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
    registerOverlayHotkeys(readSettings()[OVERLAY_HOTKEYS_KEY] || {});
    startSender();
    const win = createWindow();
    if (app.isPackaged) {
      setupAutoUpdater(win);
    }
  });
}

app.on('window-all-closed', () => {
  isQuitting = true;
  void stopSender().finally(() => {
    app.quit();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  void stopSender();
});

app.on('will-quit', () => {
  unregisterOverlayHotkeys();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
