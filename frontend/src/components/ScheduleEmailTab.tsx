import React, { useState, useRef } from 'react';
import { api, ApiError } from '../services/api';
import type { ScheduleEmailResponse, ScheduleBatchResponse, ParseLeadsResponse } from '../types/email';

interface ScheduleEmailTabProps {
  onSuccessScheduled: () => void;
  onNavigateToScheduled: () => void;
}

export const ScheduleEmailTab: React.FC<ScheduleEmailTabProps> = ({
  onSuccessScheduled,
  onNavigateToScheduled,
}) => {
  // Mode selection: Single email vs Batch lead upload
  const [targetMode, setTargetMode] = useState<'single' | 'batch'>('single');

  // Common form state
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sender, setSender] = useState('scheduler@outbox.labs');
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');

  // Single mode state
  const [recipient, setRecipient] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  // Batch mode state
  const [leadInputType, setLeadInputType] = useState<'upload' | 'paste'>('upload');
  const [rawTextContent, setRawTextContent] = useState('');
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsingLeads, setParsingLeads] = useState(false);
  const [leadSummary, setLeadSummary] = useState<ParseLeadsResponse | null>(null);
  const [extractedRecipients, setExtractedRecipients] = useState<string[]>([]);
  const [delayBetweenEmailsSeconds, setDelayBetweenEmailsSeconds] = useState<number>(5);
  const [hourlyRateLimit, setHourlyRateLimit] = useState<number>(10);
  const [batchIdempotencyKey, setBatchIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [singleSuccessResult, setSingleSuccessResult] = useState<ScheduleEmailResponse | null>(null);
  const [batchSuccessResult, setBatchSuccessResult] = useState<ScheduleBatchResponse | null>(null);

  const generateNewIdempotencyKey = () => {
    if (targetMode === 'single') {
      setIdempotencyKey(crypto.randomUUID());
    } else {
      setBatchIdempotencyKey(crypto.randomUUID());
    }
  };

  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  };

  // Process raw text or file content through the lead parser
  const processLeadContent = async (content: string, fileName?: string) => {
    if (!content.trim()) {
      setLeadSummary(null);
      setExtractedRecipients([]);
      return;
    }

    setParsingLeads(true);
    setError(null);
    try {
      const summary = await api.parseLeads(content);
      setLeadSummary(summary);
      setExtractedRecipients(summary.validLeads);
      if (fileName) {
        setSelectedFileName(fileName);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse leads file');
      setLeadSummary(null);
      setExtractedRecipients([]);
    } finally {
      setParsingLeads(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
      setError('Please select a valid .csv or .txt file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      processLeadContent(text, file.name);
    };
    reader.onerror = () => {
      setError('Error reading uploaded file');
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
      setError('Please drop a valid .csv or .txt file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      processLeadContent(text, file.name);
    };
    reader.readAsText(file);
  };

  const handleRemoveLead = (leadToRemove: string) => {
    setExtractedRecipients((prev) => prev.filter((email) => email !== leadToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});
    setSingleSuccessResult(null);
    setBatchSuccessResult(null);

    const errors: Record<string, string> = {};

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
      targetIsoDate = new Date().toISOString();
    }

    if (targetMode === 'single') {
      if (!recipient.trim()) {
        errors.recipient = 'Recipient email is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        errors.recipient = 'Invalid email address format';
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

        setSingleSuccessResult(response);
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
    } else {
      // Batch mode
      if (extractedRecipients.length === 0) {
        errors.recipients = 'Please upload a CSV/text file or paste valid email leads';
      }

      if (delayBetweenEmailsSeconds < 0) {
        errors.delayBetweenEmailsSeconds = 'Delay cannot be negative';
      }

      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        setLoading(false);
        return;
      }

      try {
        const response = await api.scheduleBatch({
          recipients: extractedRecipients,
          subject: subject.trim(),
          body: body.trim(),
          sender: sender.trim() || undefined,
          startTime: targetIsoDate,
          delayBetweenEmailsSeconds,
          hourlyRateLimit,
          batchIdempotencyKey: batchIdempotencyKey.trim() || undefined,
        });

        setBatchSuccessResult(response);
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
          setError(err instanceof Error ? err.message : 'An unexpected error occurred while scheduling batch');
        }
      } finally {
        setLoading(false);
      }
    }
  };

  const resetForm = () => {
    setRecipient('');
    setSubject('');
    setBody('');
    setScheduledAt('');
    setScheduleMode('now');
    setIdempotencyKey(crypto.randomUUID());
    setBatchIdempotencyKey(crypto.randomUUID());
    setSingleSuccessResult(null);
    setBatchSuccessResult(null);
    setError(null);
    setFieldErrors({});
    setLeadSummary(null);
    setExtractedRecipients([]);
    setSelectedFileName(null);
    setRawTextContent('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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
          Supports single delivery or batch lead campaigns with CSV/text upload, staggered delays, and atomic rate limiting.
        </p>

        {/* Mode Selector Tabs */}
        <div className="mt-5 flex items-center space-x-3 border-t border-slate-800/80 pt-4">
          <button
            type="button"
            onClick={() => {
              setTargetMode('single');
              setError(null);
            }}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 ${
              targetMode === 'single'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
            </svg>
            <span>Single Recipient</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTargetMode('batch');
              setError(null);
            }}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 ${
              targetMode === 'batch'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <span>Upload Leads (CSV / TXT)</span>
            <span className="bg-indigo-500/20 text-indigo-300 text-[10px] px-1.5 py-0.5 rounded-full border border-indigo-500/30 font-mono">
              Campaign
            </span>
          </button>
        </div>
      </div>

      {/* Single Success Banner */}
      {singleSuccessResult && (
        <div className="border border-emerald-500/30 bg-emerald-950/20 rounded-2xl p-6 space-y-4">
          <div className="flex items-start space-x-3.5">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-emerald-300">
                {singleSuccessResult.idempotent ? 'Email Already Enqueued (Idempotent Hit)' : 'Email Job Scheduled Successfully!'}
              </h3>
              <p className="text-xs text-emerald-400/80 mt-1">
                {singleSuccessResult.idempotent
                  ? 'A record with this idempotency key was previously created and is preserved in MySQL.'
                  : 'Record persisted in MySQL and delayed job queued in Redis for background delivery.'}
              </p>

              <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase">Job ID</span>
                  <span className="font-mono text-slate-200 font-medium truncate block">
                    {singleSuccessResult.jobId || `email-job-${singleSuccessResult.email.id}`}
                  </span>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase">Recipient</span>
                  <span className="font-mono text-slate-200 font-medium truncate block">
                    {singleSuccessResult.email.recipient}
                  </span>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase">Scheduled At</span>
                  <span className="font-mono text-slate-200 font-medium truncate block">
                    {new Date(singleSuccessResult.email.scheduled_at).toLocaleTimeString([], {
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

      {/* Batch Success Banner */}
      {batchSuccessResult && (
        <div className="border border-emerald-500/30 bg-emerald-950/20 rounded-2xl p-6 space-y-4">
          <div className="flex items-start space-x-3.5">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-emerald-300">
                Lead Batch Scheduled Successfully!
              </h3>
              <p className="text-xs text-emerald-400/80 mt-1">
                {batchSuccessResult.message}
              </p>

              <div className="mt-3.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase">Enqueued Jobs</span>
                  <span className="font-mono text-emerald-400 font-bold text-sm block">
                    {batchSuccessResult.scheduledCount}
                  </span>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase">Delay Between Emails</span>
                  <span className="font-mono text-slate-200 font-medium block">
                    {batchSuccessResult.delayBetweenEmailsSeconds}s
                  </span>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase">First Scheduled</span>
                  <span className="font-mono text-slate-200 font-medium truncate block">
                    {new Date(batchSuccessResult.firstScheduledAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase">Last Scheduled</span>
                  <span className="font-mono text-slate-200 font-medium truncate block">
                    {new Date(batchSuccessResult.lastScheduledAt).toLocaleTimeString()}
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
                  Schedule Another Campaign
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
            <p className="font-semibold text-rose-200">Unable to schedule</p>
            <p className="mt-0.5 text-rose-300/90">{error}</p>
          </div>
        </div>
      )}

      {/* Main Scheduling Form */}
      <form onSubmit={handleSubmit} className="border border-slate-800 bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 sm:p-8 space-y-6">
        {/* Recipient Section: Single vs Batch */}
        {targetMode === 'single' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Single Recipient */}
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
        ) : (
          /* Batch Lead Upload Section */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-300">
                Upload Leads or Paste Addresses <span className="text-rose-400">*</span>
              </label>
              <div className="flex items-center space-x-2 text-xs">
                <button
                  type="button"
                  onClick={() => setLeadInputType('upload')}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${
                    leadInputType === 'upload'
                      ? 'bg-slate-800 text-white font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  File Upload
                </button>
                <span className="text-slate-700">|</span>
                <button
                  type="button"
                  onClick={() => setLeadInputType('paste')}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${
                    leadInputType === 'paste'
                      ? 'bg-slate-800 text-white font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Paste Text
                </button>
              </div>
            </div>

            {leadInputType === 'upload' ? (
              /* Drag & Drop Upload Zone */
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-950/20'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-950/60'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="flex flex-col items-center justify-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-slate-200">
                      {selectedFileName ? selectedFileName : 'Drop CSV or plain-text file here, or browse'}
                    </span>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Accepts .csv with email headers and .txt with comma, semicolon, or newline separated emails
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              /* Paste Text Directly */
              <div className="space-y-2">
                <textarea
                  rows={4}
                  value={rawTextContent}
                  onChange={(e) => {
                    setRawTextContent(e.target.value);
                    processLeadContent(e.target.value);
                  }}
                  placeholder="Paste email addresses separated by commas, semicolons, tabs, or newlines..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            )}

            {/* Parsing Spinner */}
            {parsingLeads && (
              <div className="flex items-center space-x-2 text-xs text-indigo-400">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Analyzing and validating email addresses...</span>
              </div>
            )}

            {/* Lead Validation & Duplicate Summary Card */}
            {leadSummary && (
              <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center space-x-3">
                    <span className="font-semibold text-slate-300">Extraction Results:</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {extractedRecipients.length} Valid Leads
                    </span>
                    {leadSummary.duplicatesRemoved > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {leadSummary.duplicatesRemoved} Duplicates Skipped
                      </span>
                    )}
                    {leadSummary.invalidCount > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
                        {leadSummary.invalidCount} Invalid Skipped
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono">
                    Total Detected: {leadSummary.totalDetected}
                  </span>
                </div>

                {/* Extracted Leads Pill Preview */}
                {extractedRecipients.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/60">
                    <span className="text-[11px] text-slate-400 block font-medium">
                      Recipient List ({extractedRecipients.length} targets):
                    </span>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                      {extractedRecipients.slice(0, 50).map((email) => (
                        <span
                          key={email}
                          className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg text-[10px] font-mono bg-slate-900 border border-slate-800 text-slate-300"
                        >
                          <span>{email}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveLead(email)}
                            className="text-slate-500 hover:text-rose-400 transition-colors ml-1"
                            title="Remove from batch"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {extractedRecipients.length > 50 && (
                        <span className="text-[10px] text-slate-500 self-center">
                          +{extractedRecipients.length - 50} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {fieldErrors.recipients && (
              <p className="text-[11px] text-rose-400">{fieldErrors.recipients}</p>
            )}
          </div>
        )}

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
            placeholder="e.g. Welcome to Outbox Sequence"
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

        {/* Batch Timing & Delay Controls */}
        {targetMode === 'batch' && (
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4">
            <span className="block text-xs font-semibold text-slate-300">Batch Delivery Cadence</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Delay between consecutive emails */}
              <div className="space-y-1">
                <label htmlFor="delay-input" className="block text-[11px] font-semibold text-slate-400">
                  Delay Between Emails (Seconds)
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    id="delay-input"
                    type="number"
                    min="0"
                    max="3600"
                    value={delayBetweenEmailsSeconds}
                    onChange={(e) => setDelayBetweenEmailsSeconds(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-28 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[11px] text-slate-400">seconds</span>
                </div>
                <p className="text-[10px] text-slate-500">
                  Staggers each subsequent lead by {delayBetweenEmailsSeconds}s to prevent rate burst.
                </p>
              </div>

              {/* Hourly sending limit */}
              <div className="space-y-1">
                <label htmlFor="limit-input" className="block text-[11px] font-semibold text-slate-400">
                  Sender Hourly Limit
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    id="limit-input"
                    type="number"
                    min="1"
                    max="1000"
                    value={hourlyRateLimit}
                    onChange={(e) => setHourlyRateLimit(Math.max(1, parseInt(e.target.value, 10) || 10))}
                    className="w-28 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[11px] text-slate-400">emails / hour</span>
                </div>
                <p className="text-[10px] text-slate-500">
                  Distributed Redis atomic limit. Over-quota emails are automatically delayed to the next hour.
                </p>
              </div>
            </div>

            {/* Campaign Duration Estimate */}
            {extractedRecipients.length > 0 && (
              <div className="pt-2 border-t border-slate-800/60 text-[11px] text-indigo-300 flex items-center space-x-1.5">
                <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  Campaign Timeline: {extractedRecipients.length} emails staggered by {delayBetweenEmailsSeconds}s will span approximately{' '}
                  <strong className="text-white font-mono">
                    {Math.round((extractedRecipients.length * delayBetweenEmailsSeconds) / 60)} minutes
                  </strong>{' '}
                  (excluding hourly quota pauses).
                </span>
              </div>
            )}
          </div>
        )}

        {/* Schedule Mode Selector (Start Time) */}
        <div className="space-y-3 pt-2 border-t border-slate-800/80">
          <span className="block text-xs font-semibold text-slate-300">
            {targetMode === 'batch' ? 'Campaign Start Time' : 'Execution Timing'}
          </span>
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
                <span className="block text-xs font-semibold text-white">Start Immediately</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">
                  {targetMode === 'batch'
                    ? 'First email dispatched now, subsequent emails staggered by delay.'
                    : 'Enqueues with zero delay for instant worker processing.'}
                </span>
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
                <span className="block text-xs font-semibold text-white">Schedule Future Start Time</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">
                  {targetMode === 'batch'
                    ? 'Sequence begins at specified future date and paces forward.'
                    : 'Enqueues as a BullMQ delayed job targeting a future time.'}
                </span>
              </div>
            </button>
          </div>

          {/* Datetime Picker (Visible if 'later') */}
          {scheduleMode === 'later' && (
            <div className="pt-2 space-y-1.5">
              <label htmlFor="scheduled-datetime-input" className="block text-xs font-semibold text-slate-300">
                Start Date & Time <span className="text-rose-400">*</span>
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
              <span>{targetMode === 'batch' ? 'Batch Idempotency Key' : 'Idempotency Key'}</span>
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
            value={targetMode === 'single' ? idempotencyKey : batchIdempotencyKey}
            onChange={(e) =>
              targetMode === 'single'
                ? setIdempotencyKey(e.target.value)
                : setBatchIdempotencyKey(e.target.value)
            }
            disabled={loading}
            className="w-full px-3.5 py-2 font-mono text-xs rounded-xl bg-slate-950 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500"
          />
          <p className="text-[11px] text-slate-500">
            {targetMode === 'batch'
              ? 'Ensures each lead in the batch receives a unique, deterministic idempotency key. Resubmitting will not create duplicate emails.'
              : 'Prevents accidental double-dispatch if network retries occur. Duplicate submissions safely return the original record.'}
          </p>
        </div>

        {/* Action Button */}
        <div className="pt-4 flex items-center justify-end space-x-3">
          <button
            type="submit"
            disabled={loading || (targetMode === 'batch' && extractedRecipients.length === 0)}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white transition-all shadow-lg shadow-indigo-600/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>
                  {targetMode === 'batch'
                    ? `Scheduling ${extractedRecipients.length} Leads...`
                    : 'Dispatching Email...'}
                </span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                <span>
                  {targetMode === 'batch'
                    ? `Schedule ${extractedRecipients.length > 0 ? extractedRecipients.length : ''} Leads Campaign`
                    : scheduleMode === 'now'
                    ? 'Send Email Now'
                    : 'Schedule Delayed Email'}
                </span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
