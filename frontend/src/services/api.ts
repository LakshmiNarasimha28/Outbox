import type {
  ScheduleEmailPayload,
  ScheduleEmailResponse,
  EmailListResponse,
  EmailDetailResponse,
  SearchEmailParams,
  SearchEmailResponse,
  HealthResponse,
  AuthMeResponse,
  SlackStatusResponse,
  QueueTelemetryResponse,
  ParseLeadsResponse,
  ScheduleBatchPayload,
  ScheduleBatchResponse,
} from '../types/email';

const API_BASE = '/api';

export class ApiError extends Error {
  public status: number;
  public details?: { field: string; message: string }[];

  constructor(message: string, status: number, details?: { field: string; message: string }[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `${API_BASE}/${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include', // Automatically send and receive HttpOnly session cookies
    });
  } catch (netErr) {
    throw new ApiError(
      netErr instanceof Error ? `Network error: ${netErr.message}` : 'Network connection failed',
      0
    );
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const errorMsg = data?.error || data?.message || `HTTP ${response.status}: ${response.statusText}`;
    throw new ApiError(errorMsg, response.status, data?.details);
  }

  return data as T;
}

export const api = {
  /**
   * Schedule a new email job with MySQL persistence and BullMQ queueing.
   */
  async scheduleEmail(payload: ScheduleEmailPayload): Promise<ScheduleEmailResponse> {
    return request<ScheduleEmailResponse>('/api/emails/schedule', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Parse CSV or plain-text file content for lead detection and duplicate handling.
   */
  async parseLeads(content: string): Promise<ParseLeadsResponse> {
    return request<ParseLeadsResponse>('/api/emails/parse-leads', {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  /**
   * Schedule a batch of leads with staggered delays, persistence, and rate limiting.
   */
  async scheduleBatch(payload: ScheduleBatchPayload): Promise<ScheduleBatchResponse> {
    return request<ScheduleBatchResponse>('/api/emails/schedule-batch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Fetch currently scheduled (PENDING or PROCESSING) email jobs.
   */
  async getScheduledEmails(limit = 50, offset = 0): Promise<EmailListResponse> {
    return request<EmailListResponse>(`/api/emails/scheduled?limit=${limit}&offset=${offset}`, {
      method: 'GET',
    });
  },

  /**
   * Fetch completed (SENT, FAILED, CANCELLED) email delivery history.
   */
  async getEmailHistory(limit = 50, offset = 0): Promise<EmailListResponse> {
    return request<EmailListResponse>(`/api/emails/history?limit=${limit}&offset=${offset}`, {
      method: 'GET',
    });
  },

  /**
   * Fetch single email details by ID.
   */
  async getEmailById(id: string): Promise<EmailDetailResponse> {
    return request<EmailDetailResponse>(`/api/emails/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  },

  /**
   * Search email jobs via Elasticsearch full-text query and filters.
   */
  async searchEmails(params: SearchEmailParams): Promise<SearchEmailResponse> {
    const searchParams = new URLSearchParams();
    if (params.q) searchParams.append('q', params.q);
    if (params.status) searchParams.append('status', params.status);
    if (params.sender) searchParams.append('sender', params.sender);
    if (params.recipient) searchParams.append('recipient', params.recipient);
    if (params.from) searchParams.append('from', params.from);
    if (params.to) searchParams.append('to', params.to);
    if (params.page) searchParams.append('page', params.page.toString());
    if (params.limit) searchParams.append('limit', params.limit.toString());
    if (params.sortBy) searchParams.append('sortBy', params.sortBy);
    if (params.sortOrder) searchParams.append('sortOrder', params.sortOrder);

    const queryString = searchParams.toString();
    const endpoint = queryString ? `/api/emails/search?${queryString}` : '/api/emails/search';

    return request<SearchEmailResponse>(endpoint, {
      method: 'GET',
    });
  },

  /**
   * Query full system diagnostics (Server, MySQL, Hosted Redis, Elasticsearch).
   */
  async getHealth(): Promise<HealthResponse> {
    return request<HealthResponse>('/health', {
      method: 'GET',
    });
  },

  /**
   * Fetch current authenticated user and session status.
   */
  async getMe(): Promise<AuthMeResponse> {
    return request<AuthMeResponse>('/api/auth/me', {
      method: 'GET',
    });
  },

  /**
   * Log out of current session and clear session cookie.
   */
  async logout(): Promise<{ success: boolean; message: string }> {
    return request<{ success: boolean; message: string }>('/api/auth/logout', {
      method: 'POST',
    });
  },

  /**
   * Initiates Google OAuth login by redirecting the browser.
   */
  loginWithGoogle(): void {
    window.location.href = '/api/auth/google';
  },

  /**
   * Fetch current Slack connection status and channel metadata.
   */
  async getSlackStatus(): Promise<SlackStatusResponse> {
    return request<SlackStatusResponse>('/api/slack/status', {
      method: 'GET',
    });
  },

  /**
   * Initiates Slack OAuth v2 flow by redirecting the browser.
   */
  connectSlack(): void {
    window.location.href = '/api/slack/authorize';
  },

  /**
   * Disconnects current Slack workspace integration.
   */
  async disconnectSlack(): Promise<{ success: boolean; message: string }> {
    return request<{ success: boolean; message: string }>('/api/slack/disconnect', {
      method: 'POST',
    });
  },

  /**
   * Sends a real test hourly rate-limit alert to the connected Slack channel.
   */
  async testSlackNotification(): Promise<{ success: boolean; message: string; details?: any }> {
    return request<{ success: boolean; message: string; details?: any }>(
      '/api/slack/test-notification',
      {
        method: 'POST',
      }
    );
  },

  /**
   * Fetch live BullMQ queue telemetry and job counts.
   */
  async getQueueStats(): Promise<QueueTelemetryResponse> {
    return request<QueueTelemetryResponse>('/api/queues/stats', {
      method: 'GET',
    });
  },
};
