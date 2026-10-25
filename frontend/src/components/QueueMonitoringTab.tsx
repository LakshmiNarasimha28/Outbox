import React, { useState, useEffect, useCallback } from 'react';
import type { QueueTelemetryResponse } from '../types/email';
import { api } from '../services/api';

interface QueueMonitoringTabProps {
  onScheduleNewClick?: () => void;
}

export const QueueMonitoringTab: React.FC<QueueMonitoringTabProps> = () => {
  const [stats, setStats] = useState<QueueTelemetryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getQueueStats();
      setStats(res);
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to query BullMQ queue stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Poll every 10 seconds for live updates
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const counts = stats?.counts || {
    waiting: 0,
    active: 0,
    delayed: 0,
    completed: 0,
    failed: 0,
    paused: 0,
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="border border-slate-800 bg-slate-900/40 backdrop-blur-sm p-6 sm:p-7 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-inner">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
              />
            </svg>
          </div>
          <div>
            <div className="flex items-center space-x-2.5">
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Live Queue Monitoring</h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                  stats?.available
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                }`}
              >
                {stats?.available ? 'BULLMQ ONLINE' : 'QUEUE OFFLINE'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Real-time job queue observability backed by BullMQ & hosted Redis cluster (<code className="text-indigo-400 font-mono">email-jobs</code>)
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3 self-start sm:self-auto">
          {lastRefreshed && (
            <span className="text-xs text-slate-500 hidden md:inline font-mono">
              Updated: {lastRefreshed}
            </span>
          )}

          <button
            type="button"
            onClick={fetchStats}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center space-x-1.5 disabled:opacity-50"
          >
            <svg
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>

          <a
            href="/admin/queues"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-lg shadow-indigo-600/30 flex items-center space-x-2"
          >
            <span>Open Full Dashboard</span>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div className="border border-rose-500/30 bg-rose-950/20 rounded-xl p-4 flex items-center space-x-3 text-xs text-rose-300">
          <svg className="w-5 h-5 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-semibold text-rose-200">Queue telemetry notice: {error}</p>
            <p className="text-rose-300/80 mt-0.5">Ensure Redis is reachable via <code className="bg-rose-900/40 px-1 py-0.5 rounded font-mono">npm run verify:connections</code>.</p>
          </div>
        </div>
      )}

      {/* Live KPI Metric Cards */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-semibold text-slate-300">BullMQ Redis Queue Metrics</span>
          <span className="text-[11px] font-mono text-slate-500">Live counts from Redis getJobCounts()</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 w-full">
          {/* Waiting */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-1 shadow-sm min-w-0">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider truncate">Waiting</span>
              <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
            </div>
            <p className="text-2xl font-extrabold text-white font-mono">{counts.waiting}</p>
            <p className="text-[10px] text-slate-500 truncate">Ready for worker pickup</p>
          </div>

          {/* Active */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-1 shadow-sm min-w-0">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider truncate">Active</span>
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            </div>
            <p className="text-2xl font-extrabold text-white font-mono">{counts.active}</p>
            <p className="text-[10px] text-slate-500 truncate">Processing by worker</p>
          </div>

          {/* Delayed */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-1 shadow-sm min-w-0">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider truncate">Delayed</span>
              <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
            </div>
            <p className="text-2xl font-extrabold text-indigo-400 font-mono">{counts.delayed}</p>
            <p className="text-[10px] text-slate-500 truncate">Waiting for scheduled time</p>
          </div>

          {/* Completed */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-1 shadow-sm min-w-0">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider truncate">Completed</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            </div>
            <p className="text-2xl font-extrabold text-emerald-400 font-mono">{counts.completed}</p>
            <p className="text-[10px] text-slate-500 truncate">Retained in Redis storage</p>
          </div>

          {/* Failed */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-1 shadow-sm col-span-2 sm:col-span-1 min-w-0">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider truncate">Failed</span>
              <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
            </div>
            <p className="text-2xl font-extrabold text-rose-400 font-mono">{counts.failed}</p>
            <p className="text-[10px] text-slate-500 truncate">Exhausted max retries</p>
          </div>
        </div>
      </div>

      {/* Embedded Live Bull Board Interface */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur-sm overflow-hidden shadow-2xl">
        <div className="bg-slate-950/80 px-5 py-3 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-xs font-semibold text-slate-200">Embedded Bull Board Dashboard</span>
            <span className="text-[10px] text-slate-500 font-mono">(/admin/queues/)</span>
          </div>

          <div className="flex items-center space-x-3 text-[11px] text-slate-400">
            <span className="hidden sm:inline">Protected Read-Only Mode</span>
            <a
              href="/admin/queues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 font-semibold flex items-center space-x-1"
            >
              <span>Open in New Tab</span>
              <span>↗</span>
            </a>
          </div>
        </div>

        {/* Iframe with adjusted height and explicit trailing slash to load Bull Board dashboard */}
        <div className="relative w-full h-[780px] lg:h-[840px] bg-slate-950 overflow-hidden">
          <iframe
            src="/admin/queues/"
            title="BullMQ Queue Dashboard"
            className="w-full h-full border-0 block"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        </div>
      </div>

      {/* Operational Guarantees Card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 space-y-3 text-xs text-slate-400">
        <h4 className="font-bold text-slate-200 text-xs font-mono uppercase tracking-wider">
          Queue Security & Architecture Details
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-300">
          <div className="flex items-start space-x-2">
            <span className="text-indigo-400 font-bold">•</span>
            <span>
              <strong>Read-Only Guard:</strong> Destructive operations (queue purging, obliterating) are disabled to protect in-flight scheduled email delivery.
            </span>
          </div>
          <div className="flex items-start space-x-2">
            <span className="text-indigo-400 font-bold">•</span>
            <span>
              <strong>Zero Secret Leakage:</strong> Email bodies are stored strictly in MySQL; BullMQ jobs contain only ID pointers, recipient, subject, and sender.
            </span>
          </div>
          <div className="flex items-start space-x-2">
            <span className="text-indigo-400 font-bold">•</span>
            <span>
              <strong>Deterministic Job IDs:</strong> Each delayed email maps 1-to-1 to <code className="text-indigo-300 font-mono">email-job-{'{uuid}'}</code> preventing duplicates.
            </span>
          </div>
          <div className="flex items-start space-x-2">
            <span className="text-indigo-400 font-bold">•</span>
            <span>
              <strong>Session Auth Enforced:</strong> Unauthenticated users cannot access <code className="text-indigo-300 font-mono">/admin/queues</code> when authentication is active.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
