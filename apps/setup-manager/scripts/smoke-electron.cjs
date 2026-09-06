// Run the packaged main/preload/renderer with the installed Electron runtime.
// The bootstrap is unpackaged, so automatic updates remain disabled. Sender
// storage/lifecycle is tested separately; this checks renderer and window exit.
const electron = require('electron');
const path = require('node:path');
const fs = require('node:fs');

if (typeof electron === 'string') {
  const { spawnSync } = require('node:child_process');
  const userData = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'frc-electron-smoke-'));
  let status = 1;
  try {
    const result = spawnSync(electron, ['--no-sandbox', '--disable-gpu', __filename], {
      env: { ...process.env, FRC_SMOKE_USER_DATA: userData, FRC_SMOKE_ASAR: path.resolve(process.argv[2]) },
      stdio: 'inherit', timeout: 45000,
    });
    if (result.error) console.error(result.error);
    status = result.status ?? 1;
  } finally {
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  process.exitCode = status;
} else {
  const { app } = electron;
  app.setPath('userData', process.env.FRC_SMOKE_USER_DATA);
  const fail = (error) => { console.error(error); app.exit(1); };
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  const deadline = setTimeout(() => fail(new Error('Electron renderer/quit timed out.')), 30000);
  app.on('quit', () => { clearTimeout(deadline); console.log('ELECTRON_QUIT'); });
  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      try {
        const rendered = await win.webContents.executeJavaScript('({ title: document.title, text: document.body.innerText.slice(0,120), preload: typeof window.electronAPI })');
        if (!rendered.text || rendered.preload !== 'object') throw new Error(JSON.stringify(rendered));
        console.log('ELECTRON_RENDERED', JSON.stringify({ electron: process.versions.electron, ...rendered }));
        app.quit();
      } catch (error) { fail(error); }
    });
    win.webContents.on('did-fail-load', (_event, code, description) => fail(new Error(`${code}: ${description}`)));
  });
  require(path.join(process.env.FRC_SMOKE_ASAR, 'electron', 'main.cjs'));
}
