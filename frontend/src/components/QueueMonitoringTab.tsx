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
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header Banner */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2.5">
            <h2 className="text-lg font-bold text-gray-900 tracking-tight">Queue Monitoring</h2>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                stats?.available
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              {stats?.available ? 'BULLMQ ONLINE' : 'QUEUE OFFLINE'}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Real-time BullMQ job queue observability backed by Redis cluster (<code className="font-mono text-gray-700">email-jobs</code>)
          </p>
        </div>

        <div className="flex items-center space-x-2.5 self-start sm:self-auto">
          {lastRefreshed && (
            <span className="text-xs text-gray-400 hidden md:inline font-mono">
              Updated: {lastRefreshed}
            </span>
          )}

          <button
            type="button"
            onClick={fetchStats}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
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
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition flex items-center space-x-1.5 cursor-pointer shadow-xs"
          >
            <span>Full Dashboard</span>
            <span>↗</span>
          </a>
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 flex items-center space-x-3 text-xs text-rose-800 shadow-xs">
          <svg className="w-5 h-5 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-semibold text-rose-900">Queue telemetry notice: {error}</p>
            <p className="text-rose-700 mt-0.5">Ensure Redis is reachable via <code className="bg-rose-100 px-1 py-0.5 rounded font-mono">npm run verify:connections</code>.</p>
          </div>
        </div>
      )}

      {/* Live KPI Metric Cards */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="font-semibold text-gray-700">BullMQ Redis Queue Metrics</span>
          <span className="text-[11px] font-mono text-gray-400">Live counts from Redis getJobCounts()</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 w-full">
          {/* Waiting */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-1 shadow-xs">
            <div className="flex items-center justify-between text-gray-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Waiting</span>
              <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
            </div>
            <p className="text-2xl font-bold text-gray-900 font-mono">{counts.waiting}</p>
            <p className="text-[11px] text-gray-400">Ready for pickup</p>
          </div>

          {/* Active */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-1 shadow-xs">
            <div className="flex items-center justify-between text-gray-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Active</span>
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
            </div>
            <p className="text-2xl font-bold text-amber-600 font-mono">{counts.active}</p>
            <p className="text-[11px] text-gray-400">Processing now</p>
          </div>

          {/* Delayed */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-1 shadow-xs">
            <div className="flex items-center justify-between text-gray-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Delayed</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            </div>
            <p className="text-2xl font-bold text-emerald-600 font-mono">{counts.delayed}</p>
            <p className="text-[11px] text-gray-400">Future scheduled jobs</p>
          </div>

          {/* Completed */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-1 shadow-xs">
            <div className="flex items-center justify-between text-gray-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Completed</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            </div>
            <p className="text-2xl font-bold text-gray-800 font-mono">{counts.completed}</p>
            <p className="text-[11px] text-gray-400">Retained in storage</p>
          </div>

          {/* Failed */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-1 shadow-xs col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-gray-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Failed</span>
              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
            </div>
            <p className="text-2xl font-bold text-rose-600 font-mono">{counts.failed}</p>
            <p className="text-[11px] text-gray-400">Exhausted retries</p>
          </div>
        </div>
      </div>

      {/* Embedded Live Bull Board Interface */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-xs">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-semibold text-gray-800">Embedded Bull Board</span>
            <span className="text-[10px] text-gray-400 font-mono">(/admin/queues/)</span>
          </div>

          <div className="flex items-center space-x-2 text-[11px] text-gray-500">
            <span className="hidden sm:inline">Read-Only Guard</span>
            <a
              href="/admin/queues/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 hover:text-emerald-800 font-semibold"
            >
              Open in New Tab ↗
            </a>
          </div>
        </div>

        {/* Iframe to Bull Board */}
        <div className="relative w-full h-[700px] bg-white overflow-hidden">
          <iframe
            src="/admin/queues/"
            title="BullMQ Queue Dashboard"
            className="w-full h-full border-0 block"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        </div>
      </div>
    </div>
  );
};
