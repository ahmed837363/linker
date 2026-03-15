'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { formatRelativeDate, cn } from '@/lib/utils';
import { useNotificationStore, Notification } from '@/stores/notification.store';
import {
  Bell,
  CheckCircle,
  AlertTriangle,
  Info,
  XCircle,
  Check,
} from 'lucide-react';

const iconMap: Record<Notification['type'], React.ElementType> = {
  success: CheckCircle,
  warning: AlertTriangle,
  info: Info,
  error: XCircle,
};

const colorMap: Record<Notification['type'], string> = {
  success: 'text-green-400',
  warning: 'text-yellow-400',
  info: 'text-blue-400',
  error: 'text-red-400',
};

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { notifications, unreadCount, markRead, markAllRead, clearAll } =
    useNotificationStore();

  function handleClick(n: Notification) {
    markRead(n.id);
    if (n.link) {
      router.push(n.link);
      onClose();
    }
  }

  return (
    <div className="absolute right-0 top-full mt-2 w-96 bg-dashboard-card border border-dashboard-border rounded-xl shadow-2xl overflow-hidden z-50">
      <div className="px-4 py-3 border-b border-dashboard-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          Notifications {unreadCount > 0 && `(${unreadCount})`}
        </h3>
        {notifications.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              onClick={markAllRead}
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              Mark all read
            </button>
            <button
              onClick={clearAll}
              className="text-xs text-dashboard-muted hover:text-white transition-colors"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto scrollbar-thin">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-dashboard-muted">
            <Bell className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">No notifications yet</p>
          </div>
        ) : (
          notifications.map((n) => {
            const Icon = iconMap[n.type];
            return (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  'w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-dashboard-hover/50 transition-colors border-b border-dashboard-border last:border-b-0',
                  !n.read && 'bg-primary/5'
                )}
              >
                <Icon className={cn('w-5 h-5 mt-0.5 shrink-0', colorMap[n.type])} />
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm', n.read ? 'text-dashboard-text' : 'text-white font-medium')}>
                    {n.title}
                  </p>
                  <p className="text-xs text-dashboard-muted line-clamp-2">{n.message}</p>
                  <p className="text-[10px] text-dashboard-muted mt-1">
                    {formatRelativeDate(n.timestamp)}
                  </p>
                </div>
                {!n.read && (
                  <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
