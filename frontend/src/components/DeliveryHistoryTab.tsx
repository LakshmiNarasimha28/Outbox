import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../services/api';
import type { EmailJobRecord } from '../types/email';

interface DeliveryHistoryTabProps {
  searchFilter?: string;
}

export const DeliveryHistoryTab: React.FC<DeliveryHistoryTabProps> = ({ searchFilter = '' }) => {
  const [emails, setEmails] = useState<EmailJobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SENT' | 'FAILED' | 'CANCELLED'>('ALL');
  const [selectedFailedEmail, setSelectedFailedEmail] = useState<EmailJobRecord | null>(null);
  const [localSearch, setLocalSearch] = useState('');

  const fetchHistory = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const activeSearch = searchFilter || localSearch;

  const filteredEmails = useMemo(() => {
    return emails.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (!activeSearch.trim()) return true;
      const q = activeSearch.toLowerCase();
      return (
        item.recipient.toLowerCase().includes(q) ||
        item.subject.toLowerCase().includes(q) ||
        item.sender.toLowerCase().includes(q)
      );
    });
  }, [emails, statusFilter, activeSearch]);

  const sentCount = emails.filter((e) => e.status === 'SENT').length;
  const failedCount = emails.filter((e) => e.status === 'FAILED').length;
  const cancelledCount = emails.filter((e) => e.status === 'CANCELLED').length;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header and Filter Controls */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2.5">
            <h2 className="text-lg font-bold text-gray-900 tracking-tight">Delivery History</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
              {emails.length} Records
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Audit logs from MySQL with live Ethereal SMTP public inspection previews.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filter Pills */}
          <div className="inline-flex p-1 bg-gray-100 rounded-lg text-xs font-medium">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                statusFilter === 'ALL' ? 'bg-white text-gray-900 font-semibold shadow-xs' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              All ({emails.length})
            </button>
            <button
              onClick={() => setStatusFilter('SENT')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                statusFilter === 'SENT' ? 'bg-emerald-600 text-white font-semibold shadow-xs' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Sent ({sentCount})
            </button>
            <button
              onClick={() => setStatusFilter('FAILED')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                statusFilter === 'FAILED' ? 'bg-rose-600 text-white font-semibold shadow-xs' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Failed ({failedCount})
            </button>
            <button
              onClick={() => setStatusFilter('CANCELLED')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                statusFilter === 'CANCELLED' ? 'bg-amber-600 text-white font-semibold shadow-xs' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Cancelled ({cancelledCount})
            </button>
          </div>

          {/* Local search input */}
          <div className="relative">
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Search history..."
              className="w-40 sm:w-48 px-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:border-emerald-500 transition-colors"
            />
            {localSearch && (
              <button
                onClick={() => setLocalSearch('')}
                className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={fetchHistory}
            disabled={loading}
            className="p-2 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 transition-colors border border-gray-200 cursor-pointer disabled:opacity-50"
            title="Refresh history"
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
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-rose-800 shadow-xs">
          <span>Failed to load delivery history: {error}</span>
          <button onClick={fetchHistory} className="underline font-semibold text-rose-900 hover:text-rose-950 cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {/* History Table */}
      {loading && emails.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center space-y-3 shadow-xs">
          <svg className="w-6 h-6 text-emerald-600 animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-xs text-gray-500">Loading delivery records from MySQL...</p>
        </div>
      ) : filteredEmails.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center space-y-3 shadow-xs">
          <div className="w-10 h-10 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center mx-auto">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-900">No Records Found</h3>
          <p className="text-xs text-gray-500">
            {activeSearch
              ? 'No emails match your search query.'
              : statusFilter === 'ALL'
              ? 'No completed email jobs found in the database yet.'
              : `No emails matching status '${statusFilter}'.`}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50/80 text-gray-500 border-b border-gray-200 font-medium text-[11px]">
                <tr>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Delivered / Processed</th>
                  <th className="px-4 py-3">Attempts</th>
                  <th className="px-4 py-3 text-right">Ethereal Inspection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredEmails.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{item.recipient}</div>
                      <div className="text-[10px] text-gray-400 font-mono">ID: {item.id.slice(0, 8)}...</div>
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate text-gray-800 font-medium">
                      {item.subject}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {item.status === 'SENT' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          SENT
                        </span>
                      ) : item.status === 'FAILED' ? (
                        <button
                          onClick={() => setSelectedFailedEmail(item)}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors cursor-pointer"
                          title="Click to view error reason"
                        >
                          FAILED (View)
                        </button>
                      ) : item.status === 'CANCELLED' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                          CANCELLED
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500">
                          {item.status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600 font-mono text-[11px]">
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
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-gray-500">
                      {item.attempts} / {item.max_attempts}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {item.ethereal_preview_url ? (
                        <a
                          href={item.ethereal_preview_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                        >
                          <span>Open Preview</span>
                          <span>↗</span>
                        </a>
                      ) : (
                        <span className="text-gray-300 font-mono text-[11px]">—</span>
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
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-rose-700 flex items-center space-x-2">
                <svg className="w-4 h-4 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Delivery Failure Details</span>
              </h3>
              <button
                onClick={() => setSelectedFailedEmail(null)}
                className="text-gray-400 hover:text-gray-700 p-1 rounded cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div>
                <span className="text-gray-400 block text-[10px] uppercase font-semibold">Email ID</span>
                <span className="font-mono text-gray-800">{selectedFailedEmail.id}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px] uppercase font-semibold">Recipient</span>
                <span className="font-medium text-gray-900">{selectedFailedEmail.recipient}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px] uppercase font-semibold">Attempts</span>
                <span className="font-mono text-gray-700">
                  {selectedFailedEmail.attempts} of {selectedFailedEmail.max_attempts}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px] uppercase font-semibold">Failure Diagnostic</span>
                <div className="mt-1 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 font-mono text-[11px] whitespace-pre-wrap break-words">
                  {selectedFailedEmail.error_message || 'Unknown delivery failure reported by worker'}
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedFailedEmail(null)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-800 transition-colors cursor-pointer"
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
