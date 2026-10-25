import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { EmailJobRecord } from '../types/email';

interface ScheduledJobsTabProps {
  onScheduleNewClick: () => void;
  onCountUpdate?: (count: number) => void;
}

export const ScheduledJobsTab: React.FC<ScheduledJobsTabProps> = ({
  onScheduleNewClick,
  onCountUpdate,
}) => {
  const [emails, setEmails] = useState<EmailJobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [cancellingJob, setCancellingJob] = useState<EmailJobRecord | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const fetchScheduledJobs = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getScheduledEmails(50, 0);
      setEmails(response.emails);
      onCountUpdate?.(response.emails.length);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch scheduled jobs');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancellingJob) return;
    setCancelLoading(true);
    setCancelError(null);
    try {
      await api.cancelScheduledEmail(cancellingJob.id);
      setSuccessNotice(`Scheduled email to ${cancellingJob.recipient} was cancelled.`);
      setCancellingJob(null);
      await fetchScheduledJobs();
    } catch (err: any) {
      setCancelError(err instanceof Error ? err.message : 'Failed to cancel scheduled email');
    } finally {
      setCancelLoading(false);
    }
  };

  useEffect(() => {
    fetchScheduledJobs();
  }, []);

  // Auto-refresh interval (every 8 seconds if enabled)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      api
        .getScheduledEmails(50, 0)
        .then((res) => {
          setEmails(res.emails);
          onCountUpdate?.(res.emails.length);
          setLastUpdated(new Date().toLocaleTimeString());
        })
        .catch(() => {});
    }, 8000);

    return () => clearInterval(interval);
  }, [autoRefresh, onCountUpdate]);

  // Helper for human-readable relative time calculation
  const getRelativeTimeString = (targetIsoDate: string) => {
    const diffMs = new Date(targetIsoDate).getTime() - Date.now();
    if (diffMs <= 0) return 'Executing now';
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return `in ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `in ${hours}h ${minutes % 60}m`;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header and Controls */}
      <div className="border border-slate-800 bg-slate-900/40 backdrop-blur-sm p-6 sm:p-8 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Scheduled Jobs Queue</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {emails.length} Pending
            </span>
          </div>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Jobs queued in BullMQ delayed storage ready to be processed by background workers upon reaching their scheduled time.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <label className="flex items-center space-x-2 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
            />
            <span>Auto-refresh (8s)</span>
          </label>

          <button
            type="button"
            onClick={fetchScheduledJobs}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 transition-colors border border-slate-700/80 flex items-center space-x-1.5 disabled:opacity-50"
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
        </div>
      </div>

      {lastUpdated && (
        <div className="flex justify-end text-[11px] text-slate-500 pr-2 -mt-4">
          Last polled: {lastUpdated}
        </div>
      )}

      {/* Success Notice Banner */}
      {successNotice && (
        <div className="border border-emerald-500/30 bg-emerald-950/20 rounded-xl p-4 flex items-center justify-between text-xs text-emerald-300">
          <div className="flex items-center space-x-2.5">
            <svg className="w-5 h-5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{successNotice}</span>
          </div>
          <button
            onClick={() => setSuccessNotice(null)}
            className="text-emerald-400 hover:text-white transition-colors"
            title="Dismiss notice"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error Notice */}
      {error && (
        <div className="border border-rose-500/30 bg-rose-950/20 rounded-xl p-4 flex items-center justify-between text-xs text-rose-300">
          <div className="flex items-center space-x-2.5">
            <svg className="w-5 h-5 text-rose-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Failed to load scheduled jobs: {error}</span>
          </div>
          <button
            onClick={fetchScheduledJobs}
            className="underline font-semibold hover:text-white"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Scheduled Jobs Content */}
      {loading && emails.length === 0 ? (
        <div className="border border-slate-800 bg-slate-900/30 rounded-2xl p-12 text-center space-y-3">
          <svg className="w-8 h-8 text-indigo-400 animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-sm text-slate-400">Loading queued emails from MySQL...</p>
        </div>
      ) : emails.length === 0 ? (
        <div className="border border-slate-800 bg-slate-900/30 rounded-2xl p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto border border-indigo-500/20">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">No Scheduled Emails in Queue</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              There are currently no pending background jobs. You can compose and schedule a new email at any time.
            </p>
          </div>
          <button
            onClick={onScheduleNewClick}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            Compose New Email
          </button>
        </div>
      ) : (
        <div className="border border-slate-800 bg-slate-900/40 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase font-mono text-[10px]">
                <tr>
                  <th className="px-5 py-3.5">Recipient</th>
                  <th className="px-5 py-3.5">Subject</th>
                  <th className="px-5 py-3.5">Target Time</th>
                  <th className="px-5 py-3.5">Delay / ETA</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Job ID</th>
                  <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {emails.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-medium text-slate-200">{job.recipient}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">From: {job.sender}</div>
                    </td>
                    <td className="px-5 py-4 max-w-xs truncate">
                      <span className="font-semibold text-white">{job.subject}</span>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap text-slate-300 font-mono">
                      {new Date(job.scheduled_at).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        {getRelativeTimeString(job.scheduled_at)}
                      </span>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {job.status === 'PROCESSING' ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse">
                          <span>PROCESSING</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                          PENDING
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-[10px] text-slate-500">
                      email-job-{job.id.slice(0, 8)}...
                    </td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      {job.status === 'PENDING' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setCancelError(null);
                            setCancellingJob(job);
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold text-rose-400 hover:text-rose-200 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-colors cursor-pointer"
                          title="Cancel this scheduled email"
                        >
                          Cancel
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500 italic">Processing</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cancellation Confirmation Modal */}
      {cancellingJob && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Cancel Scheduled Email</h3>
                <p className="text-xs text-slate-400 mt-0.5">Are you sure you want to cancel this dispatch?</p>
              </div>
            </div>

            <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 space-y-1.5 text-xs font-mono">
              <div className="text-slate-300">
                <span className="text-slate-500">To:</span> {cancellingJob.recipient}
              </div>
              <div className="text-slate-300 truncate">
                <span className="text-slate-500">Subject:</span> {cancellingJob.subject}
              </div>
              <div className="text-slate-400 text-[11px]">
                <span className="text-slate-500">Scheduled:</span> {new Date(cancellingJob.scheduled_at).toLocaleString()}
              </div>
            </div>

            <p className="text-xs text-slate-400">
              This email will be removed from the BullMQ delayed queue and will not be dispatched. Its history record will be preserved with status <span className="font-semibold text-rose-400">CANCELLED</span>.
            </p>

            {cancelError && (
              <div className="p-3 bg-rose-950/30 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                {cancelError}
              </div>
            )}

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                disabled={cancelLoading}
                onClick={() => {
                  setCancellingJob(null);
                  setCancelError(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
              >
                Keep Scheduled
              </button>
              <button
                type="button"
                disabled={cancelLoading}
                onClick={handleConfirmCancel}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 active:bg-rose-700 transition-colors disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
              >
                {cancelLoading && (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                <span>{cancelLoading ? 'Cancelling...' : 'Confirm Cancellation'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
