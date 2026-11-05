/** Ponte mínima e tipada entre a interface web e o Electron (contextIsolation + sandbox). */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('nexoDesktop', {
  isDesktop: true,
  platform: process.platform,
  pickFolder: (defaultPath?: string) => ipcRenderer.invoke('nexo:pick-folder', defaultPath),
  pickFile: (defaultPath?: string) => ipcRenderer.invoke('nexo:pick-file', defaultPath),
  openPath: (p: string) => ipcRenderer.invoke('nexo:open-path', p),
  showItemInFolder: (p: string) => ipcRenderer.send('nexo:show-item', p),
  openExternal: (url: string) => ipcRenderer.invoke('nexo:open-external', url),
});
