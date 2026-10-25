import { useState, useEffect, useCallback } from 'react';
import { api } from './services/api';
import type { HealthResponse, AuthUser, SlackStatusResponse } from './types/email';
import { Navbar } from './components/Navbar';
import { ScheduleEmailTab } from './components/ScheduleEmailTab';
import { ScheduledJobsTab } from './components/ScheduledJobsTab';
import { DeliveryHistoryTab } from './components/DeliveryHistoryTab';
import { SystemHealthTab } from './components/SystemHealthTab';
import { SlackIntegrationCard } from './components/SlackIntegrationCard';

export default function App() {
  const [activeTab, setActiveTab] = useState<'schedule' | 'scheduled' | 'history' | 'alerts' | 'health'>('schedule');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [scheduledCount, setScheduledCount] = useState<number>(0);

  // Authentication State
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Slack Integration State
  const [slackStatus, setSlackStatus] = useState<SlackStatusResponse | null>(null);
  const [slackLoading, setSlackLoading] = useState(false);
  const [slackBanner, setSlackBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const data = await api.getHealth();
      setHealth(data);
      setLastChecked(new Date().toLocaleTimeString());
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : 'Failed to reach backend service');
      setHealth(null);
      setLastChecked(new Date().toLocaleTimeString());
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const updateScheduledCount = useCallback(async () => {
    try {
      const res = await api.getScheduledEmails(1, 0);
      setScheduledCount(res.total);
    } catch {
      // Ignore background counter errors
    }
  }, []);

  const fetchSlackStatus = useCallback(async () => {
    setSlackLoading(true);
    try {
      const res = await api.getSlackStatus();
      setSlackStatus(res);
    } catch {
      setSlackStatus(null);
    } finally {
      setSlackLoading(false);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      // Check query params for Google & Slack OAuth redirect errors or success notices
      const urlParams = new URLSearchParams(window.location.search);
      const urlError = urlParams.get('auth_error');
      const slackError = urlParams.get('slack_error');
      const slackSuccess = urlParams.get('slack_auth');

      if (urlError) {
        setAuthError(decodeURIComponent(urlError));
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (urlParams.get('auth_success')) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      if (slackError) {
        setSlackBanner({ type: 'error', message: decodeURIComponent(slackError) });
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (slackSuccess) {
        setSlackBanner({
          type: 'success',
          message: 'Slack workspace connected successfully! Rate-limit alerts are active.',
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      const res = await api.getMe();
      if (res.authenticated && res.user) {
        setUser(res.user);
        setAuthError(null);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
    fetchHealth();
    fetchSlackStatus();
    updateScheduledCount();
  }, [checkAuth, fetchHealth, fetchSlackStatus, updateScheduledCount]);

  const handleLogin = () => {
    api.loginWithGoogle();
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err) {
      console.warn('Logout notice:', err);
    } finally {
      setUser(null);
      setScheduledCount(0);
    }
  };

  const isOAuthEnforced = Boolean(health?.services.googleAuth?.configured);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased selection:bg-indigo-500 selection:text-white">
      {/* Top Header & Navigation */}
      <Navbar
        health={health}
        healthLoading={healthLoading}
        onRefreshHealth={fetchHealth}
        activeTab={activeTab}
        setActiveTab={(tab) => setActiveTab(tab as typeof activeTab)}
        scheduledCount={scheduledCount}
        user={user}
        authLoading={authLoading}
        onLogin={handleLogin}
        onLogout={handleLogout}
      />

      {/* Main Dashboard Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Authentication Notice / Error Banner */}
        {authError && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center justify-between shadow-lg">
            <div className="flex items-center space-x-3">
              <svg className="w-5 h-5 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{authError}</span>
            </div>
            <button
              onClick={() => setAuthError(null)}
              className="text-xs text-rose-400 hover:text-white underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Slack OAuth Banner */}
        {slackBanner && (
          <div
            className={`mb-6 p-4 rounded-xl text-sm flex items-center justify-between shadow-lg border ${
              slackBanner.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
            }`}
          >
            <div className="flex items-center space-x-3">
              <span className="text-base">{slackBanner.type === 'success' ? '🚀' : '⚠️'}</span>
              <span>{slackBanner.message}</span>
            </div>
            <button
              onClick={() => setSlackBanner(null)}
              className="text-xs opacity-75 hover:opacity-100 underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Dashboard Access Protection: If OAuth is configured and user is unauthenticated, show Lock Screen */}
        {activeTab !== 'health' && activeTab !== 'alerts' && isOAuthEnforced && !user && !authLoading ? (
          <div className="max-w-md mx-auto my-12 p-8 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl text-center backdrop-blur-xl">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4 shadow-lg shadow-indigo-500/10">
              <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Authentication Required</h2>
            <p className="text-sm text-slate-400 mb-6">
              Sign in with your verified Google account to schedule emails, inspect active BullMQ delayed queues, and track Ethereal SMTP delivery.
            </p>
            <button
              onClick={handleLogin}
              className="w-full flex items-center justify-center space-x-3 px-4 py-3 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-sm shadow-lg shadow-white/10 hover:shadow-white/20 transition-all cursor-pointer active:scale-95"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>
        ) : (
          <>
            {activeTab === 'schedule' && (
              <ScheduleEmailTab
                onSuccessScheduled={() => {
                  updateScheduledCount();
                }}
                onNavigateToScheduled={() => setActiveTab('scheduled')}
              />
            )}

            {activeTab === 'scheduled' && (
              <ScheduledJobsTab
                onScheduleNewClick={() => setActiveTab('schedule')}
                onCountUpdate={(count) => setScheduledCount(count)}
              />
            )}

            {activeTab === 'history' && <DeliveryHistoryTab />}

            {activeTab === 'alerts' && (
              <div className="max-w-4xl mx-auto space-y-6">
                <SlackIntegrationCard
                  slackStatus={slackStatus}
                  loading={slackLoading}
                  onRefresh={fetchSlackStatus}
                />
              </div>
            )}
          </>
        )}

        {activeTab === 'health' && (
          <SystemHealthTab
            health={health}
            loading={healthLoading}
            error={healthError}
            onRefresh={fetchHealth}
            lastChecked={lastChecked}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Outbox Labs Hiring Assignment &bull; Full-Stack Email Job Scheduler</span>
          <span className="font-mono text-[11px] text-slate-600">
            Node.js 24 &bull; React 19 &bull; Google OAuth 2.0 &bull; BullMQ &bull; MySQL &bull; Elasticsearch
          </span>
        </div>
      </footer>
    </div>
  );
}
