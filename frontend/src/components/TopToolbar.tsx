import React from 'react';
import type { HealthResponse, AuthUser } from '../types/email';

interface TopToolbarProps {
  activeTab: string;
  onOpenMobileMenu: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  health: HealthResponse | null;
  healthLoading: boolean;
  onRefreshHealth: () => void;
  user: AuthUser | null;
  onLogin: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  activeTab,
  onOpenMobileMenu,
  searchQuery,
  onSearchChange,
  health,
  healthLoading,
  onRefreshHealth,
  user,
  onLogin,
}) => {
  const isHealthy = health?.status === 'ok';

  const tabTitles: Record<string, string> = {
    schedule: 'Compose Email',
    scheduled: 'Scheduled Jobs',
    history: 'Delivery History',
    queue: 'Queue Monitor',
    health: 'System Health',
    alerts: 'Slack Alerts',
  };

  const currentTitle = tabTitles[activeTab] || 'Dashboard';

  return (
    <header className="h-16 bg-white border-b border-gray-200 sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6">
      {/* Left: Hamburger & View Title */}
      <div className="flex items-center space-x-3">
        <button
          onClick={onOpenMobileMenu}
          className="md:hidden p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer"
          aria-label="Open navigation menu"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div>
          <h1 className="text-base font-bold text-gray-900 tracking-tight leading-tight">
            {currentTitle}
          </h1>
          <p className="text-[11px] text-gray-400 hidden sm:block leading-tight">
            Outbox Distributed Scheduler
          </p>
        </div>
      </div>

      {/* Center / Search Bar */}
      <div className="flex-1 max-w-md mx-4 hidden sm:block">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search emails, recipients, subjects..."
            className="w-full pl-9 pr-7 py-1.5 text-xs rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:border-emerald-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-gray-400 hover:text-gray-600 cursor-pointer text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center space-x-2.5">
        {/* Backend Connectivity Status Pill */}
        <button
          onClick={onRefreshHealth}
          disabled={healthLoading}
          title="Click to check backend connectivity"
          className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer text-xs"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              healthLoading
                ? 'bg-blue-500 animate-ping'
                : isHealthy
                ? 'bg-emerald-500'
                : 'bg-amber-500'
            }`}
          />
          <span className="text-[11px] font-medium text-gray-600 hidden sm:inline">
            {healthLoading ? 'Probing...' : isHealthy ? 'Backend Live' : 'Backend Degraded'}
          </span>
        </button>

        {/* Small Screen Sign-in if unauthenticated */}
        {!user && (
          <button
            onClick={onLogin}
            className="sm:hidden px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white cursor-pointer"
          >
            Sign in
          </button>
        )}
      </div>
    </header>
  );
};
