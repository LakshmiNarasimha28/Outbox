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

  // Advanced settings disclosure
  const [showAdvanced, setShowAdvanced] = useState(false);

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
      errors.subject = 'Subject line is required';
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
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Compose Header & Mode Tabs */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 tracking-tight">Compose Email</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Deliver immediately or schedule queue-backed dispatch with rate limits.
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="inline-flex p-1 bg-gray-100 rounded-lg text-xs font-medium self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setTargetMode('single');
              setError(null);
            }}
            className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
              targetMode === 'single'
                ? 'bg-white text-gray-900 font-semibold shadow-xs'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Single Recipient
          </button>
          <button
            type="button"
            onClick={() => {
              setTargetMode('batch');
              setError(null);
            }}
            className={`px-3 py-1.5 rounded-md transition-all flex items-center space-x-1.5 cursor-pointer ${
              targetMode === 'batch'
                ? 'bg-white text-gray-900 font-semibold shadow-xs'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <span>Batch Leads</span>
            <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded-full">
              CSV/TXT
            </span>
          </button>
        </div>
      </div>

      {/* Success Notification - Single Email */}
      {singleSuccessResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-xs text-emerald-900 shadow-xs space-y-3">
          <div className="flex items-start space-x-3">
            <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-emerald-900">
                {singleSuccessResult.idempotent ? 'Email Already Enqueued (Idempotent Hit)' : 'Email Job Scheduled Successfully'}
              </h3>
              <p className="text-emerald-700 mt-0.5">
                {singleSuccessResult.idempotent
                  ? 'A record with this idempotency key was previously created and is preserved in MySQL.'
                  : `Queued in BullMQ for delivery to ${singleSuccessResult.email.recipient}.`}
              </p>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="bg-white/80 p-2 rounded-lg border border-emerald-200/60">
                  <span className="text-gray-400 block text-[10px] uppercase font-semibold">Job ID</span>
                  <span className="font-mono text-gray-800 font-medium truncate block">
                    {singleSuccessResult.jobId || `email-job-${singleSuccessResult.email.id}`}
                  </span>
                </div>
                <div className="bg-white/80 p-2 rounded-lg border border-emerald-200/60">
                  <span className="text-gray-400 block text-[10px] uppercase font-semibold">Recipient</span>
                  <span className="font-mono text-gray-800 font-medium truncate block">
                    {singleSuccessResult.email.recipient}
                  </span>
                </div>
                <div className="bg-white/80 p-2 rounded-lg border border-emerald-200/60">
                  <span className="text-gray-400 block text-[10px] uppercase font-semibold">Scheduled For</span>
                  <span className="font-mono text-gray-800 font-medium truncate block">
                    {new Date(singleSuccessResult.email.scheduled_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              <div className="mt-3.5 flex items-center space-x-3">
                <button
                  type="button"
                  onClick={onNavigateToScheduled}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
                >
                  View in Scheduled Jobs →
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-800 hover:text-emerald-950 transition-colors cursor-pointer"
                >
                  Compose Another
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Notification - Batch Leads */}
      {batchSuccessResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-xs text-emerald-900 shadow-xs space-y-3">
          <div className="flex items-start space-x-3">
            <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-emerald-900">
                Batch Campaign Scheduled Successfully
              </h3>
              <p className="text-emerald-700 mt-0.5">{batchSuccessResult.message}</p>

              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-white/80 p-2 rounded-lg border border-emerald-200/60">
                  <span className="text-gray-400 block text-[10px] uppercase font-semibold">Jobs Enqueued</span>
                  <span className="font-mono text-emerald-700 font-bold text-sm block">
                    {batchSuccessResult.scheduledCount}
                  </span>
                </div>
                <div className="bg-white/80 p-2 rounded-lg border border-emerald-200/60">
                  <span className="text-gray-400 block text-[10px] uppercase font-semibold">Delay Cadence</span>
                  <span className="font-mono text-gray-800 font-medium block">
                    {batchSuccessResult.delayBetweenEmailsSeconds}s
                  </span>
                </div>
                <div className="bg-white/80 p-2 rounded-lg border border-emerald-200/60">
                  <span className="text-gray-400 block text-[10px] uppercase font-semibold">First Start</span>
                  <span className="font-mono text-gray-800 font-medium truncate block">
                    {new Date(batchSuccessResult.firstScheduledAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="bg-white/80 p-2 rounded-lg border border-emerald-200/60">
                  <span className="text-gray-400 block text-[10px] uppercase font-semibold">Last ETA</span>
                  <span className="font-mono text-gray-800 font-medium truncate block">
                    {new Date(batchSuccessResult.lastScheduledAt).toLocaleTimeString()}
                  </span>
                </div>
              </div>

              <div className="mt-3.5 flex items-center space-x-3">
                <button
                  type="button"
                  onClick={onNavigateToScheduled}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
                >
                  View in Scheduled Jobs →
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-800 hover:text-emerald-950 transition-colors cursor-pointer"
                >
                  Compose Another
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="border border-rose-200 bg-rose-50 rounded-xl p-4 flex items-start space-x-3 text-xs text-rose-800">
          <svg className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="font-semibold text-rose-900">Unable to schedule email</p>
            <p className="mt-0.5 text-rose-700">{error}</p>
          </div>
        </div>
      )}

      {/* Main Composer Form */}
      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs space-y-4">
        {/* Sender & Recipient Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Sender */}
          <div className="space-y-1">
            <label htmlFor="sender-input" className="block text-xs font-semibold text-gray-700">
              From
            </label>
            <div className="relative">
              <input
                id="sender-input"
                type="text"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="scheduler@outbox.labs"
                disabled={loading}
                className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 text-xs focus:bg-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>
          </div>

          {/* Single Recipient */}
          {targetMode === 'single' && (
            <div className="space-y-1">
              <label htmlFor="recipient-input" className="block text-xs font-semibold text-gray-700">
                To <span className="text-rose-500">*</span>
              </label>
              <input
                id="recipient-input"
                type="email"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="recipient@example.com"
                disabled={loading}
                className={`w-full px-3 py-2 rounded-lg bg-white border ${
                  fieldErrors.recipient ? 'border-rose-400 focus:ring-rose-400' : 'border-gray-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500'
                } text-gray-900 text-xs focus:outline-none transition-colors`}
              />
              {fieldErrors.recipient && (
                <p className="text-[11px] text-rose-600">{fieldErrors.recipient}</p>
              )}
            </div>
          )}
        </div>

        {/* Batch Leads Section */}
        {targetMode === 'batch' && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-gray-700">
                Recipients List <span className="text-rose-500">*</span>
              </label>
              <div className="flex items-center space-x-2 text-xs">
                <button
                  type="button"
                  onClick={() => setLeadInputType('upload')}
                  className={`px-2 py-0.5 rounded cursor-pointer ${
                    leadInputType === 'upload' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  File Upload
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={() => setLeadInputType('paste')}
                  className={`px-2 py-0.5 rounded cursor-pointer ${
                    leadInputType === 'paste' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Paste Text
                </button>
              </div>
            </div>

            {leadInputType === 'upload' ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-emerald-500 bg-emerald-50/50'
                    : 'border-gray-300 bg-gray-50/50 hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="flex flex-col items-center justify-center space-y-1.5">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-gray-800">
                      {selectedFileName ? selectedFileName : 'Drop CSV or plain-text file here, or browse'}
                    </span>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Accepts CSV with email headers or TXT with comma/newline separated addresses
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <textarea
                rows={3}
                value={rawTextContent}
                onChange={(e) => {
                  setRawTextContent(e.target.value);
                  processLeadContent(e.target.value);
                }}
                placeholder="Paste emails separated by commas, semicolons, tabs, or newlines..."
                className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-800 text-xs font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            )}

            {/* Parsing Indicator */}
            {parsingLeads && (
              <div className="flex items-center space-x-2 text-xs text-emerald-600">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Analyzing and validating addresses...</span>
              </div>
            )}

            {/* Extraction Results Badges */}
            {leadSummary && (
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-gray-700">Leads Parsed:</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {extractedRecipients.length} Valid Leads
                    </span>
                    {leadSummary.duplicatesRemoved > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                        {leadSummary.duplicatesRemoved} Duplicates Skipped
                      </span>
                    )}
                    {leadSummary.invalidCount > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
                        {leadSummary.invalidCount} Invalid Skipped
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-gray-400 font-mono">
                    Total Candidates: {leadSummary.totalDetected}
                  </span>
                </div>

                {/* Recipient Chips Preview */}
                {extractedRecipients.length > 0 && (
                  <div className="pt-2 border-t border-gray-200">
                    <span className="text-[11px] text-gray-500 block mb-1">
                      Target Recipients ({extractedRecipients.length}):
                    </span>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
                      {extractedRecipients.slice(0, 40).map((email) => (
                        <span
                          key={email}
                          className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono bg-white border border-gray-200 text-gray-700"
                        >
                          <span>{email}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveLead(email)}
                            className="text-gray-400 hover:text-rose-600 ml-0.5 cursor-pointer"
                            title="Remove lead"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {extractedRecipients.length > 40 && (
                        <span className="text-[10px] text-gray-400 self-center">
                          +{extractedRecipients.length - 40} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {fieldErrors.recipients && (
              <p className="text-[11px] text-rose-600">{fieldErrors.recipients}</p>
            )}
          </div>
        )}

        {/* Subject */}
        <div className="space-y-1">
          <label htmlFor="subject-input" className="block text-xs font-semibold text-gray-700">
            Subject <span className="text-rose-500">*</span>
          </label>
          <input
            id="subject-input"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Outbox Sequence Update"
            disabled={loading}
            className={`w-full px-3 py-2 rounded-lg bg-white border ${
              fieldErrors.subject ? 'border-rose-400 focus:ring-rose-400' : 'border-gray-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500'
            } text-gray-900 text-xs focus:outline-none transition-colors`}
          />
          {fieldErrors.subject && (
            <p className="text-[11px] text-rose-600">{fieldErrors.subject}</p>
          )}
        </div>

        {/* Message Content */}
        <div className="space-y-1">
          <label htmlFor="body-input" className="block text-xs font-semibold text-gray-700">
            Body (Plain text / HTML) <span className="text-rose-500">*</span>
          </label>
          <textarea
            id="body-input"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your email body here. Supports HTML formatting or plain text..."
            disabled={loading}
            className={`w-full px-3 py-2 rounded-lg bg-white border ${
              fieldErrors.body ? 'border-rose-400 focus:ring-rose-400' : 'border-gray-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500'
            } text-gray-900 text-xs focus:outline-none transition-colors`}
          />
          {fieldErrors.body && (
            <p className="text-[11px] text-rose-600">{fieldErrors.body}</p>
          )}
        </div>

        {/* Batch Delivery Cadence (Visible in batch mode) */}
        {targetMode === 'batch' && (
          <div className="p-3.5 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
            <span className="block text-xs font-semibold text-gray-700">Delivery Cadence & Rate Limits</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="delay-input" className="block text-[11px] text-gray-600">
                  Delay Between Consecutive Emails (seconds)
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    id="delay-input"
                    type="number"
                    min="0"
                    max="3600"
                    value={delayBetweenEmailsSeconds}
                    onChange={(e) => setDelayBetweenEmailsSeconds(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-24 px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-800 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="text-[11px] text-gray-500">sec</span>
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="limit-input" className="block text-[11px] text-gray-600">
                  Hourly Sending Limit
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    id="limit-input"
                    type="number"
                    min="1"
                    max="1000"
                    value={hourlyRateLimit}
                    onChange={(e) => setHourlyRateLimit(Math.max(1, parseInt(e.target.value, 10) || 10))}
                    className="w-24 px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-800 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="text-[11px] text-gray-500">emails / hour</span>
                </div>
              </div>
            </div>

            {extractedRecipients.length > 0 && (
              <p className="text-[11px] text-gray-500">
                Sequence estimated to take ~<strong>{Math.round((extractedRecipients.length * delayBetweenEmailsSeconds) / 60)} minutes</strong> across {extractedRecipients.length} recipients.
              </p>
            )}
          </div>
        )}

        {/* Schedule Timing Options */}
        <div className="pt-2 border-t border-gray-100 space-y-3">
          <label className="block text-xs font-semibold text-gray-700">Timing</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setScheduleMode('now')}
              className={`p-3 rounded-lg border text-left transition-all flex items-start space-x-2.5 cursor-pointer ${
                scheduleMode === 'now'
                  ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500/20'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <div className={`w-3.5 h-3.5 rounded-full mt-0.5 border flex items-center justify-center ${
                scheduleMode === 'now' ? 'border-emerald-600 bg-emerald-600' : 'border-gray-300'
              }`}>
                {scheduleMode === 'now' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-900">Send Now</span>
                <span className="block text-[11px] text-gray-500 mt-0.5">
                  Queue for immediate background execution
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setScheduleMode('later')}
              className={`p-3 rounded-lg border text-left transition-all flex items-start space-x-2.5 cursor-pointer ${
                scheduleMode === 'later'
                  ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500/20'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <div className={`w-3.5 h-3.5 rounded-full mt-0.5 border flex items-center justify-center ${
                scheduleMode === 'later' ? 'border-emerald-600 bg-emerald-600' : 'border-gray-300'
              }`}>
                {scheduleMode === 'later' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-900">Schedule for Later</span>
                <span className="block text-[11px] text-gray-500 mt-0.5">
                  BullMQ delayed job targeting specific date/time
                </span>
              </div>
            </button>
          </div>

          {/* Date & Time Picker */}
          {scheduleMode === 'later' && (
            <div className="pt-1 space-y-1">
              <label htmlFor="scheduled-datetime-input" className="block text-xs font-semibold text-gray-700">
                Scheduled Execution Time <span className="text-rose-500">*</span>
              </label>
              <input
                id="scheduled-datetime-input"
                type="datetime-local"
                min={getMinDateTime()}
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={loading}
                className={`w-full sm:w-72 px-3 py-1.5 rounded-lg border ${
                  fieldErrors.scheduledAt ? 'border-rose-400' : 'border-gray-300'
                } bg-white text-gray-900 text-xs focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500`}
              />
              {fieldErrors.scheduledAt && (
                <p className="text-[11px] text-rose-600">{fieldErrors.scheduledAt}</p>
              )}
            </div>
          )}
        </div>

        {/* Collapsible Advanced Options (Hides raw idempotency key from normal view) */}
        <div className="pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-[11px] font-medium text-gray-500 hover:text-gray-800 flex items-center space-x-1.5 cursor-pointer"
          >
            <span>{showAdvanced ? '▾' : '▸'}</span>
            <span>Advanced Settings (Idempotency Key & Deduplication)</span>
          </button>

          {showAdvanced && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="idempotency-input" className="text-xs font-semibold text-gray-700">
                  {targetMode === 'batch' ? 'Batch Idempotency Key' : 'Idempotency Key'}
                </label>
                <button
                  type="button"
                  onClick={generateNewIdempotencyKey}
                  className="text-[11px] text-emerald-600 hover:text-emerald-700 font-medium cursor-pointer"
                >
                  Regenerate
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
                className="w-full px-2.5 py-1.5 font-mono text-xs rounded border border-gray-300 bg-white text-gray-800 focus:outline-none focus:border-emerald-500"
              />
              <p className="text-[10px] text-gray-500">
                Deterministic deduplication key. Duplicate submissions return the existing record safely.
              </p>
            </div>
          )}
        </div>

        {/* Primary Action Button */}
        <div className="pt-3 flex items-center justify-end">
          <button
            type="submit"
            disabled={loading || (targetMode === 'batch' && extractedRecipients.length === 0)}
            className="w-full sm:w-auto px-6 py-2.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white transition-colors shadow-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 cursor-pointer"
          >
            {loading ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
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
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                <span>
                  {targetMode === 'batch'
                    ? `Schedule ${extractedRecipients.length > 0 ? extractedRecipients.length : ''} Leads Campaign`
                    : scheduleMode === 'now'
                    ? 'Send Email Now'
                    : 'Schedule Email'}
                </span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
