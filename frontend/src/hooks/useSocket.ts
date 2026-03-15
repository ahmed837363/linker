'use client';

import { useEffect, useRef, useCallback } from 'react';
import { getSocket, connectSocket, disconnectSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth.store';
import type { Socket } from 'socket.io-client';

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const { tokens } = useAuthStore();

  useEffect(() => {
    if (tokens?.accessToken) {
      socketRef.current = connectSocket(tokens.accessToken);
    }

    return () => {
      disconnectSocket();
      socketRef.current = null;
    };
  }, [tokens?.accessToken]);

  const on = useCallback(
    <T = unknown>(event: string, handler: (data: T) => void) => {
      const socket = getSocket();
      socket.on(event, handler);
      return () => {
        socket.off(event, handler);
      };
    },
    []
  );

  const emit = useCallback(
    <T = unknown>(event: string, data?: T) => {
      const socket = getSocket();
      socket.emit(event, data);
    },
    []
  );

  return { socket: socketRef.current, on, emit };
}
