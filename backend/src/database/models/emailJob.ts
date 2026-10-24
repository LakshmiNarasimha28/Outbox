export type EmailStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface EmailJobRecord {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  sender: string;
  scheduled_at: Date | string;
  status: EmailStatus;
  idempotency_key: string | null;
  attempts: number;
  max_attempts: number;
  last_attempt_at: Date | string | null;
  sent_at: Date | string | null;
  failed_at: Date | string | null;
  error_message: string | null;
  ethereal_message_id: string | null;
  ethereal_preview_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CreateEmailJobInput {
  id?: string;
  recipient: string;
  subject: string;
  body: string;
  sender?: string;
  scheduled_at: Date;
  idempotency_key?: string | null;
  max_attempts?: number;
}
