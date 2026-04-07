const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;
const isWin = process.platform === 'win32';

function createWindow() {
  const winOpts = {
    width: 520,
    height: 860,
    minWidth: 420,
    minHeight: 600,
    backgroundColor: '#06080d',
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, 'icon.ico'),
    show: false, // show after ready-to-show to avoid white flash
  };

  // Windows: use titleBarOverlay for native controls on frameless window
  if (isWin) {
    winOpts.titleBarOverlay = {
      color: '#06080d',
      symbolColor: '#5a6577',
      height: 32,
    };
  }

  const win = new BrowserWindow(winOpts);

  Menu.setApplicationMenu(null);

  // Show window only after content is ready (prevents blank flash)
  win.once('ready-to-show', () => {
    win.show();
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    // win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Fallback: if ready-to-show doesn't fire within 3s, force show
  setTimeout(() => { if (!win.isVisible()) win.show(); }, 3000);

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
