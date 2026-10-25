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
    <div className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 shadow-xs space-y-4">
      {/* Card Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center p-2">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
              <path d="M6 15a2 2 0 1 1-2-2h2v2zM7 15a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5z" fill="#E01E5A" />
              <path d="M9 6a2 2 0 1 1 2-2v2H9zM9 7a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5z" fill="#36C5F0" />
              <path d="M18 9a2 2 0 1 1 2 2h-2V9zM17 9a2 2 0 0 1-4 0V4a2 2 0 1 1 4 0v5z" fill="#2EB67D" />
              <path d="M15 18a2 2 0 1 1-2 2v-2h2zM15 17a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5z" fill="#ECB22E" />
            </svg>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-base font-bold text-gray-900 tracking-tight">Slack Rate-Limit Alerts</h3>
              {isConnected ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  CONNECTED
                </span>
              ) : isRevoked ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                  REVOKED
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                  DISCONNECTED
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Automated notifications sent when the distributed Redis hourly limit is hit.
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={loading || actionLoading}
          className="text-xs text-gray-600 hover:text-gray-900 px-2.5 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 transition flex items-center space-x-1.5 self-start sm:self-auto cursor-pointer"
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
        <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <span className="text-base shrink-0">⚠️</span>
            <div>
              <p className="font-semibold text-rose-900">Slack Credentials Revoked</p>
              <p className="text-[11px] text-rose-700 mt-0.5">
                {slackStatus?.message ||
                  'The Slack webhook was revoked or returned 404. Reconnection is required.'}
              </p>
            </div>
          </div>
          <button
            onClick={handleConnect}
            disabled={actionLoading}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#4A154B] hover:bg-[#5C1D5E] text-white transition shrink-0 cursor-pointer"
          >
            Reconnect Workspace
          </button>
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-gray-400 hover:text-gray-600 text-sm ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Connected State Content */}
      {isConnected && integration ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gray-50 p-4 rounded-lg border border-gray-200 text-xs">
            <div>
              <span className="text-gray-400 block text-[10px] uppercase font-semibold">
                Slack Workspace
              </span>
              <span className="text-gray-900 font-semibold mt-0.5 block truncate">
                {integration.teamName}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] uppercase font-semibold">
                Alert Destination
              </span>
              <span className="text-emerald-700 font-mono mt-0.5 block truncate">
                {integration.channelName ? `#${integration.channelName}` : 'Incoming Webhook'}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] uppercase font-semibold">
                Monitored Sender
              </span>
              <span className="text-gray-800 font-mono mt-0.5 block truncate">
                {integration.sender}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-gray-500 flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Deduplication active: 1 alert per cooldown window to prevent spam.</span>
            </p>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleTestNotification}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-800 border border-gray-200 transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
              >
                <span>{actionLoading ? 'Sending...' : 'Send Test Alert'}</span>
              </button>

              <button
                onClick={handleConnect}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-800 border border-gray-200 transition cursor-pointer"
              >
                Reconnect
              </button>

              <button
                onClick={handleDisconnect}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 hover:bg-rose-50 border border-rose-200 transition cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-2">
          <div className="space-y-1">
            <p className="text-xs text-gray-600">
              Connect your team's Slack workspace to receive automated notifications whenever hourly sending thresholds are exceeded.
            </p>
            {!isConfigured && (
              <p className="text-[11px] text-amber-600 font-mono">
                Note: Slack app credentials are not configured in production environment.
              </p>
            )}
          </div>

          <button
            onClick={handleConnect}
            disabled={actionLoading}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-[#4A154B] hover:bg-[#5C1D5E] text-white transition flex items-center space-x-2 shrink-0 cursor-pointer shadow-xs disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
              <path d="M6 15a2 2 0 1 1-2-2h2v2zM7 15a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5z" fill="#E01E5A" />
              <path d="M9 6a2 2 0 1 1 2-2v2H9zM9 7a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5z" fill="#36C5F0" />
              <path d="M18 9a2 2 0 1 1 2 2h-2V9zM17 9a2 2 0 0 1-4 0V4a2 2 0 1 1 4 0v5z" fill="#2EB67D" />
              <path d="M15 18a2 2 0 1 1-2 2v-2h2zM15 17a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5z" fill="#ECB22E" />
            </svg>
            <span>Connect Slack</span>
          </button>
        </div>
      )}
    </div>
  );
};
