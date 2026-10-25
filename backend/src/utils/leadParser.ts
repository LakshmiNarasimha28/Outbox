/**
 * Lead Parser Utility for Outbox Labs Email Scheduler.
 *
 * Extracts, validates, deduplicates, and classifies email addresses from
 * CSV files and plain-text inputs (comma, semicolon, newline, or tab delimited).
 */

export interface LeadParseResult {
  totalDetected: number;
  validLeads: string[];
  duplicatesRemoved: number;
  duplicateSamples: string[];
  invalidCount: number;
  invalidSamples: string[];
  isEmpty: boolean;
}

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const EMAIL_FINDER_REGEX = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g;

/**
 * Parses a single CSV line taking quotes into account.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Checks if a string looks like a CSV header row containing an email column.
 */
function findEmailColumnIndex(headerFields: string[]): number {
  const headerPatterns = [
    /^email$/i,
    /^e-mail$/i,
    /^email[-_ ]?address$/i,
    /^recipient$/i,
    /^recipient[-_ ]?email$/i,
    /^contact$/i,
    /^contact[-_ ]?email$/i,
  ];

  for (let i = 0; i < headerFields.length; i++) {
    const field = headerFields[i].replace(/^["']|["']$/g, '').trim();
    if (headerPatterns.some((pattern) => pattern.test(field))) {
      return i;
    }
  }
  return -1;
}

/**
 * Validates a single candidate email string.
 */
export function isValidEmail(candidate: string): boolean {
  if (!candidate || candidate.length > 254) return false;
  return EMAIL_REGEX.test(candidate.trim());
}

/**
 * Parses raw text or CSV content and returns structured lead metrics.
 */
export function parseLeads(rawContent: string): LeadParseResult {
  if (!rawContent || rawContent.trim().length === 0) {
    return {
      totalDetected: 0,
      validLeads: [],
      duplicatesRemoved: 0,
      duplicateSamples: [],
      invalidCount: 0,
      invalidSamples: [],
      isEmpty: true,
    };
  }

  const seenEmails = new Set<string>();
  const validLeads: string[] = [];
  const duplicateSamples: string[] = [];
  const invalidSamples: string[] = [];
  let duplicatesRemoved = 0;
  let invalidCount = 0;
  let totalDetected = 0;

  // Split into lines normalized for CRLF and LF
  const lines = rawContent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      totalDetected: 0,
      validLeads: [],
      duplicatesRemoved: 0,
      duplicateSamples: [],
      invalidCount: 0,
      invalidSamples: [],
      isEmpty: true,
    };
  }

  // Check if first line is a CSV header
  const firstLineFields = parseCsvLine(lines[0]);
  const emailColIdx = findEmailColumnIndex(firstLineFields);

  const startLineIndex = emailColIdx !== -1 ? 1 : 0;

  if (emailColIdx !== -1 && lines.length > 1) {
    // Mode A: Structured CSV with email header
    for (let i = startLineIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const fields = parseCsvLine(line);
      const candidate = fields[emailColIdx]?.replace(/^["']|["']$/g, '').trim();

      if (!candidate) continue;
      totalDetected++;

      if (isValidEmail(candidate)) {
        const normalized = candidate.toLowerCase();
        if (seenEmails.has(normalized)) {
          duplicatesRemoved++;
          if (duplicateSamples.length < 5) {
            duplicateSamples.push(normalized);
          }
        } else {
          seenEmails.add(normalized);
          validLeads.push(normalized);
        }
      } else {
        invalidCount++;
        if (invalidSamples.length < 5) {
          invalidSamples.push(candidate.slice(0, 50));
        }
      }
    }
  } else {
    // Mode B: Plain text, delimited lines, or headless CSV
    for (const line of lines) {
      // Check if line contains delimiters: comma, semicolon, tab
      const tokens = line
        .split(/[,;\t]/)
        .map((t) => t.replace(/^["']|["']$/g, '').trim())
        .filter((t) => t.length > 0);

      for (const token of tokens) {
        // If token itself contains @, treat it as candidate
        if (token.includes('@')) {
          totalDetected++;
          if (isValidEmail(token)) {
            const normalized = token.toLowerCase();
            if (seenEmails.has(normalized)) {
              duplicatesRemoved++;
              if (duplicateSamples.length < 5) {
                duplicateSamples.push(normalized);
              }
            } else {
              seenEmails.add(normalized);
              validLeads.push(normalized);
            }
          } else {
            // Check if there is an embedded valid email inside
            const embeddedMatches = token.match(EMAIL_FINDER_REGEX);
            if (embeddedMatches && embeddedMatches.length > 0) {
              for (const match of embeddedMatches) {
                const normalized = match.toLowerCase();
                if (seenEmails.has(normalized)) {
                  duplicatesRemoved++;
                  if (duplicateSamples.length < 5) {
                    duplicateSamples.push(normalized);
                  }
                } else {
                  seenEmails.add(normalized);
                  validLeads.push(normalized);
                }
              }
            } else {
              invalidCount++;
              if (invalidSamples.length < 5) {
                invalidSamples.push(token.slice(0, 50));
              }
            }
          }
        } else if (token.length > 0 && !token.includes(' ') && token.includes('.')) {
          // Suspicious token that looks like a broken address without @
          // Only count as invalid if it doesn't look like an arbitrary word
          if (token.includes('.com') || token.includes('.org') || token.includes('.net') || token.includes('.io')) {
            totalDetected++;
            invalidCount++;
            if (invalidSamples.length < 5) {
              invalidSamples.push(token.slice(0, 50));
            }
          }
        }
      }
    }
  }

  return {
    totalDetected,
    validLeads,
    duplicatesRemoved,
    duplicateSamples,
    invalidCount,
    invalidSamples,
    isEmpty: validLeads.length === 0 && invalidCount === 0,
  };
}
