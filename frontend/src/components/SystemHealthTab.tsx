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
  const isHealthy = health?.status === 'ok';
  const hasHealthData = Boolean(health);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header Card */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">System Health & Telemetry</h2>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                isHealthy
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}
            >
              {isHealthy ? 'All Systems Operational' : 'Degraded Connectivity'}
            </span>
          </div>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">
            Diagnostic probe querying live backend REST endpoint <code className="text-emerald-700 bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">/health</code>
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {lastChecked && (
            <span className="text-xs text-gray-400 hidden sm:inline">
              Checked: {lastChecked}
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="px-3.5 py-2 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
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
        <div className="border border-rose-200 bg-rose-50 rounded-xl p-4 flex items-start space-x-3 text-xs text-rose-800">
          <svg className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="font-semibold text-rose-900">Backend probe status: {error}</p>
            <p className="text-rose-700 mt-0.5">
              Ensure the backend service is deployed and reachable, or running locally on port 5000 via <code className="bg-rose-100 px-1 py-0.5 rounded font-mono">npm run dev:backend</code>.
            </p>
          </div>
        </div>
      )}

      {/* Subsystem Cards */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Core Infrastructure</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Express API */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Express API</span>
              {health?.services.server.status === 'healthy' ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  HEALTHY
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
                  {hasHealthData ? 'UNHEALTHY' : 'UNREACHABLE'}
                </span>
              )}
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-gray-500">
                <span>Port:</span>
                <span className="font-mono text-gray-800">{health?.services.server.port ?? '—'}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Node Runtime:</span>
                <span className="font-mono text-gray-800">{health?.services.server.nodeVersion ?? '—'}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Process Uptime:</span>
                <span className="font-mono text-gray-800">{health ? `${health.uptimeSeconds}s` : '—'}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Environment:</span>
                <span className="font-mono text-gray-800 capitalize">{health?.environment ?? '—'}</span>
              </div>
            </div>
          </div>

          {/* MySQL Database */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">MySQL Database</span>
              {health?.services.database.connected ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  CONNECTED
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  DISCONNECTED
                </span>
              )}
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-gray-500">
                <span>Account:</span>
                <span className="font-mono text-gray-800">{health?.services.database.user ?? '—'}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Database:</span>
                <span className="font-mono text-gray-800">{health?.services.database.database ?? '—'}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Ping Latency:</span>
                <span className="font-mono text-emerald-600 font-medium">
                  {health?.services.database.latencyMs !== undefined ? `${health.services.database.latencyMs}ms` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Driver:</span>
                <span className="font-mono text-gray-800">mysql2/promise</span>
              </div>
            </div>
          </div>

          {/* Hosted Redis / BullMQ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Redis & BullMQ</span>
              {health?.services.redis.connected ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  CONNECTED
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  DISCONNECTED
                </span>
              )}
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-gray-500">
                <span>Engine:</span>
                <span className="font-mono text-gray-800">BullMQ + ioredis</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Endpoint:</span>
                <span className="font-mono text-gray-800 truncate max-w-[140px]" title={health?.services.redis.endpoint}>
                  {health?.services.redis.endpoint || (hasHealthData ? 'rediss://***' : '—')}
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Ping Latency:</span>
                <span className="font-mono text-emerald-600 font-medium">
                  {health?.services.redis.latencyMs !== undefined ? `${health.services.redis.latencyMs}ms` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Security:</span>
                <span className="font-mono text-gray-800">TLS Enabled</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Optional Integrations */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Optional Integrations</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Google OAuth 2.0 */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Google OAuth 2.0</span>
              {health?.services.googleAuth?.configured ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  ACTIVE
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                  NOT CONFIGURED
                </span>
              )}
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-gray-500">
                <span>Protocol:</span>
                <span className="font-mono text-gray-800">OpenID Connect</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Client Library:</span>
                <span className="font-mono text-gray-800">google-auth-library</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Session Type:</span>
                <span className="font-mono text-gray-800">HttpOnly JWT</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Callback:</span>
                <span className="font-mono text-gray-800 truncate max-w-[140px]" title={health?.services.googleAuth?.callbackUrl}>
                  {health?.services.googleAuth?.configured ? '/api/auth/google/callback' : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Slack Alerts */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Slack Webhooks</span>
              {health?.services.slack?.configured ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  ACTIVE
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                  NOT CONFIGURED
                </span>
              )}
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-gray-500">
                <span>Integration:</span>
                <span className="font-mono text-gray-800 truncate max-w-[140px]">
                  {health?.services.slack?.configured ? 'Incoming Webhook' : '—'}
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Rate-Limit Alerts:</span>
                <span className="font-mono text-gray-800">
                  {health?.services.slack?.configured ? 'Active' : 'Disabled'}
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Cooldown:</span>
                <span className="font-mono text-gray-800">
                  {health?.services.slack?.cooldownSeconds ? `${health.services.slack.cooldownSeconds}s` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Callback:</span>
                <span className="font-mono text-gray-800 truncate max-w-[140px]">
                  {health?.services.slack?.configured ? '/api/auth/slack/callback' : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Elasticsearch */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Elasticsearch</span>
              {health?.services.elasticsearch?.connected ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  CONNECTED
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                  OPTIONAL / OFFLINE
                </span>
              )}
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-gray-500">
                <span>Client:</span>
                <span className="font-mono text-gray-800">@elastic/es v9</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Endpoint:</span>
                <span className="font-mono text-gray-800 truncate max-w-[140px]" title={health?.services.elasticsearch?.endpoint}>
                  {health?.services.elasticsearch?.endpoint || '—'}
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Ping Latency:</span>
                <span className="font-mono text-emerald-600 font-medium">
                  {health?.services.elasticsearch?.latencyMs !== undefined ? `${health.services.elasticsearch.latencyMs}ms` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Index:</span>
                <span className="font-mono text-gray-800">{health?.services.elasticsearch?.index || 'email_jobs'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* System Guarantees */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-3 shadow-xs">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Architecture Guarantees & Constraints
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-700">
          <div className="flex items-center space-x-2.5">
            <span className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>Zero Cron Jobs — Pure BullMQ Delayed Jobs</span>
          </div>
          <div className="flex items-center space-x-2.5">
            <span className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>Deterministic Job IDs (<code className="font-mono text-gray-800">email-job-UUID</code>)</span>
          </div>
          <div className="flex items-center space-x-2.5">
            <span className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>MySQL Atomic Status Locks on Worker Pickup</span>
          </div>
          <div className="flex items-center space-x-2.5">
            <span className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>Ethereal SMTP with Public Inspection URLs</span>
          </div>
          <div className="flex items-center space-x-2.5">
            <span className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>Google OAuth 2.0 with HttpOnly Session Cookies</span>
          </div>
          <div className="flex items-center space-x-2.5">
            <span className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>Per-User Email Data Isolation and Deterministic Access Control</span>
          </div>
        </div>
      </div>
    </div>
  );
};
