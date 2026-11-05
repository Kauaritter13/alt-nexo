/**
 * ALt.nexo Desktop — processo principal do Electron.
 *
 * O runtime local (o mesmo do modo navegador) roda dentro deste processo, ouvindo apenas em
 * 127.0.0.1 numa porta aleatória e com um token gerado a cada execução. A janela carrega a mesma
 * interface web servida pelo runtime; o preload expõe só operações nativas pontuais (diálogos,
 * abrir arquivos/links) — nunca acesso direto ao Node.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Modo hook: o Claude Code executa `Nexo.exe --nexo-hook` quando não há `node` no PATH.
if (process.argv.includes('--nexo-hook')) {
  require(path.join(__dirname, 'hook.cjs'));
} else {
  void main();
}

async function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  // Import tardio: o runtime não é carregado no modo hook.
  const { startRuntime } = await import('../../runtime/src/server');
  const { resolveDataDir } = await import('../../runtime/src/config');
  // Mesmo diretório de dados do modo navegador (%APPDATA%\ALt.nexo): projetos aparecem nos dois.
  const dataDir = resolveDataDir();
  type Runtime = Awaited<ReturnType<typeof startRuntime>>;

  let rt: Runtime | null = null;
  let win: BrowserWindow | null = null;
  const token = randomBytes(32).toString('base64url');

  const webDir = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', '..', 'web', 'dist');

  function hookCommand(): string {
    const q = (p: string) => `"${p.replace(/\\/g, '/')}"`;
    try {
      const out = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['node'], { encoding: 'utf8', windowsHide: true });
      const nodePath = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (nodePath) return `${q(nodePath)} ${q(path.join(dataDir, 'hooks', 'hook.cjs'))}`;
    } catch {
      /* sem node no PATH */
    }
    return `${q(process.execPath)}${app.isPackaged ? '' : ` ${q(path.join(__dirname, 'main.cjs'))}`} --nexo-hook`;
  }

  async function createWindow() {
    win = new BrowserWindow({
      width: 1500,
      height: 920,
      minWidth: 960,
      minHeight: 600,
      backgroundColor: '#0c0d0b',
      title: 'ALt.nexo',
      icon: fs.existsSync(path.join(__dirname, 'icon.png')) ? path.join(__dirname, 'icon.png') : undefined,
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        spellcheck: false,
      },
    });
    win.once('ready-to-show', () => win?.show());

    // A janela só navega dentro do runtime local; links externos abrem no navegador padrão.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (rt && !url.startsWith(rt.url)) {
        e.preventDefault();
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      }
    });
    // <webview> (nós de site): sem preload, sem Node, sempre isolado.
    win.webContents.on('will-attach-webview', (_e, prefs, params) => {
      delete (prefs as any).preload;
      prefs.nodeIntegration = false;
      prefs.contextIsolation = true;
      prefs.sandbox = true;
      if (!/^https?:\/\//.test(params.src)) _e.preventDefault();
    });
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools();
    });

    await win.loadURL(`${rt!.url}/?token=${token}`);
  }

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // ───────── IPC: operações nativas ─────────
  ipcMain.handle('nexo:pick-folder', async (_e, defaultPath?: string) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], defaultPath });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('nexo:pick-file', async (_e, defaultPath?: string) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], defaultPath });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('nexo:open-path', (_e, p: string) => shell.openPath(String(p)));
  ipcMain.on('nexo:show-item', (_e, p: string) => shell.showItemInFolder(String(p)));
  ipcMain.handle('nexo:open-external', (_e, url: string) => {
    if (/^https?:\/\//.test(String(url))) return shell.openExternal(String(url));
  });

  await app.whenReady();
  Menu.setApplicationMenu(null);

  try {
    rt = await startRuntime({
      port: 0,
      token,
      desktop: true,
      staticDir: webDir,
      dataDir,
      hookCommand: hookCommand(),
      // Servidor MCP de equipe: roda no próprio Electron como Node (não depende de node no PATH).
      nodeRuntime: { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } },
      log: (m) => console.log(m),
    });
  } catch (e) {
    dialog.showErrorBox('ALt.nexo', `Falha ao iniciar o runtime local:\n${(e as Error).message}`);
    app.exit(1);
    return;
  }
  await createWindow();

  app.on('window-all-closed', () => app.quit());

  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting || !rt) return;
    e.preventDefault();
    quitting = true;
    // Encerra processos (sessões ficam marcadas como paradas e retomáveis) e fecha o banco.
    rt.close().finally(() => app.exit(0));
  });
}
