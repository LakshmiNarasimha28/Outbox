import React from 'react';
import type { AuthUser, HealthResponse } from '../types/email';
import heroImg from '../assets/hero.png';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
  scheduledCount: number;
  user: AuthUser | null;
  authLoading: boolean;
  onLogin: () => void;
  onLogout: () => void;
  health: HealthResponse | null;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  scheduledCount,
  user,
  authLoading,
  onLogin,
  onLogout,
  health,
  isOpenMobile,
  onCloseMobile,
}) => {
  const isHealthy = health?.status === 'ok';

  const navItems = [
    {
      id: 'schedule',
      label: 'Compose',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
    },
    {
      id: 'scheduled',
      label: 'Scheduled',
      count: scheduledCount,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: 'history',
      label: 'Sent',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  const toolItems = [
    {
      id: 'queue',
      label: 'Queue Monitor',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
        </svg>
      ),
    },
    {
      id: 'health',
      label: 'System Health',
      statusDot: isHealthy ? 'bg-emerald-500' : 'bg-amber-500',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
    {
      id: 'alerts',
      label: 'Slack Alerts',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      ),
    },
  ];

  const content = (
    <div className="flex flex-col h-full bg-white border-r border-gray-200 w-64 select-none">
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-gray-100">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center p-1.5 shadow-xs">
            <img src={heroImg} alt="Outbox" className="w-full h-full object-contain filter brightness-0 invert" />
          </div>
          <div>
            <span className="font-bold text-sm tracking-tight text-gray-900 block leading-tight">
              Outbox
            </span>
            <span className="text-[10px] text-gray-400 font-medium block leading-tight">
              Email Scheduler
            </span>
          </div>
        </div>

        {/* Mobile Close Button */}
        <button
          onClick={onCloseMobile}
          className="md:hidden text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* User Section / Authentication */}
      <div className="p-3 border-b border-gray-100 bg-gray-50/50">
        {authLoading ? (
          <div className="h-9 rounded-lg bg-gray-200 animate-pulse" />
        ) : user ? (
          <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-gray-200/80 shadow-xs">
            <div className="flex items-center space-x-2 min-w-0">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-7 h-7 rounded-full object-cover shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {user.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-900 truncate leading-tight">
                  {user.name}
                </p>
                <p className="text-[10px] text-gray-500 truncate leading-tight">
                  {user.email}
                </p>
              </div>
            </div>

            <button
              onClick={onLogout}
              title="Sign out"
              className="text-gray-400 hover:text-rose-600 p-1 transition-colors cursor-pointer shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={onLogin}
            className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-lg bg-white hover:bg-gray-50 text-gray-700 text-xs font-medium border border-gray-200 shadow-xs transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            <span>Sign in with Google</span>
          </button>
        )}
      </div>

      {/* Prominent Compose Action */}
      <div className="p-3">
        <button
          onClick={() => {
            setActiveTab('schedule');
            onCloseMobile();
          }}
          className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span>Compose Email</span>
        </button>
      </div>

      {/* Primary Navigation */}
      <nav className="px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-emerald-50 text-emerald-800 font-semibold'
                  : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <span className={isActive ? 'text-emerald-700' : 'text-gray-400'}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </div>

              {item.count !== undefined && item.count > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    isActive
                      ? 'bg-emerald-200/80 text-emerald-900'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Secondary Tools & Diagnostics Navigation */}
      <div className="mt-auto px-3 pb-3 space-y-1">
        <div className="pt-3 border-t border-gray-100 mb-1">
          <span className="px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">
            Tools & Settings
          </span>
        </div>

        {toolItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-emerald-50 text-emerald-800 font-semibold'
                  : 'text-gray-500 hover:bg-gray-100/80 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <span className={isActive ? 'text-emerald-700' : 'text-gray-400'}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </div>

              {item.statusDot && (
                <span className={`w-1.5 h-1.5 rounded-full ${item.statusDot}`} />
              )}
            </button>
          );
        })}

        {/* Live Status Footer */}
        <div className="pt-2 border-t border-gray-100 flex items-center justify-between px-2 text-[10px] text-gray-400">
          <div className="flex items-center space-x-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${isHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`}
            />
            <span>{isHealthy ? 'Production Online' : 'Degraded API'}</span>
          </div>
          <span className="font-mono text-[9px] text-gray-300">v1.0</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar (Permanent) */}
      <aside className="hidden md:block shrink-0">
        <div className="sticky top-0 h-screen">
          {content}
        </div>
      </aside>

      {/* Mobile Drawer (Collapsible) */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
          />
          <div className="relative z-10">
            {content}
          </div>
        </div>
      )}
    </>
  );
};
