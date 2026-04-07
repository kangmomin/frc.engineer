const { app, BrowserWindow, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
const isDev = !app.isPackaged && !fs.existsSync(distIndex);
const isWin = process.platform === 'win32';

// ─── Sender process management ───
let senderProcess = null;

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

function startSender() {
  const bin = findSenderBinary();
  if (!bin) {
    console.log('[sender] Binary not found, running without sender backend');
    return;
  }

  console.log('[sender] Starting:', bin);
  const cwd = path.dirname(bin);

  senderProcess = spawn(bin, [], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, SETTINGS_PORT: '8099', FRC_NO_BROWSER: '1' },
  });

  senderProcess.stdout?.on('data', d => console.log('[sender]', d.toString().trim()));
  senderProcess.stderr?.on('data', d => console.error('[sender]', d.toString().trim()));
  senderProcess.on('error', err => console.error('[sender] Failed to start:', err.message));
  senderProcess.on('exit', (code, signal) => {
    console.log(`[sender] Exited: code=${code} signal=${signal}`);
    senderProcess = null;
  });
}

function stopSender() {
  if (!senderProcess) return;
  console.log('[sender] Stopping...');
  if (isWin) {
    spawn('taskkill', ['/pid', String(senderProcess.pid), '/f', '/t'], { windowsHide: true });
  } else {
    senderProcess.kill('SIGTERM');
  }
  senderProcess = null;
}

// ─── Window ───
function createWindow() {
  const winOpts = {
    width: 680,
    height: 960,
    minWidth: 560,
    minHeight: 700,
    backgroundColor: '#131314',
    frame: false,
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
}

// ─── Lifecycle ───
app.whenReady().then(() => {
  startSender();
  createWindow();
});

app.on('window-all-closed', () => {
  stopSender();
  app.quit();
});

app.on('before-quit', () => {
  stopSender();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
