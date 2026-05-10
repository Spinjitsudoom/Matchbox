const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

const PORT = 8765;
const PROJECT_ROOT = path.join(__dirname, '..', '..');
let backend = null;
let mainWindow = null;
let logStream = null;

function getLogPath() {
  return path.join(os.homedir(), 'Documents', 'Matchbox', 'backend.log');
}

function openLog() {
  try {
    const logDir = path.join(os.homedir(), 'Documents', 'Matchbox');
    fs.mkdirSync(logDir, { recursive: true });
    logStream = fs.createWriteStream(getLogPath(), { flags: 'a' });
    logStream.write(`\n--- Matchbox started ${new Date().toISOString()} ---\n`);
  } catch {}
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stderr.write(line);
  try { logStream && logStream.write(line); } catch {}
}

function startBackend() {
  openLog();
  let cmd, args, opts;

  if (app.isPackaged) {
    // Packaged: use the bundled PyInstaller binary from resources
    const backendExe = path.join(process.resourcesPath, 'backend', 'backend_main');
    // Strip any AppImage-injected LD_LIBRARY_PATH so it doesn't conflict
    // with the bundled ctranslate2/av native libraries
    const env = Object.assign({}, process.env);
    delete env.LD_LIBRARY_PATH;
    cmd  = backendExe;
    args = [String(PORT)];
    opts = { stdio: ['ignore', 'pipe', 'pipe'], env };
  } else {
    // Dev: run via uv
    const uvBin = 'uv';
    const uvPath = [
      path.join(process.env.HOME || '', '.local', 'bin', uvBin),
      uvBin,
    ].find(p => { try { require('fs').accessSync(p); return true; } catch { return false; } }) || uvBin;

    cmd  = uvPath;
    args = ['run', 'uvicorn', 'api:app', '--host', '127.0.0.1', '--port', String(PORT), '--log-level', 'warning'];
    opts = { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] };
  }

  backend = spawn(cmd, args, opts);
  backend.stderr.on('data', d => log(`[backend] ${d.toString().trim()}`));
  backend.on('exit', (code, signal) => {
    if (code !== 0 || signal) log(`Backend exited: code=${code} signal=${signal}`);
  });
}

function waitForServer(url, retries = 30) {
  return new Promise((resolve, reject) => {
    const tryFetch = () => {
      http.get(url, res => {
        res.resume();
        resolve();
      }).on('error', () => {
        if (--retries <= 0) { reject(new Error('Backend not ready')); return; }
        setTimeout(tryFetch, 300);
      });
    };
    tryFetch();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'Matchbox',
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    backgroundColor: '#0d0f14',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    autoHideMenuBar: true,
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  }

  // Open external links in real browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Media Folder',
  });
  return result.canceled ? null : result.filePaths[0];
});

app.whenReady().then(async () => {
  startBackend();

  try {
    await waitForServer(`http://127.0.0.1:${PORT}/api/config`);
  } catch {
    console.error('Could not connect to backend');
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backend) { backend.kill(); backend = null; }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backend) { backend.kill(); backend = null; }
});
