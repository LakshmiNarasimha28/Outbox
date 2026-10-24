import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { EmailJobRecord } from '../types/email';

export const DeliveryHistoryTab: React.FC = () => {
  const [emails, setEmails] = useState<EmailJobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SENT' | 'FAILED'>('ALL');
  const [selectedFailedEmail, setSelectedFailedEmail] = useState<EmailJobRecord | null>(null);

  const fetchHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getEmailHistory(50, 0);
      setEmails(response.emails);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch delivery history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const filteredEmails = emails.filter((item) => {
    if (statusFilter === 'ALL') return true;
    return item.status === statusFilter;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header and Filter Controls */}
      <div className="border border-slate-800 bg-slate-900/40 backdrop-blur-sm p-6 sm:p-8 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Delivery History</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
              {emails.length} Completed
            </span>
          </div>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Real delivery audit logs from MySQL with public Ethereal SMTP preview links and failure diagnostics.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* Filter Pills */}
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-medium">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1 rounded-lg transition-colors ${
                statusFilter === 'ALL' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({emails.length})
            </button>
            <button
              onClick={() => setStatusFilter('SENT')}
              className={`px-3 py-1 rounded-lg transition-colors ${
                statusFilter === 'SENT' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sent ({emails.filter((e) => e.status === 'SENT').length})
            </button>
            <button
              onClick={() => setStatusFilter('FAILED')}
              className={`px-3 py-1 rounded-lg transition-colors ${
                statusFilter === 'FAILED' ? 'bg-rose-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Failed ({emails.filter((e) => e.status === 'FAILED').length})
            </button>
          </div>

          <button
            type="button"
            onClick={fetchHistory}
            disabled={loading}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors border border-slate-700"
            title="Refresh history"
          >
            <svg
              className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="border border-rose-500/30 bg-rose-950/20 rounded-xl p-4 flex items-center justify-between text-xs text-rose-300">
          <span>Failed to load delivery history: {error}</span>
          <button onClick={fetchHistory} className="underline font-semibold hover:text-white">
            Retry
          </button>
        </div>
      )}

      {/* History Table */}
      {loading && emails.length === 0 ? (
        <div className="border border-slate-800 bg-slate-900/30 rounded-2xl p-12 text-center space-y-3">
          <svg className="w-8 h-8 text-indigo-400 animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-sm text-slate-400">Loading delivery records from MySQL...</p>
        </div>
      ) : filteredEmails.length === 0 ? (
        <div className="border border-slate-800 bg-slate-900/30 rounded-2xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-white">No Records Found</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {statusFilter === 'ALL'
              ? 'No completed email jobs found in the database yet.'
              : `No emails matching status '${statusFilter}'.`}
          </p>
        </div>
      ) : (
        <div className="border border-slate-800 bg-slate-900/40 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase font-mono text-[10px]">
                <tr>
                  <th className="px-5 py-3.5">Recipient</th>
                  <th className="px-5 py-3.5">Subject</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Sent / Processed At</th>
                  <th className="px-5 py-3.5">Attempts</th>
                  <th className="px-5 py-3.5 text-right">Ethereal Inspection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredEmails.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-200">{item.recipient}</div>
                      <div className="text-[10px] text-slate-500 font-mono">ID: {item.id.slice(0, 8)}...</div>
                    </td>
                    <td className="px-5 py-4 max-w-xs truncate text-slate-300 font-medium">
                      {item.subject}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {item.status === 'SENT' ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <span>SENT</span>
                        </span>
                      ) : item.status === 'FAILED' ? (
                        <button
                          onClick={() => setSelectedFailedEmail(item)}
                          className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors cursor-pointer"
                          title="Click to view error reason"
                        >
                          <span>FAILED (Inspect)</span>
                        </button>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400">
                          {item.status}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap text-slate-300 font-mono text-[11px]">
                      {item.sent_at
                        ? new Date(item.sent_at).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : item.failed_at
                        ? new Date(item.failed_at).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap font-mono text-slate-400">
                      {item.attempts} / {item.max_attempts}
                    </td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      {item.ethereal_preview_url ? (
                        <a
                          href={item.ethereal_preview_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/30 transition-all shadow-sm"
                        >
                          <span>Open Preview</span>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      ) : (
                        <span className="text-slate-600 font-mono text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Error Details Modal */}
      {selectedFailedEmail && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-rose-400 flex items-center space-x-2">
                <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Delivery Failure Details</span>
              </h3>
              <button
                onClick={() => setSelectedFailedEmail(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-400 block text-[11px]">Email ID</span>
                <span className="font-mono text-slate-200">{selectedFailedEmail.id}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Recipient</span>
                <span className="font-semibold text-slate-200">{selectedFailedEmail.recipient}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Attempted</span>
                <span className="font-mono text-slate-300">
                  {selectedFailedEmail.attempts} of {selectedFailedEmail.max_attempts} maximum attempts
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Failure Reason</span>
                <div className="mt-1 p-3 rounded-xl bg-slate-950 border border-rose-500/20 text-rose-300 font-mono text-[11px] whitespace-pre-wrap break-words">
                  {selectedFailedEmail.error_message || 'Unknown delivery failure reported by worker'}
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedFailedEmail(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
