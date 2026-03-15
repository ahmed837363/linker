import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3000';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

    socket = io(SOCKET_URL, {
      autoConnect: false,
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket?.id);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });

    socket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error.message);
    });
  }

  return socket;
}

export function connectSocket(token: string): Socket {
  const s = getSocket();
  s.auth = { token };
  if (!s.connected) {
    s.connect();
  }
  return s;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// Typed event helper
export function onSocketEvent<T = unknown>(
  event: string,
  handler: (data: T) => void
): () => void {
  const s = getSocket();
  s.on(event, handler);
  return () => {
    s.off(event, handler);
  };
}

// Common events
export const SocketEvents = {
  // Inventory
  INVENTORY_UPDATE: 'inventory:update',
  STOCK_ALERT: 'inventory:alert',

  // Orders
  NEW_ORDER: 'orders:new',
  ORDER_UPDATE: 'orders:update',

  // Sync
  SYNC_START: 'sync:start',
  SYNC_PROGRESS: 'sync:progress',
  SYNC_COMPLETE: 'sync:complete',
  SYNC_ERROR: 'sync:error',

  // Onboarding
  MATCH_READY: 'onboarding:match-ready',

  // Notifications
  NOTIFICATION: 'notification',
} as const;
