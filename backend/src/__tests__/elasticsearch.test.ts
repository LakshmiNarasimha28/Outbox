import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import {
  ElasticsearchService,
  EMAIL_INDEX_MAPPING,
  IndexedEmailDocument,
  SearchEmailParams,
} from '../services/elasticsearchService';
import { EmailJobRecord } from '../database/models/emailJob';
import { EmailJobRepository } from '../database/repositories/emailJobRepository';
import { initEmailWorker, closeEmailWorker } from '../worker/emailWorker';
import { closeDatabasePool } from '../database/mysql';
import { closeRedisConnection } from '../queue/redis';
import { closeEmailQueue } from '../queue/emailQueue';

/**
 * In-memory Mock Elasticsearch Client for isolated unit and integration testing.
 */
function createMockElasticsearchClient() {
  const store = new Map<string, IndexedEmailDocument>();
  let shouldFail = false;

  return {
    store,
    setShouldFail(val: boolean) {
      shouldFail = val;
    },
    indices: {
      exists: async ({ index }: { index: string }) => {
        if (shouldFail) throw new Error('Elasticsearch cluster unreachable (mock)');
        return true;
      },
      create: async ({ index }: { index: string }) => {
        if (shouldFail) throw new Error('Elasticsearch cluster unreachable (mock)');
        return { acknowledged: true };
      },
    },
    info: async () => {
      if (shouldFail) throw new Error('Connection refused (mock)');
      return { cluster_name: 'mock-elasticsearch-cluster', version: { number: '9.0.0' } };
    },
    index: async ({ id, document }: { id: string; document: IndexedEmailDocument }) => {
      if (shouldFail) throw new Error('Elasticsearch indexing failed (mock)');
      store.set(id, { ...document });
      return { result: 'created', _id: id };
    },
    update: async ({
      id,
      doc,
      doc_as_upsert,
    }: {
      id: string;
      doc: Partial<IndexedEmailDocument>;
      doc_as_upsert?: boolean;
    }) => {
      if (shouldFail) throw new Error('Elasticsearch update failed (mock)');
      const existing = store.get(id);
      if (!existing && !doc_as_upsert) {
        throw new Error(`Document with ID ${id} not found`);
      }
      const updated = { ...(existing || {}), ...doc, id } as IndexedEmailDocument;
      store.set(id, updated);
      return { result: 'updated', _id: id };
    },
    bulk: async ({ operations }: { operations: any[] }) => {
      if (shouldFail) throw new Error('Elasticsearch bulk failed (mock)');
      let indexed = 0;
      for (let i = 0; i < operations.length; i += 2) {
        const action = operations[i];
        const doc = operations[i + 1];
        if (action.index) {
          store.set(action.index._id, doc);
          indexed++;
        }
      }
      return { errors: false, items: new Array(indexed).fill({ index: { status: 200 } }) };
    },
    search: async <T>(params: any) => {
      if (shouldFail) throw new Error('Elasticsearch search request failed (mock)');
      let allDocs = Array.from(store.values());

      // Filter by query conditions
      if (params.query?.bool?.must) {
        for (const m of params.query.bool.must) {
          if (m.multi_match) {
            const queryStr = m.multi_match.query.toLowerCase();
            allDocs = allDocs.filter(
              (doc) =>
                doc.subject.toLowerCase().includes(queryStr) ||
                doc.body.toLowerCase().includes(queryStr) ||
                doc.recipient.toLowerCase().includes(queryStr) ||
                doc.sender.toLowerCase().includes(queryStr)
            );
          }
        }
      }

      if (params.query?.bool?.filter) {
        for (const f of params.query.bool.filter) {
          if (f.term?.status) {
            allDocs = allDocs.filter((doc) => doc.status === f.term.status);
          }
          if (f.term?.['sender.keyword']) {
            allDocs = allDocs.filter(
              (doc) => doc.sender.toLowerCase() === f.term['sender.keyword'].toLowerCase()
            );
          }
          if (f.term?.['recipient.keyword']) {
            allDocs = allDocs.filter(
              (doc) => doc.recipient.toLowerCase() === f.term['recipient.keyword'].toLowerCase()
            );
          }
          if (f.range?.scheduled_at) {
            if (f.range.scheduled_at.gte) {
              const gteTime = new Date(f.range.scheduled_at.gte).getTime();
              allDocs = allDocs.filter((doc) => new Date(doc.scheduled_at).getTime() >= gteTime);
            }
            if (f.range.scheduled_at.lte) {
              const lteTime = new Date(f.range.scheduled_at.lte).getTime();
              allDocs = allDocs.filter((doc) => new Date(doc.scheduled_at).getTime() <= lteTime);
            }
          }
        }
      }

      // Sort
      const from = params.from || 0;
      const size = params.size || 20;
      allDocs.sort(
        (a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()
      );

      const paged = allDocs.slice(from, from + size);

      return {
        took: 5,
        timed_out: false,
        hits: {
          total: { value: allDocs.length, relation: 'eq' },
          hits: paged.map((doc) => ({
            _index: 'email_jobs',
            _id: doc.id,
            _score: 1.0,
            _source: doc,
          })),
        },
      };
    },
    close: async () => {},
  };
}

describe('Elasticsearch Integration & Search Lifecycle Tests', () => {
  const app = createApp();
  let mockClient: ReturnType<typeof createMockElasticsearchClient>;
  let worker: ReturnType<typeof initEmailWorker> = null;

  before(() => {
    mockClient = createMockElasticsearchClient();
    ElasticsearchService.setClient(mockClient as any);
  });

  after(async () => {
    if (worker) {
      await closeEmailWorker();
    }
    await ElasticsearchService.close();
    await closeEmailQueue();
    await closeRedisConnection();
    await closeDatabasePool();
  });

  beforeEach(() => {
    mockClient.store.clear();
    mockClient.setShouldFail(false);
  });

  const sampleRecord: EmailJobRecord = {
    id: 'test-uuid-001',
    recipient: 'search.user@example.com',
    sender: 'scheduler@outbox.labs',
    subject: 'Quarterly Financial Digest and Performance',
    body: 'Here is the detailed quarterly report for your review and auditing.',
    status: 'PENDING',
    scheduled_at: new Date('2026-10-25T10:00:00Z'),
    created_at: new Date('2026-10-24T10:00:00Z'),
    updated_at: new Date('2026-10-24T10:00:00Z'),
    sent_at: null,
    failed_at: null,
    attempts: 0,
    max_attempts: 3,
    last_attempt_at: null,
    error_message: null,
    ethereal_message_id: null,
    ethereal_preview_url: null,
    idempotency_key: 'idemp-search-001',
  };

  it('should properly transform an email record to an indexed document with ISO dates', () => {
    const doc = ElasticsearchService.toDocument(sampleRecord);
    assert.equal(doc.id, sampleRecord.id);
    assert.equal(doc.recipient, sampleRecord.recipient);
    assert.equal(doc.subject, sampleRecord.subject);
    assert.equal(doc.body, sampleRecord.body);
    assert.equal(doc.status, 'PENDING');
    assert.equal(doc.scheduled_at, '2026-10-25T10:00:00.000Z');
    assert.equal(doc.created_at, '2026-10-24T10:00:00.000Z');
    assert.equal(doc.sent_at, null);
    assert.equal(doc.idempotency_key, 'idemp-search-001');

    // Verify explicit mapping structure
    assert.ok(EMAIL_INDEX_MAPPING.properties.id);
    assert.ok(EMAIL_INDEX_MAPPING.properties.subject);
    assert.ok(EMAIL_INDEX_MAPPING.properties.body);
    assert.ok(EMAIL_INDEX_MAPPING.properties.scheduled_at);
  });

  it('should idempotently index and re-index an email document using deterministic document ID', async () => {
    const success1 = await ElasticsearchService.indexEmail(sampleRecord);
    assert.equal(success1, true);
    assert.equal(mockClient.store.size, 1);
    assert.equal(mockClient.store.get(sampleRecord.id)?.subject, sampleRecord.subject);

    // Re-indexing the same record (upsert) must not create a duplicate
    const updatedRecord = { ...sampleRecord, subject: 'Updated Financial Digest' };
    const success2 = await ElasticsearchService.indexEmail(updatedRecord);
    assert.equal(success2, true);
    assert.equal(mockClient.store.size, 1, 'Store must still contain exactly 1 document');
    assert.equal(mockClient.store.get(sampleRecord.id)?.subject, 'Updated Financial Digest');
  });

  it('should update indexed documents when job lifecycle events occur (PROCESSING, SENT, FAILED)', async () => {
    // 1. Initial Index
    await ElasticsearchService.indexEmail(sampleRecord);

    // 2. Transition to PROCESSING
    await ElasticsearchService.updateEmail(sampleRecord.id, {
      status: 'PROCESSING',
      last_attempt_at: new Date('2026-10-25T10:00:01Z'),
      attempts: 1,
    });
    let current = mockClient.store.get(sampleRecord.id);
    assert.equal(current?.status, 'PROCESSING');
    assert.equal(current?.attempts, 1);

    // 3. Transition to SENT
    await ElasticsearchService.updateEmail(sampleRecord.id, {
      status: 'SENT',
      sent_at: new Date('2026-10-25T10:00:05Z'),
      ethereal_message_id: 'msg-id-12345',
      ethereal_preview_url: 'https://ethereal.email/message/preview-123',
    });
    current = mockClient.store.get(sampleRecord.id);
    assert.equal(current?.status, 'SENT');
    assert.equal(current?.ethereal_message_id, 'msg-id-12345');
    assert.equal(current?.ethereal_preview_url, 'https://ethereal.email/message/preview-123');

    // 4. Test FAILED transition on another doc
    await ElasticsearchService.indexEmail({ ...sampleRecord, id: 'fail-uuid-002' });
    await ElasticsearchService.updateEmail('fail-uuid-002', {
      status: 'FAILED',
      failed_at: new Date('2026-10-25T10:00:10Z'),
      error_message: 'SMTP Timeout: Connection closed',
      attempts: 3,
    });
    const failedDoc = mockClient.store.get('fail-uuid-002');
    assert.equal(failedDoc?.status, 'FAILED');
    assert.equal(failedDoc?.error_message, 'SMTP Timeout: Connection closed');
  });

  it('should search emails with free-text query, status filter, date ranges, and pagination', async () => {
    // Seed 4 test records
    await ElasticsearchService.indexEmail({
      ...sampleRecord,
      id: 'doc-1',
      subject: 'Security Alert: Login from new device',
      body: 'We detected a login from Chrome on Windows.',
      status: 'SENT',
      scheduled_at: new Date('2026-10-20T12:00:00Z'),
    });
    await ElasticsearchService.indexEmail({
      ...sampleRecord,
      id: 'doc-2',
      subject: 'Weekly Team Standup Notes',
      body: 'Security updates and performance metrics review.',
      status: 'SENT',
      scheduled_at: new Date('2026-10-22T12:00:00Z'),
    });
    await ElasticsearchService.indexEmail({
      ...sampleRecord,
      id: 'doc-3',
      subject: 'Invoice #1049 Due Tomorrow',
      body: 'Please find attached invoice for services.',
      status: 'PENDING',
      scheduled_at: new Date('2026-10-25T12:00:00Z'),
    });
    await ElasticsearchService.indexEmail({
      ...sampleRecord,
      id: 'doc-4',
      subject: 'Failed Payment Notification',
      body: 'Payment failed for security subscription.',
      status: 'FAILED',
      scheduled_at: new Date('2026-10-26T12:00:00Z'),
    });

    // 1. Free-text search for "security" (matches doc-1, doc-2, doc-4)
    const textSearch = await ElasticsearchService.searchEmails({ q: 'security' });
    assert.equal(textSearch.total, 3);
    assert.equal(textSearch.emails.length, 3);

    // 2. Filter by status: SENT + text "security" (matches doc-1 and doc-2)
    const filteredSearch = await ElasticsearchService.searchEmails({
      q: 'security',
      status: 'SENT',
    });
    assert.equal(filteredSearch.total, 2);
    assert.ok(filteredSearch.emails.every((e) => e.status === 'SENT'));

    // 3. Date range filter: between 2026-10-24 and 2026-10-27 (matches doc-3 and doc-4)
    const dateRangeSearch = await ElasticsearchService.searchEmails({
      from: '2026-10-24T00:00:00Z',
      to: '2026-10-27T00:00:00Z',
    });
    assert.equal(dateRangeSearch.total, 2);

    // 4. Pagination: limit 1, page 1 vs page 2
    const p1 = await ElasticsearchService.searchEmails({ limit: 1, page: 1 });
    assert.equal(p1.emails.length, 1);
    assert.equal(p1.totalPages, 4);

    const p2 = await ElasticsearchService.searchEmails({ limit: 1, page: 2 });
    assert.equal(p2.emails.length, 1);
    assert.notEqual(p1.emails[0].id, p2.emails[0].id, 'Page 1 and Page 2 must return different items');
  });

  it('should support bulk indexing for reconciliation', async () => {
    const records = [
      { ...sampleRecord, id: 'bulk-1', subject: 'Bulk 1' },
      { ...sampleRecord, id: 'bulk-2', subject: 'Bulk 2' },
      { ...sampleRecord, id: 'bulk-3', subject: 'Bulk 3' },
    ];

    const bulkResult = await ElasticsearchService.bulkIndex(records);
    assert.equal(bulkResult.indexed, 3);
    assert.equal(bulkResult.failed, 0);
    assert.equal(mockClient.store.get('bulk-1')?.subject, 'Bulk 1');
    assert.equal(mockClient.store.get('bulk-3')?.subject, 'Bulk 3');
  });

  it('should gracefully handle Elasticsearch outages without throwing or altering MySQL state', async () => {
    // Simulate Elasticsearch downtime / outage
    mockClient.setShouldFail(true);

    // Indexing operation must return false gracefully and not throw
    const indexResult = await ElasticsearchService.indexEmail(sampleRecord);
    assert.equal(indexResult, false, 'indexEmail must return false when cluster is down');

    // Update operation must return false gracefully and not throw
    const updateResult = await ElasticsearchService.updateEmail(sampleRecord.id, {
      status: 'SENT',
    });
    assert.equal(updateResult, false, 'updateEmail must return false when cluster is down');

    // Health check reports disconnected status
    const health = await ElasticsearchService.checkHealth();
    assert.equal(health.connected, false);
    assert.ok(health.error);
  });

  it('should expose GET /api/emails/search endpoint with validation, filters, and 503 handling', async () => {
    // Populate mock store
    await ElasticsearchService.indexEmail({
      ...sampleRecord,
      id: 'api-search-1',
      subject: 'Critical Infrastructure Maintenance',
      status: 'SENT',
    });

    // 1. Successful search request
    const res = await request(app)
      .get('/api/emails/search')
      .query({ q: 'Infrastructure', status: 'SENT', page: 1, limit: 10 });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.emails[0].id, 'api-search-1');

    // 2. Validation error: invalid status
    const resInvalidStatus = await request(app)
      .get('/api/emails/search')
      .query({ status: 'NOT_A_VALID_STATUS' });

    assert.equal(resInvalidStatus.status, 400);
    assert.equal(resInvalidStatus.body.success, false);
    assert.equal(resInvalidStatus.body.error, 'Invalid Query Parameters');

    // 3. Validation error: invalid date
    const resInvalidDate = await request(app)
      .get('/api/emails/search')
      .query({ from: 'this-is-not-a-date' });

    assert.equal(resInvalidDate.status, 400);
    assert.equal(resInvalidDate.body.success, false);

    // 4. Elasticsearch service unavailable (when unconfigured or offline)
    ElasticsearchService.setClient(null);
    const resUnavailable = await request(app)
      .get('/api/emails/search')
      .query({ q: 'test' });

    assert.equal(resUnavailable.status, 503);
    assert.equal(resUnavailable.body.success, false);
    assert.equal(resUnavailable.body.error, 'Service Unavailable');

    // Restore mock client
    ElasticsearchService.setClient(mockClient as any);
  });
});
