const { app, BrowserWindow, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

let mainWindow = null;
let splashWindow = null;
let nextProcess = null;
let tray = null;

const isDev = !app.isPackaged;
const DEV_PORT = 3001;
const PROD_PORT = 3001;

function getPort() {
  return isDev ? DEV_PORT : PROD_PORT;
}

// Check if a port is in use (i.e. Next.js server is ready)
function waitForPort(port, retries = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function tryConnect() {
      attempts++;
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('timeout', () => {
        socket.destroy();
        if (attempts >= retries) return reject(new Error('Server did not start'));
        setTimeout(tryConnect, 500);
      });
      socket.once('error', () => {
        if (attempts >= retries) return reject(new Error('Server did not start'));
        setTimeout(tryConnect, 500);
      });
      socket.connect(port, '127.0.0.1');
    }
    tryConnect();
  });
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Linker Pro',
    frame: true,
    titleBarStyle: 'default',
    backgroundColor: '#0F172A',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
    },
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Hide to tray on close instead of quitting
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  return mainWindow;
}

function createTray() {
  // Use a simple 16x16 tray icon (in production, use a real icon file)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Linker Pro',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Linker Pro');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

async function startNextServer() {
  if (isDev) {
    // In dev mode, just connect to the running Next.js dev server
    // User should run `npm run dev:frontend` separately or we start it:
    const frontendDir = path.join(__dirname, '..', 'frontend');
    nextProcess = spawn('npx', ['next', 'dev', '--port', String(DEV_PORT)], {
      cwd: frontendDir,
      stdio: 'pipe',
      shell: true,
      env: { ...process.env, BROWSER: 'none' },
    });

    nextProcess.stdout.on('data', (data) => {
      console.log(`[Next.js] ${data.toString().trim()}`);
    });
    nextProcess.stderr.on('data', (data) => {
      console.error(`[Next.js] ${data.toString().trim()}`);
    });
  } else {
    // In production, run the standalone Next.js server
    const serverPath = path.join(process.resourcesPath, 'app', 'server.js');
    nextProcess = spawn('node', [serverPath], {
      cwd: path.join(process.resourcesPath, 'app'),
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: String(PROD_PORT),
        HOSTNAME: '127.0.0.1',
      },
    });

    nextProcess.stdout.on('data', (data) => {
      console.log(`[Next.js] ${data.toString().trim()}`);
    });
    nextProcess.stderr.on('data', (data) => {
      console.error(`[Next.js] ${data.toString().trim()}`);
    });
  }
}

app.whenReady().then(async () => {
  createSplashWindow();

  try {
    await startNextServer();
    await waitForPort(getPort());
  } catch (err) {
    console.error('Failed to start server:', err);
  }

  const win = createMainWindow();
  win.loadURL(`http://127.0.0.1:${getPort()}`);

  createTray();
});

app.on('window-all-closed', () => {
  // Don't quit; we have tray
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (nextProcess) {
    nextProcess.kill();
    nextProcess = null;
  }
});
