export type EmailStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface EmailJobRecord {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  sender: string;
  scheduled_at: string;
  status: EmailStatus;
  idempotency_key: string | null;
  attempts: number;
  max_attempts: number;
  last_attempt_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
  error_message: string | null;
  ethereal_message_id: string | null;
  ethereal_preview_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleEmailPayload {
  recipient: string;
  subject: string;
  body: string;
  scheduledAt?: string;
  sender?: string;
  idempotencyKey?: string;
}

export interface ScheduleEmailResponse {
  success: boolean;
  message: string;
  jobId?: string;
  idempotent?: boolean;
  email: EmailJobRecord;
  error?: string;
  details?: { field: string; message: string }[];
}

export interface EmailListResponse {
  success: boolean;
  total: number;
  count: number;
  limit: number;
  offset: number;
  emails: EmailJobRecord[];
}

export interface EmailDetailResponse {
  success: boolean;
  email: EmailJobRecord;
  error?: string;
  message?: string;
}

export interface SearchEmailParams {
  q?: string;
  status?: EmailStatus;
  sender?: string;
  recipient?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  sortBy?: 'scheduled_at' | 'created_at' | 'sent_at';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchEmailResponse {
  success: boolean;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  emails: EmailJobRecord[];
  tookMs: number;
  error?: string;
  message?: string;
}

export interface ServiceStatus {
  connected: boolean;
  latencyMs?: number;
  error?: string;
  database?: string;
  user?: string;
  host?: string;
  endpoint?: string;
  index?: string;
  clusterName?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  version: string;
  services: {
    server: {
      status: 'healthy';
      port: number;
      nodeVersion: string;
    };
    database: ServiceStatus;
    redis: ServiceStatus;
    elasticsearch?: ServiceStatus;
    googleAuth?: {
      configured: boolean;
      callbackUrl: string;
    };
    slack?: {
      configured: boolean;
      callbackUrl: string;
      cooldownSeconds: number;
    };
  };
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
}

export interface AuthMeResponse {
  success: boolean;
  authenticated: boolean;
  user: AuthUser | null;
}

export interface SlackIntegrationInfo {
  teamId: string;
  teamName: string;
  channelId: string | null;
  channelName: string | null;
  sender: string;
  status: 'ACTIVE' | 'REVOKED' | 'DISCONNECTED';
  connectedAt: string;
}

export interface SlackStatusResponse {
  success: boolean;
  configured: boolean;
  connected: boolean;
  isRevoked?: boolean;
  message?: string;
  integration: SlackIntegrationInfo | null;
}

export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface QueueTelemetryResponse {
  success: boolean;
  available: boolean;
  queueName: string;
  counts: QueueCounts;
  isPaused: boolean;
  dashboardUrl: string;
  error?: string;
}

export interface ParseLeadsResponse {
  success: boolean;
  totalDetected: number;
  validLeads: string[];
  duplicatesRemoved: number;
  duplicateSamples: string[];
  invalidCount: number;
  invalidSamples: string[];
  isEmpty: boolean;
}

export interface ScheduleBatchPayload {
  recipients: string[];
  subject: string;
  body: string;
  sender?: string;
  startTime?: string;
  delayBetweenEmailsSeconds?: number;
  hourlyRateLimit?: number;
  batchIdempotencyKey?: string;
}

export interface ScheduleBatchResponse {
  success: boolean;
  message: string;
  totalRequested: number;
  scheduledCount: number;
  idempotentCount: number;
  delayBetweenEmailsSeconds: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
  jobIds: string[];
  emails: EmailJobRecord[];
  error?: string;
  details?: { field: string; message: string }[];
}
