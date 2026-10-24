import React, { useState } from 'react';
import { api, ApiError } from '../services/api';
import type { ScheduleEmailResponse } from '../types/email';

interface ScheduleEmailTabProps {
  onSuccessScheduled: () => void;
  onNavigateToScheduled: () => void;
}

export const ScheduleEmailTab: React.FC<ScheduleEmailTabProps> = ({
  onSuccessScheduled,
  onNavigateToScheduled,
}) => {
  // Form state
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sender, setSender] = useState('scheduler@outbox.labs');
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [successResult, setSuccessResult] = useState<ScheduleEmailResponse | null>(null);

  const generateNewIdempotencyKey = () => {
    setIdempotencyKey(crypto.randomUUID());
  };

  // Helper to format local date to ISO for input min attribute
  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});
    setSuccessResult(null);

    // Client-side quick checks
    const errors: Record<string, string> = {};
    if (!recipient.trim()) {
      errors.recipient = 'Recipient email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      errors.recipient = 'Invalid email address format';
    }

    if (!subject.trim()) {
      errors.subject = 'Subject is required';
    }

    if (!body.trim()) {
      errors.body = 'Email body cannot be empty';
    }

    let targetIsoDate: string | undefined = undefined;
    if (scheduleMode === 'later') {
      if (!scheduledAt) {
        errors.scheduledAt = 'Please select a date and time to schedule';
      } else {
        const parsed = new Date(scheduledAt);
        if (isNaN(parsed.getTime())) {
          errors.scheduledAt = 'Invalid date and time selected';
        } else if (parsed.getTime() <= Date.now()) {
          errors.scheduledAt = 'Scheduled time must be in the future';
        } else {
          targetIsoDate = parsed.toISOString();
        }
      }
    } else {
      // Send Now: immediate delivery
      targetIsoDate = new Date().toISOString();
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    try {
      const response = await api.scheduleEmail({
        recipient: recipient.trim(),
        subject: subject.trim(),
        body: body.trim(),
        sender: sender.trim() || undefined,
        scheduledAt: targetIsoDate,
        idempotencyKey: idempotencyKey.trim() || undefined,
      });

      setSuccessResult(response);
      onSuccessScheduled();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.details && Array.isArray(err.details)) {
          const mapped: Record<string, string> = {};
          err.details.forEach((d) => {
            mapped[d.field] = d.message;
          });
          setFieldErrors(mapped);
        }
      } else {
        setError(err instanceof Error ? err.message : 'An unexpected error occurred while scheduling');
      }
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setRecipient('');
    setSubject('');
    setBody('');
    setScheduledAt('');
    setScheduleMode('now');
    setIdempotencyKey(crypto.randomUUID());
    setSuccessResult(null);
    setError(null);
    setFieldErrors({});
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="border border-slate-800 bg-slate-900/40 backdrop-blur-sm p-6 sm:p-8 rounded-2xl">
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center space-x-2.5">
          <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
          <span>Compose & Schedule Email</span>
        </h2>
        <p className="text-slate-400 text-xs sm:text-sm mt-1">
          Persisted to MySQL database and dispatched via BullMQ delayed queueing with zero cron jobs.
        </p>
      </div>

      {/* Success Banner */}
      {successResult && (
        <div className="border border-emerald-500/30 bg-emerald-950/20 rounded-2xl p-6 space-y-4">
          <div className="flex items-start space-x-3.5">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-emerald-300">
                {successResult.idempotent ? 'Email Already Enqueued (Idempotent Hit)' : 'Email Job Scheduled Successfully!'}
              </h3>
              <p className="text-xs text-emerald-400/80 mt-1">
                {successResult.idempotent
                  ? 'A record with this idempotency key was previously created and is preserved in MySQL.'
                  : 'Record persisted in MySQL and delayed job queued in Redis for background delivery.'}
              </p>

              <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase">Job ID</span>
                  <span className="font-mono text-slate-200 font-medium truncate block">
                    {successResult.jobId || `email-job-${successResult.email.id}`}
                  </span>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase">Recipient</span>
                  <span className="font-mono text-slate-200 font-medium truncate block">
                    {successResult.email.recipient}
                  </span>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase">Scheduled At</span>
                  <span className="font-mono text-slate-200 font-medium truncate block">
                    {new Date(successResult.email.scheduled_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex items-center space-x-3">
                <button
                  type="button"
                  onClick={onNavigateToScheduled}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center space-x-1.5"
                >
                  <span>View in Scheduled Jobs</span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Schedule Another Email
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="border border-rose-500/30 bg-rose-950/20 rounded-xl p-4 flex items-start space-x-3 text-xs text-rose-300">
          <svg className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-semibold text-rose-200">Unable to schedule email</p>
            <p className="mt-0.5 text-rose-300/90">{error}</p>
          </div>
        </div>
      )}

      {/* Main Scheduling Form */}
      <form onSubmit={handleSubmit} className="border border-slate-800 bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Recipient */}
          <div className="space-y-1.5">
            <label htmlFor="recipient-input" className="block text-xs font-semibold text-slate-300">
              Recipient Email <span className="text-rose-400">*</span>
            </label>
            <input
              id="recipient-input"
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="recipient@example.com"
              disabled={loading}
              className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border ${
                fieldErrors.recipient ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-800 focus:border-indigo-500'
              } text-white text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors`}
            />
            {fieldErrors.recipient && (
              <p className="text-[11px] text-rose-400">{fieldErrors.recipient}</p>
            )}
          </div>

          {/* Sender */}
          <div className="space-y-1.5">
            <label htmlFor="sender-input" className="block text-xs font-semibold text-slate-300">
              Sender Address
            </label>
            <input
              id="sender-input"
              type="email"
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              placeholder="scheduler@outbox.labs"
              disabled={loading}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          </div>
        </div>

        {/* Subject */}
        <div className="space-y-1.5">
          <label htmlFor="subject-input" className="block text-xs font-semibold text-slate-300">
            Subject Line <span className="text-rose-400">*</span>
          </label>
          <input
            id="subject-input"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Monthly Performance Digest & Schedule"
            disabled={loading}
            className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border ${
              fieldErrors.subject ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-800 focus:border-indigo-500'
            } text-white text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors`}
          />
          {fieldErrors.subject && (
            <p className="text-[11px] text-rose-400">{fieldErrors.subject}</p>
          )}
        </div>

        {/* Body */}
        <div className="space-y-1.5">
          <label htmlFor="body-input" className="block text-xs font-semibold text-slate-300">
            Email Content (Plain Text / HTML) <span className="text-rose-400">*</span>
          </label>
          <textarea
            id="body-input"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type your email message here. Sent via Ethereal SMTP with public preview inspection..."
            disabled={loading}
            className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border ${
              fieldErrors.body ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-800 focus:border-indigo-500'
            } text-white text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors`}
          />
          {fieldErrors.body && (
            <p className="text-[11px] text-rose-400">{fieldErrors.body}</p>
          )}
        </div>

        {/* Schedule Mode Selector */}
        <div className="space-y-3 pt-2 border-t border-slate-800/80">
          <span className="block text-xs font-semibold text-slate-300">Execution Timing</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setScheduleMode('now')}
              className={`p-3.5 rounded-xl border text-left transition-all flex items-start space-x-3 ${
                scheduleMode === 'now'
                  ? 'border-indigo-500/80 bg-indigo-950/20 ring-1 ring-indigo-500/30'
                  : 'border-slate-800 bg-slate-950/60 hover:bg-slate-900'
              }`}
            >
              <div className={`w-4 h-4 rounded-full mt-0.5 border flex items-center justify-center ${
                scheduleMode === 'now' ? 'border-indigo-400 bg-indigo-600' : 'border-slate-600'
              }`}>
                {scheduleMode === 'now' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <div>
                <span className="block text-xs font-semibold text-white">Send Now (Immediate)</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">Enqueues with zero delay for instant worker processing.</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setScheduleMode('later')}
              className={`p-3.5 rounded-xl border text-left transition-all flex items-start space-x-3 ${
                scheduleMode === 'later'
                  ? 'border-indigo-500/80 bg-indigo-950/20 ring-1 ring-indigo-500/30'
                  : 'border-slate-800 bg-slate-950/60 hover:bg-slate-900'
              }`}
            >
              <div className={`w-4 h-4 rounded-full mt-0.5 border flex items-center justify-center ${
                scheduleMode === 'later' ? 'border-indigo-400 bg-indigo-600' : 'border-slate-600'
              }`}>
                {scheduleMode === 'later' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <div>
                <span className="block text-xs font-semibold text-white">Schedule for Later</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">Enqueues as a BullMQ delayed job targeting a future time.</span>
              </div>
            </button>
          </div>

          {/* Datetime Picker (Visible if 'later') */}
          {scheduleMode === 'later' && (
            <div className="pt-2 space-y-1.5">
              <label htmlFor="scheduled-datetime-input" className="block text-xs font-semibold text-slate-300">
                Target Date & Time <span className="text-rose-400">*</span>
              </label>
              <input
                id="scheduled-datetime-input"
                type="datetime-local"
                min={getMinDateTime()}
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={loading}
                className={`w-full sm:w-80 px-3.5 py-2 rounded-xl bg-slate-950 border ${
                  fieldErrors.scheduledAt ? 'border-rose-500' : 'border-slate-800'
                } text-white text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500`}
              />
              {fieldErrors.scheduledAt && (
                <p className="text-[11px] text-rose-400">{fieldErrors.scheduledAt}</p>
              )}
            </div>
          )}
        </div>

        {/* Idempotency Key Section */}
        <div className="space-y-2 pt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-between">
            <label htmlFor="idempotency-input" className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5">
              <span>Idempotency Key</span>
              <span className="text-[10px] text-slate-500 font-mono">(Client Deduplication)</span>
            </label>
            <button
              type="button"
              onClick={generateNewIdempotencyKey}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors flex items-center space-x-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Regenerate Key</span>
            </button>
          </div>
          <input
            id="idempotency-input"
            type="text"
            value={idempotencyKey}
            onChange={(e) => setIdempotencyKey(e.target.value)}
            disabled={loading}
            className="w-full px-3.5 py-2 font-mono text-xs rounded-xl bg-slate-950 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500"
          />
          <p className="text-[11px] text-slate-500">
            Prevents accidental double-dispatch if network retries occur. Duplicate submissions with this key will safely return the original record.
          </p>
        </div>

        {/* Action Button */}
        <div className="pt-4 flex items-center justify-end space-x-3">
          <button
            type="submit"
            disabled={loading}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white transition-all shadow-lg shadow-indigo-600/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Dispatching...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                <span>{scheduleMode === 'now' ? 'Send Email Now' : 'Schedule Delayed Email'}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
