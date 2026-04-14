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
  } catch {
    return {};
  }
}

function writeSettings(data) {
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf-8');
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
  const bin = findSenderBinary();
  if (bin) {
    return path.dirname(bin);
  }
  return path.join(app.getPath('userData'), 'sender');
}

function getSenderStorageInfo() {
  const selected = getSelectedSenderStorageRoot();
  return {
    selected,
    effective: selected || getDefaultSenderStorageRoot(),
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
  if (senderProcess) {
    return;
  }

  const bin = findSenderBinary();
  if (!bin) {
    console.log('[sender] Binary not found, running without sender backend');
    return;
  }

  console.log('[sender] Starting:', bin);
  const cwd = path.dirname(bin);
  const senderStorageRoot = getSelectedSenderStorageRoot();
  const env = {
    ...process.env,
    SETTINGS_PORT: '8099',
    FRC_NO_BROWSER: '1',
    DRIVER_PACK_EMBEDDED: '1',
    SAVE_FILES: 'true',
  };
  if (senderStorageRoot) {
    env.FRC_STORAGE_DIR = senderStorageRoot;
    console.log('[sender] Using storage root:', senderStorageRoot);
  }

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
  startSender();
});

// ─── Auto-updater ───
function setupAutoUpdater(win) {
  if (!autoUpdater) {
    console.warn('[updater] Auto updates disabled because electron-updater is unavailable.');
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('update-status', { status: 'unavailable' });
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
    win.webContents.send('update-status', { status: 'available', version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Update downloaded:', info.version);
    win.webContents.send('update-status', { status: 'ready', version: info.version });
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

  setTimeout(() => { if (!win.isVisible()) win.show(); }, 3000);

  win.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ─── Lifecycle ───
app.whenReady().then(() => {
  registerOverlayHotkeys(readSettings()[OVERLAY_HOTKEYS_KEY] || {});
  startSender();
  const win = createWindow();
  if (app.isPackaged) {
    setupAutoUpdater(win);
  }
});

app.on('window-all-closed', () => {
  void stopSender().finally(() => {
    app.quit();
  });
});

app.on('before-quit', () => {
  void stopSender();
});

app.on('will-quit', () => {
  unregisterOverlayHotkeys();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
