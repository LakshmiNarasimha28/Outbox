import React from 'react';
import type { HealthResponse } from '../types/email';

interface SystemHealthTabProps {
  health: HealthResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  lastChecked: string | null;
}

export const SystemHealthTab: React.FC<SystemHealthTabProps> = ({
  health,
  loading,
  error,
  onRefresh,
  lastChecked,
}) => {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="border border-slate-800 bg-slate-900/40 backdrop-blur-sm p-6 sm:p-8 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">System Health & Telemetry</h2>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                health?.status === 'ok'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              {health?.status === 'ok' ? 'All Systems Operational' : 'Degraded Connectivity'}
            </span>
          </div>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Real-time diagnostic probe querying backend REST endpoint <code className="text-indigo-400 bg-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">/health</code>
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {lastChecked && (
            <span className="text-xs text-slate-500 hidden sm:inline">
              Checked: {lastChecked}
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-md shadow-indigo-600/20 flex items-center space-x-2 disabled:opacity-50"
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
            <span>{loading ? 'Testing...' : 'Check Connection'}</span>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="border border-amber-500/30 bg-amber-950/20 rounded-xl p-4 flex items-center space-x-3 text-xs text-amber-300">
          <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-semibold text-amber-200">Backend probe status: {error}</p>
            <p className="text-amber-300/80 mt-0.5">Ensure the backend is running on port 5000 via <code className="bg-amber-900/40 px-1 py-0.5 rounded font-mono">npm run dev:backend</code>.</p>
          </div>
        </div>
      )}

      {/* Grid of Subsystems */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Express Server */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">Express API</span>
            {health?.services.server.status === 'healthy' ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                HEALTHY
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                OFFLINE
              </span>
            )}
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Port:</span>
              <span className="font-mono text-slate-200">{health?.services.server.port ?? 5000}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Node Runtime:</span>
              <span className="font-mono text-slate-200">{health?.services.server.nodeVersion ?? 'Node.js 24'}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Process Uptime:</span>
              <span className="font-mono text-slate-200">{health ? `${health.uptimeSeconds}s` : '—'}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Environment:</span>
              <span className="font-mono text-slate-200 capitalize">{health?.environment ?? 'development'}</span>
            </div>
          </div>
        </div>

        {/* MySQL Database */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">MySQL Database</span>
            {health?.services.database.connected ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                CONNECTED
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                DISCONNECTED
              </span>
            )}
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Account:</span>
              <span className="font-mono text-indigo-300">{health?.services.database.user ?? 'outbox_app'}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Database:</span>
              <span className="font-mono text-slate-200">{health?.services.database.database ?? 'outbox_scheduler'}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Ping Latency:</span>
              <span className="font-mono text-emerald-400 font-semibold">
                {health?.services.database.latencyMs !== undefined ? `${health.services.database.latencyMs}ms` : '—'}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Driver:</span>
              <span className="font-mono text-slate-200">mysql2/promise</span>
            </div>
          </div>
        </div>

        {/* Hosted Redis / BullMQ */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">Hosted Redis</span>
            {health?.services.redis.connected ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                CONNECTED
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                DISCONNECTED
              </span>
            )}
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Engine:</span>
              <span className="font-mono text-indigo-300">BullMQ + ioredis</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Endpoint:</span>
              <span className="font-mono text-slate-200 truncate max-w-[120px]" title={health?.services.redis.endpoint}>
                {health?.services.redis.endpoint || 'rediss://***'}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Ping Latency:</span>
              <span className="font-mono text-emerald-400 font-semibold">
                {health?.services.redis.latencyMs !== undefined ? `${health.services.redis.latencyMs}ms` : '—'}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Security:</span>
              <span className="font-mono text-slate-200">TLS Enabled</span>
            </div>
          </div>
        </div>

        {/* Elasticsearch Search Index */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">Elasticsearch</span>
            {health?.services.elasticsearch?.connected ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                CONNECTED
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-700/60 text-slate-400 border border-slate-600/40">
                OFFLINE
              </span>
            )}
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Client:</span>
              <span className="font-mono text-indigo-300">@elastic/es v9</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Endpoint:</span>
              <span className="font-mono text-slate-200 truncate max-w-[120px]" title={health?.services.elasticsearch?.endpoint}>
                {health?.services.elasticsearch?.endpoint || 'Not configured'}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Ping Latency:</span>
              <span className="font-mono text-emerald-400 font-semibold">
                {health?.services.elasticsearch?.latencyMs !== undefined ? `${health.services.elasticsearch.latencyMs}ms` : '—'}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Index:</span>
              <span className="font-mono text-slate-200">{health?.services.elasticsearch?.index || 'email_jobs'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Architectural Guarantee Checklist */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 sm:p-8 space-y-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
          System Guarantees & Constraints
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="flex items-center space-x-2.5 text-slate-300">
            <span className="w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>Zero Cron Jobs — Pure BullMQ Delayed Jobs</span>
          </div>
          <div className="flex items-center space-x-2.5 text-slate-300">
            <span className="w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>Deterministic Job IDs (<code className="font-mono text-indigo-300">email-job-UUID</code>)</span>
          </div>
          <div className="flex items-center space-x-2.5 text-slate-300">
            <span className="w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>MySQL Atomic Status Locks on Worker Pickup</span>
          </div>
          <div className="flex items-center space-x-2.5 text-slate-300">
            <span className="w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>Ethereal SMTP with Public Inspection URLs</span>
          </div>
        </div>
      </div>
    </div>
  );
};
