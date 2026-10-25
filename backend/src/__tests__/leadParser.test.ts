import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseLeads, isValidEmail } from '../utils/leadParser';

describe('Lead Parser Utility Tests', () => {
  it('should validate RFC-compliant email addresses correctly', () => {
    assert.strictEqual(isValidEmail('user@example.com'), true);
    assert.strictEqual(isValidEmail('first.last+tag@sub.domain.org'), true);
    assert.strictEqual(isValidEmail('sales_rep-1@company.co.uk'), true);

    assert.strictEqual(isValidEmail(''), false);
    assert.strictEqual(isValidEmail('invalid-plain-text'), false);
    assert.strictEqual(isValidEmail('@missing-user.com'), false);
    assert.strictEqual(isValidEmail('user@'), false);
    assert.strictEqual(isValidEmail('user@domain'), false);
    assert.strictEqual(isValidEmail('user@.com'), false);
  });

  it('should handle empty or whitespace-only input gracefully', () => {
    const emptyResult = parseLeads('');
    assert.strictEqual(emptyResult.isEmpty, true);
    assert.strictEqual(emptyResult.totalDetected, 0);
    assert.strictEqual(emptyResult.validLeads.length, 0);
    assert.strictEqual(emptyResult.duplicatesRemoved, 0);
    assert.strictEqual(emptyResult.invalidCount, 0);

    const whitespaceResult = parseLeads('   \n\r\n   \t  ');
    assert.strictEqual(whitespaceResult.isEmpty, true);
    assert.strictEqual(whitespaceResult.validLeads.length, 0);
  });

  it('should parse structured CSV with email header column', () => {
    const csvContent = `Name,Email,Company
Alice Smith,alice@example.com,Acme Corp
Bob Jones,bob@example.com,Beta LLC
Charlie Brown,charlie@outbox.labs,Gamma Inc`;

    const result = parseLeads(csvContent);
    assert.strictEqual(result.isEmpty, false);
    assert.strictEqual(result.totalDetected, 3);
    assert.strictEqual(result.validLeads.length, 3);
    assert.deepStrictEqual(result.validLeads, [
      'alice@example.com',
      'bob@example.com',
      'charlie@outbox.labs',
    ]);
    assert.strictEqual(result.duplicatesRemoved, 0);
    assert.strictEqual(result.invalidCount, 0);
  });

  it('should parse headless CSV and quoted columns', () => {
    const csvContent = `"Doe, Jane",jane@example.com,"San Francisco, CA"
"Public, John",john@example.com,"New York, NY"`;

    const result = parseLeads(csvContent);
    assert.strictEqual(result.validLeads.length, 2);
    assert.strictEqual(result.validLeads[0], 'jane@example.com');
    assert.strictEqual(result.validLeads[1], 'john@example.com');
  });

  it('should parse plain-text lists with mixed newlines, commas, and semicolons', () => {
    const textContent = `lead1@example.com, lead2@example.com; lead3@example.com
lead4@example.com
lead5@example.com\tlead6@example.com`;

    const result = parseLeads(textContent);
    assert.strictEqual(result.validLeads.length, 6);
    assert.strictEqual(result.validLeads[0], 'lead1@example.com');
    assert.strictEqual(result.validLeads[5], 'lead6@example.com');
  });

  it('should deduplicate emails case-insensitively and report duplicates', () => {
    const textContent = `lead@example.com
LEAD@EXAMPLE.COM
Lead@Example.Com
other@example.com
other@example.com`;

    const result = parseLeads(textContent);
    assert.strictEqual(result.validLeads.length, 2);
    assert.deepStrictEqual(result.validLeads, ['lead@example.com', 'other@example.com']);
    assert.strictEqual(result.duplicatesRemoved, 3);
    assert.strictEqual(result.duplicateSamples.includes('lead@example.com'), true);
  });

  it('should identify invalid email addresses and report invalid counts and samples', () => {
    const textContent = `valid@example.com
not-an-email@
another.valid@outbox.labs
broken-domain@.com
third@valid.org`;

    const result = parseLeads(textContent);
    assert.strictEqual(result.validLeads.length, 3);
    assert.strictEqual(result.invalidCount, 2);
    assert.strictEqual(result.invalidSamples.length, 2);
    assert.deepStrictEqual(result.validLeads, [
      'valid@example.com',
      'another.valid@outbox.labs',
      'third@valid.org',
    ]);
  });
});
