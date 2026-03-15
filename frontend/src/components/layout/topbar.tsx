'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Bell, ChevronDown, LogOut, User, Settings, Download } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useNotificationStore } from '@/stores/notification.store';
import { NotificationPanel } from '@/components/layout/notification-panel';
import { SearchResults } from '@/components/layout/search-results';

export function Topbar() {
  const router = useRouter();
  const { user, tenant, logout } = useAuthStore();
  const { unreadCount } = useNotificationStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    function handleBeforeInstall(e: Event) {
      e.preventDefault();
      setInstallPrompt(e);
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  }

  function handleLogout() {
    logout();
    router.push('/login');
  }

  const initials = user?.fullName
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'LP';

  return (
    <header className="h-16 bg-dashboard-card/80 backdrop-blur-xl border-b border-dashboard-border flex items-center justify-between px-6 sticky top-0 z-30">
      {/* Left: Tenant name & search */}
      <div className="flex items-center gap-6">
        <h2 className="text-sm font-semibold text-white hidden md:block">
          {tenant?.name || 'Linker Pro'}
        </h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dashboard-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            placeholder="Search products, orders, pages..."
            className="w-64 lg:w-80 input-base pl-10 py-1.5 text-sm bg-dashboard-dark/50"
          />
          {searchFocused && (
            <SearchResults
              query={searchQuery}
              onClose={() => {
                setSearchFocused(false);
                setSearchQuery('');
              }}
            />
          )}
        </div>
      </div>

      {/* Right: install, notifications & user */}
      <div className="flex items-center gap-3">
        {/* PWA Install */}
        {installPrompt && (
          <button
            onClick={handleInstall}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm"
          >
            <Download className="w-4 h-4" />
            <span className="hidden md:inline">Install App</span>
          </button>
        )}

        {/* Notification bell */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-lg text-dashboard-muted hover:text-white hover:bg-dashboard-hover transition-colors"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <NotificationPanel onClose={() => setShowNotifications(false)} />
          )}
        </div>

        {/* User menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-dashboard-hover transition-colors"
          >
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center text-xs font-bold text-white">
              {initials}
            </div>
            <span className="text-sm font-medium text-dashboard-text hidden md:block max-w-[120px] truncate">
              {user?.fullName || 'User'}
            </span>
            <ChevronDown className="w-4 h-4 text-dashboard-muted hidden md:block" />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-dashboard-card border border-dashboard-border rounded-xl shadow-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-dashboard-border">
                <p className="text-sm font-medium text-white truncate">
                  {user?.fullName}
                </p>
                <p className="text-xs text-dashboard-muted truncate">
                  {user?.email}
                </p>
              </div>
              <div className="py-1">
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    router.push('/settings');
                  }}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-dashboard-text hover:bg-dashboard-hover transition-colors"
                >
                  <User className="w-4 h-4" />
                  Profile
                </button>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    router.push('/settings');
                  }}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-dashboard-text hover:bg-dashboard-hover transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </button>
                <div className="border-t border-dashboard-border my-1" />
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-400 hover:bg-dashboard-hover transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
