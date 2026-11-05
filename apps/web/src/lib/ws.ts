import type { ClientMsg, ServerMsg } from '@nexo/shared';
import { getToken } from './api';

type Listener = (m: ServerMsg) => void;

/** Conexão WebSocket única com o runtime, com reconexão automática. */
class RuntimeSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: boolean) => void>();
  private queue: string[] = [];
  private retry = 0;
  private timer: number | undefined;
  private wanted = false;
  connected = false;

  connect() {
    this.wanted = true;
    if (this.ws && this.ws.readyState <= 1) return;
    const token = getToken();
    if (!token) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      for (const l of this.listeners) l(m);
    };
    ws.onclose = () => {
      this.setConnected(false);
      if (!this.wanted) return;
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.connect(), Math.min(5000, 300 * 2 ** this.retry++));
    };
  }

  disconnect() {
    this.wanted = false;
    this.ws?.close();
  }

  private setConnected(v: boolean) {
    this.connected = v;
    for (const l of this.statusListeners) l(v);
  }

  send(m: ClientMsg) {
    const s = JSON.stringify(m);
    if (this.ws?.readyState === 1) this.ws.send(s);
    else if (m.t !== 'input' && m.t !== 'resize') this.queue.push(s);
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  onStatus(l: (s: boolean) => void) {
    this.statusListeners.add(l);
    return () => void this.statusListeners.delete(l);
  }
}

export const socket = new RuntimeSocket();
