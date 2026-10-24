import { useState, useEffect, useCallback } from 'react';
import { api } from './services/api';
import type { HealthResponse } from './types/email';
import { Navbar } from './components/Navbar';
import { ScheduleEmailTab } from './components/ScheduleEmailTab';
import { ScheduledJobsTab } from './components/ScheduledJobsTab';
import { DeliveryHistoryTab } from './components/DeliveryHistoryTab';
import { SystemHealthTab } from './components/SystemHealthTab';

export default function App() {
  const [activeTab, setActiveTab] = useState<'schedule' | 'scheduled' | 'history' | 'health'>('schedule');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [scheduledCount, setScheduledCount] = useState<number>(0);

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

  useEffect(() => {
    fetchHealth();
    updateScheduledCount();
  }, [fetchHealth, updateScheduledCount]);

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
      />

      {/* Main Dashboard Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
            Node.js 24 &bull; React 19 &bull; Vite &bull; Tailwind v4 &bull; BullMQ &bull; MySQL
          </span>
        </div>
      </footer>
    </div>
  );
}
