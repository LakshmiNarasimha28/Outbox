import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';
import { EmailJobRecord, EmailStatus } from '../database/models/emailJob';

export interface ElasticsearchHealthStatus {
  connected: boolean;
  endpoint?: string;
  latencyMs?: number;
  error?: string;
  index?: string;
  clusterName?: string;
}

export interface SearchEmailParams {
  q?: string;
  status?: EmailStatus;
  sender?: string;
  recipient?: string;
  from?: string; // ISO date string for range filter
  to?: string;   // ISO date string for range filter
  page?: number; // 1-indexed page
  limit?: number; // items per page
  sortBy?: 'scheduled_at' | 'created_at' | 'sent_at';
  sortOrder?: 'asc' | 'desc';
  userId?: string;
}

export interface SearchEmailResult {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  emails: EmailJobRecord[];
  tookMs: number;
}

export interface IndexedEmailDocument {
  id: string;
  recipient: string;
  sender: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduled_at: string;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  failed_at: string | null;
  attempts: number;
  max_attempts: number;
  error_message: string | null;
  ethereal_message_id: string | null;
  ethereal_preview_url: string | null;
  idempotency_key: string | null;
  user_id: string | null;
}

/**
 * Explicit mapping for email jobs index.
 * Enables exact keyword filtering, full-text tokenized search on body & subject,
 * and range filtering on timestamps.
 */
export const EMAIL_INDEX_MAPPING = {
  properties: {
    id: { type: 'keyword' },
    recipient: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword', ignore_above: 256 },
      },
    },
    sender: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword', ignore_above: 256 },
      },
    },
    subject: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword', ignore_above: 256 },
      },
    },
    body: { type: 'text' },
    status: { type: 'keyword' },
    scheduled_at: { type: 'date' },
    created_at: { type: 'date' },
    updated_at: { type: 'date' },
    sent_at: { type: 'date' },
    failed_at: { type: 'date' },
    attempts: { type: 'integer' },
    max_attempts: { type: 'integer' },
    error_message: { type: 'text' },
    ethereal_message_id: { type: 'keyword' },
    ethereal_preview_url: { type: 'keyword', index: false },
    idempotency_key: { type: 'keyword' },
    user_id: { type: 'keyword' },
  },
};

export class ElasticsearchService {
  private static client: Client | null = null;
  private static indexInitialized = false;

  /**
   * Checks whether an Elasticsearch endpoint is configured in the environment or client is injected.
   */
  public static isConfigured(): boolean {
    return Boolean(this.client || env.ELASTICSEARCH_NODE);
  }

  /**
   * Returns a masked node URL for logging and telemetry reports without leaking credentials.
   */
  public static getMaskedEndpoint(): string {
    if (this.client && !env.ELASTICSEARCH_NODE) {
      return 'Injected/Mock Client';
    }
    if (!env.ELASTICSEARCH_NODE) {
      return 'Not configured';
    }
    try {
      const url = new URL(env.ELASTICSEARCH_NODE);
      const user = url.username ? `${url.username}:***@` : (env.ELASTICSEARCH_USERNAME ? `${env.ELASTICSEARCH_USERNAME}:***@` : '');
      return `${url.protocol}//${user}${url.host}`;
    } catch {
      return '[MASKED ELASTICSEARCH_NODE]';
    }
  }

  /**
   * Lazily initializes and returns the official @elastic/elasticsearch client.
   */
  public static getClient(): Client | null {
    if (this.client) {
      return this.client;
    }

    if (!env.ELASTICSEARCH_NODE) {
      return null;
    }

    const clientOptions: any = {
      node: env.ELASTICSEARCH_NODE,
      requestTimeout: env.ELASTICSEARCH_REQUEST_TIMEOUT_MS,
    };

    if (env.ELASTICSEARCH_API_KEY) {
      clientOptions.auth = { apiKey: env.ELASTICSEARCH_API_KEY };
    } else if (env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD) {
      clientOptions.auth = {
        username: env.ELASTICSEARCH_USERNAME,
        password: env.ELASTICSEARCH_PASSWORD,
      };
    }

    this.client = new Client(clientOptions);
    return this.client;
  }

  /**
   * Allows injecting a custom client (useful for unit testing and mocking).
   */
  public static setClient(customClient: Client | null): void {
    this.client = customClient;
    this.indexInitialized = false;
  }

