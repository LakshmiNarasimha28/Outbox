import type {
  ScheduleEmailPayload,
  ScheduleEmailResponse,
  EmailListResponse,
  EmailDetailResponse,
  SearchEmailParams,
  SearchEmailResponse,
  HealthResponse,
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
    response = await fetch(url, { ...options, headers });
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
};
