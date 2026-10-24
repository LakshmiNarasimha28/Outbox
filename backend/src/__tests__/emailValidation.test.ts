import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleEmailSchema, listEmailsQuerySchema } from '../validation/emailSchemas';

describe('Email Validation Schema Unit Tests', () => {
  it('should accept a valid email schedule payload', () => {
    const input = {
      recipient: 'developer@example.com',
      subject: 'Interview Confirmation',
      body: 'Your interview is scheduled for tomorrow at 10 AM.',
      scheduledAt: new Date(Date.now() + 60000).toISOString(),
      sender: 'hr@example.com',
      idempotencyKey: 'idem-test-12345',
    };

    const result = scheduleEmailSchema.safeParse(input);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.recipient, 'developer@example.com');
      assert.equal(result.data.subject, 'Interview Confirmation');
      assert.equal(result.data.idempotencyKey, 'idem-test-12345');
    }
  });

  it('should reject invalid recipient email format', () => {
    const input = {
      recipient: 'not-an-email',
      subject: 'Hello',
      body: 'World',
    };

    const result = scheduleEmailSchema.safeParse(input);
    assert.equal(result.success, false);
    if (!result.success) {
      const recipientIssue = result.error.issues.find((i) => i.path[0] === 'recipient');
      assert.ok(recipientIssue, 'Expected error on recipient field');
    }
  });

  it('should reject empty subject or empty body', () => {
    const input = {
      recipient: 'valid@example.com',
      subject: '   ',
      body: '',
    };

    const result = scheduleEmailSchema.safeParse(input);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path[0] === 'subject'));
      assert.ok(result.error.issues.some((i) => i.path[0] === 'body'));
    }
  });

  it('should reject invalid scheduledAt date format', () => {
    const input = {
      recipient: 'valid@example.com',
      subject: 'Test Subject',
      body: 'Test Body',
      scheduledAt: 'not-a-valid-date',
    };

    const result = scheduleEmailSchema.safeParse(input);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path[0] === 'scheduledAt'));
    }
  });

  it('should parse list query schema with valid status and pagination', () => {
    const query = {
      status: 'PENDING',
      limit: '25',
      offset: '50',
    };

    const result = listEmailsQuerySchema.safeParse(query);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.status, 'PENDING');
      assert.equal(result.data.limit, 25);
      assert.equal(result.data.offset, 50);
    }
  });

  it('should reject invalid status in query schema', () => {
    const query = {
      status: 'UNKNOWN_STATUS',
    };

    const result = listEmailsQuerySchema.safeParse(query);
    assert.equal(result.success, false);
  });
});
