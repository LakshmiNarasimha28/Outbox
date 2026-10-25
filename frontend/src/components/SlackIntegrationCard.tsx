import React, { useState } from 'react';
import type { SlackStatusResponse } from '../types/email';
import { api } from '../services/api';

interface SlackIntegrationCardProps {
  slackStatus: SlackStatusResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

export const SlackIntegrationCard: React.FC<SlackIntegrationCardProps> = ({
  slackStatus,
  loading,
  onRefresh,
}) => {
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isConnected = Boolean(slackStatus?.connected && slackStatus?.integration?.status === 'ACTIVE');
  const isRevoked = Boolean(slackStatus?.isRevoked || slackStatus?.integration?.status === 'REVOKED');
  const isConfigured = Boolean(slackStatus?.configured);
  const integration = slackStatus?.integration;

  const handleConnect = () => {
    api.connectSlack();
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect this Slack workspace?')) return;
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await api.disconnectSlack();
      setFeedback({ type: 'success', text: res.message });
      onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Failed to disconnect Slack' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleTestNotification = async () => {
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await api.testSlackNotification();
      setFeedback({ type: 'success', text: res.message });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Failed to dispatch test notification' });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur-sm p-6 sm:p-7 space-y-5">
      {/* Card Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-[#4A154B]/30 border border-[#ECB22E]/40 flex items-center justify-center p-2 shadow-inner">
            {/* Slack SVG Icon */}
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 15a2 2 0 1 1-2-2h2v2zM7 15a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5z"
                fill="#E01E5A"
              />
              <path
                d="M9 6a2 2 0 1 1 2-2v2H9zM9 7a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5z"
                fill="#36C5F0"
              />
              <path
                d="M18 9a2 2 0 1 1 2 2h-2V9zM17 9a2 2 0 0 1-4 0V4a2 2 0 1 1 4 0v5z"
                fill="#2EB67D"
              />
              <path
                d="M15 18a2 2 0 1 1-2 2v-2h2zM15 17a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5z"
                fill="#ECB22E"
              />
            </svg>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-base font-bold text-white tracking-tight">Slack Rate-Limit Alerts</h3>
              {isConnected ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  CONNECTED
                </span>
              ) : isRevoked ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  REVOKED
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                  DISCONNECTED
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Automated channel alerts when the distributed Redis hourly limit is hit
            </p>
          </div>
        </div>

        {/* Refresh Status Button */}
        <button
          onClick={onRefresh}
          disabled={loading || actionLoading}
          className="text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-lg bg-slate-800/40 hover:bg-slate-800 border border-slate-700/60 transition flex items-center space-x-1.5 self-start sm:self-auto"
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
          <span>Refresh</span>
        </button>
      </div>

      {/* Revoked Warning Banner */}
      {isRevoked && (
        <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-950/30 text-rose-300 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center space-x-2.5">
            <span className="text-base shrink-0">⚠️</span>
            <div>
              <p className="font-semibold text-rose-200">Slack Integration Credentials Revoked</p>
              <p className="text-[11px] text-rose-300/80 mt-0.5">
                {slackStatus?.message ||
                  'The Slack incoming webhook URL or access token was revoked or returned HTTP 404. Reconnection is required to restore alerts.'}
              </p>
            </div>
          </div>
          <button
            onClick={handleConnect}
            disabled={actionLoading}
            className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#4A154B] hover:bg-[#5C1D5E] text-white transition flex-shrink-0 shadow-md cursor-pointer active:scale-95 self-start sm:self-auto"
          >
            Reconnect Workspace
          </button>
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-200 text-sm ml-3 font-bold"
          >
            &times;
          </button>
        </div>
      )}

      {/* Body Content */}
      {isConnected && integration ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 text-xs">
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">
                Slack Workspace
              </span>
              <span className="text-slate-200 font-semibold mt-0.5 block truncate">
                {integration.teamName}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">
                Alert Destination
              </span>
              <span className="text-indigo-400 font-mono mt-0.5 block truncate">
                {integration.channelName ? `#${integration.channelName}` : 'Incoming Webhook'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">
                Monitored Sender
              </span>
              <span className="text-slate-300 font-mono mt-0.5 block truncate">
                {integration.sender}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-slate-400 flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Redis deduplication active: 1 alert per cooldown window to prevent spam.</span>
            </p>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleTestNotification}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center space-x-1.5 disabled:opacity-50"
              >
                <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <span>{actionLoading ? 'Sending...' : 'Send Test Alert'}</span>
              </button>

              <button
                onClick={handleConnect}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              >
                Reconnect
              </button>

              <button
                onClick={handleDisconnect}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-slate-700/60 hover:border-rose-500/30 transition"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-2">
          <div className="space-y-1">
            <p className="text-xs text-slate-300">
              Never get surprised by email rate limit throttles. Connect your team's Slack workspace to receive automated alerts when the sender limit is reached.
            </p>
            {!isConfigured && (
              <p className="text-[11px] text-amber-400/90 font-mono">
                Notice: SLACK_CLIENT_ID & SLACK_CLIENT_SECRET are not defined in backend/.env.
              </p>
            )}
          </div>

          <button
            onClick={handleConnect}
            disabled={actionLoading}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-[#4A154B] hover:bg-[#5C1D5E] text-white transition shadow-lg shadow-[#4A154B]/30 flex items-center space-x-2 flex-shrink-0 cursor-pointer active:scale-95 disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 15a2 2 0 1 1-2-2h2v2zM7 15a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5z"
                fill="#E01E5A"
              />
              <path
                d="M9 6a2 2 0 1 1 2-2v2H9zM9 7a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5z"
                fill="#36C5F0"
              />
              <path
                d="M18 9a2 2 0 1 1 2 2h-2V9zM17 9a2 2 0 0 1-4 0V4a2 2 0 1 1 4 0v5z"
                fill="#2EB67D"
              />
              <path
                d="M15 18a2 2 0 1 1-2 2v-2h2zM15 17a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5z"
                fill="#ECB22E"
              />
            </svg>
            <span>Connect with Slack</span>
          </button>
        </div>
      )}
    </div>
  );
};
