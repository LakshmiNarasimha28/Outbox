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
  };
}
