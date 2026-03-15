'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth.store';
import { useNotificationStore } from '@/stores/notification.store';

const SocketContext = createContext<Socket | null>(null);

export function useSocketContext() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const { tokens } = useAuthStore();
  const { addNotification } = useNotificationStore();

  useEffect(() => {
    if (!tokens?.accessToken) return;

    const socketUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3000';
    const newSocket = io(socketUrl, {
      auth: { token: tokens.accessToken },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    newSocket.on('connect', () => {
      console.log('[Socket] Connected');
    });

    newSocket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
    });

    // Listen for real-time events
    newSocket.on('inventory:low_stock', (data: { productTitle: string; sku: string; quantity: number }) => {
      addNotification({
        type: 'warning',
        title: 'Low Stock Alert',
        message: `${data.productTitle} (${data.sku}) has only ${data.quantity} units left`,
        link: '/inventory',
      });
    });

    newSocket.on('order:new', (data: { orderNumber: string; platform: string; total: number }) => {
      addNotification({
        type: 'success',
        title: 'New Order',
        message: `Order #${data.orderNumber} from ${data.platform} — $${data.total.toFixed(2)}`,
        link: '/orders',
      });
    });

    newSocket.on('sync:completed', (data: { platform: string; type: string }) => {
      addNotification({
        type: 'info',
        title: 'Sync Complete',
        message: `${data.type} sync finished for ${data.platform}`,
      });
    });

    newSocket.on('sync:error', (data: { platform: string; error: string }) => {
      addNotification({
        type: 'error',
        title: 'Sync Error',
        message: `Failed to sync with ${data.platform}: ${data.error}`,
        link: '/stores',
      });
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [tokens?.accessToken, addNotification]);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
}