  /**
   * Transforms a database record to an Elasticsearch document format with ISO dates.
   */
  public static toDocument(record: EmailJobRecord): IndexedEmailDocument {
    return {
      id: record.id,
      recipient: record.recipient,
      sender: record.sender,
      subject: record.subject,
      body: record.body,
      status: record.status,
      scheduled_at: new Date(record.scheduled_at).toISOString(),
      created_at: new Date(record.created_at).toISOString(),
      updated_at: new Date(record.updated_at).toISOString(),
      sent_at: record.sent_at ? new Date(record.sent_at).toISOString() : null,
      failed_at: record.failed_at ? new Date(record.failed_at).toISOString() : null,
      attempts: record.attempts,
      max_attempts: record.max_attempts,
      error_message: record.error_message || null,
      ethereal_message_id: record.ethereal_message_id || null,
      ethereal_preview_url: record.ethereal_preview_url || null,
      idempotency_key: record.idempotency_key || null,
      user_id: record.user_id || null,
    };
  }

  /**
   * Checks or initializes the index with its explicit schema mapping.
   */
  public static async initIndex(): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    if (this.indexInitialized) return true;

    const index = env.ELASTICSEARCH_INDEX;
    try {
      const exists = await client.indices.exists({ index });
      if (!exists) {
        await client.indices.create({
          index,
          mappings: EMAIL_INDEX_MAPPING as any,
        });
        console.log(`[Elasticsearch] Initialized index '${index}' with explicit mapping.`);
      }
      this.indexInitialized = true;
      return true;
    } catch (err) {
      console.warn(`[Elasticsearch Notice] Index initialization deferred:`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  /**
   * Checks Elasticsearch cluster connectivity and latency.
   */
  public static async checkHealth(): Promise<ElasticsearchHealthStatus> {
    const endpoint = this.getMaskedEndpoint();
    if (!this.isConfigured()) {
      return {
        connected: false,
        endpoint,
        error: 'Elasticsearch is not configured (ELASTICSEARCH_NODE not set)',
      };
    }

    const client = this.getClient();
    if (!client) {
      return {
        connected: false,
        endpoint,
        error: 'Elasticsearch client initialization failed',
      };
    }

    const start = Date.now();
    try {
      const info = await client.info();
      const latencyMs = Date.now() - start;
      return {
        connected: true,
        endpoint,
        latencyMs,
        index: env.ELASTICSEARCH_INDEX,
        clusterName: info.cluster_name,
      };
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Connection failed';
      // Redact passwords from error message
      const sanitized = rawMsg.replace(/([a-zA-Z0-9_-]+):([a-zA-Z0-9_\-~.+/%=]+)@/g, '$1:***@');
      return {
        connected: false,
        endpoint,
        error: sanitized,
      };
    }
  }

  /**
   * Indexes or updates an email record idempotently using document ID = record.id.
   * Never throws or interrupts caller execution on Elasticsearch errors.
   */
  public static async indexEmail(record: EmailJobRecord): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    const doc = this.toDocument(record);
    try {
      await this.initIndex();
      await client.index({
        index: env.ELASTICSEARCH_INDEX,
        id: record.id,
        document: doc,
      });
      return true;
    } catch (err) {
      console.warn(
        `[Elasticsearch Sync Warning] Failed to index email ${record.id}:`,
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }

  /**
   * Partially updates an indexed document when job lifecycle events occur (e.g. PROCESSING, SENT, FAILED).
   * Uses doc_as_upsert to avoid failures if the original document was not yet indexed.
   */
  public static async updateEmail(
    id: string,
    updates: Partial<EmailJobRecord>
  ): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    const docUpdates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.status) docUpdates.status = updates.status;
    if (updates.scheduled_at) docUpdates.scheduled_at = new Date(updates.scheduled_at).toISOString();
    if (updates.sent_at) docUpdates.sent_at = new Date(updates.sent_at).toISOString();
    if (updates.failed_at) docUpdates.failed_at = new Date(updates.failed_at).toISOString();
    if (updates.last_attempt_at) docUpdates.last_attempt_at = new Date(updates.last_attempt_at).toISOString();
    if (updates.attempts !== undefined) docUpdates.attempts = updates.attempts;
    if (updates.max_attempts !== undefined) docUpdates.max_attempts = updates.max_attempts;
    if (updates.error_message !== undefined) docUpdates.error_message = updates.error_message;
    if (updates.ethereal_message_id !== undefined) docUpdates.ethereal_message_id = updates.ethereal_message_id;
    if (updates.ethereal_preview_url !== undefined) docUpdates.ethereal_preview_url = updates.ethereal_preview_url;

    try {
      await client.update({
        index: env.ELASTICSEARCH_INDEX,
        id,
        doc: docUpdates,
        doc_as_upsert: true,
      });
      return true;
    } catch (err) {
      console.warn(
        `[Elasticsearch Sync Warning] Failed to update email ${id}:`,
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }

  /**
   * Builds an Elasticsearch bool query for search parameters.
   */
  public static buildSearchQuery(params: SearchEmailParams): any {
    const must: any[] = [];
    const filter: any[] = [];

    // 1. Free-text search across subject (weighted x3), body, recipient (weighted x2), sender
    if (params.q && params.q.trim().length > 0) {
      must.push({
        multi_match: {
          query: params.q.trim(),
          fields: ['subject^3', 'recipient^2', 'sender^2', 'body', 'error_message'],
          type: 'best_fields',
          fuzziness: 'AUTO',
        },
      });
    }

    // 2. Status filter
    if (params.status) {
      filter.push({ term: { status: params.status } });
    }

    // 3. Sender filter
    if (params.sender) {
      filter.push({
        term: { 'sender.keyword': params.sender.trim().toLowerCase() },
      });
    }

    // 4. Recipient filter
    if (params.recipient) {
      filter.push({
        term: { 'recipient.keyword': params.recipient.trim().toLowerCase() },
      });
    }

    // 5. Date range filter (from / to on scheduled_at)
    if (params.from || params.to) {
      const rangeClause: any = {};
      if (params.from) rangeClause.gte = new Date(params.from).toISOString();
      if (params.to) rangeClause.lte = new Date(params.to).toISOString();
      filter.push({ range: { scheduled_at: rangeClause } });
    }

    // 6. User tenant isolation filter
    if (params.userId) {
      filter.push({
        term: { user_id: params.userId },
      });
    }

    const query: any = {};
    if (must.length > 0 && filter.length > 0) {
      query.bool = { must, filter };
    } else if (must.length > 0) {
      query.bool = { must };
    } else if (filter.length > 0) {
      query.bool = { filter };
    } else {
      query.match_all = {};
    }

    return query;
  }

  /**
   * Searches email jobs using full-text querying, status filters, date ranges, and pagination.
   */
  public static async searchEmails(params: SearchEmailParams): Promise<SearchEmailResult> {
    const client = this.getClient();
    if (!client) {
      throw new Error(
        'Elasticsearch is not configured. Define ELASTICSEARCH_NODE in backend/.env to enable full-text search.'
      );
    }

    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const from = (page - 1) * limit;

    const query = this.buildSearchQuery(params);

    const sortField = params.sortBy ?? 'scheduled_at';
    const sortOrder = params.sortOrder ?? 'desc';
    const sort: any = [
      { [sortField]: { order: sortOrder } },
      { id: { order: 'asc' } }, // Deterministic secondary tie-breaker
    ];

    const response = await client.search<IndexedEmailDocument>({
      index: env.ELASTICSEARCH_INDEX,
      from,
      size: limit,
      query,
      sort,
    });

    const totalHits =
      typeof response.hits.total === 'number'
        ? response.hits.total
        : response.hits.total?.value ?? 0;

    const emails = response.hits.hits.map((hit) => hit._source as EmailJobRecord);

    return {
      total: totalHits,
      page,
      limit,
      totalPages: Math.ceil(totalHits / limit) || 1,
      emails,
      tookMs: response.took ?? 0,
    };
  }

  /**
   * Bulk indexes an array of records (used for batch reconciliation).
   */
  public static async bulkIndex(
    records: EmailJobRecord[]
  ): Promise<{ indexed: number; failed: number }> {
    const client = this.getClient();
    if (!client || records.length === 0) {
      return { indexed: 0, failed: 0 };
    }

    await this.initIndex();

    const operations = records.flatMap((record) => [
      { index: { _index: env.ELASTICSEARCH_INDEX, _id: record.id } },
      this.toDocument(record),
    ]);

    const bulkResponse = await client.bulk({ operations });
    let failed = 0;
    if (bulkResponse.errors) {
      for (const item of bulkResponse.items) {
        if (item.index && item.index.error) {
          failed++;
        }
      }
    }
    return {
      indexed: records.length - failed,
      failed,
    };
  }

  /**
   * Closes the client connection gracefully.
   */
  public static async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.indexInitialized = false;
    }
  }
}
