// src/utils.ts
import { expect, test } from 'bun:test';

export function validateUrl(userUrl: string): string {
  try {
    const parsed = new URL(userUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Invalid scheme');
    }
    if (parsed.hash || parsed.username || parsed.password) {
      throw new Error('Forbidden URL components');
    }
    const decoded = decodeURIComponent(userUrl);
    if (/[\r\n]/.test(decoded)) {
      throw new Error('Suspicious encoding');
    }
    if (parsed.href.length > 2048) {
      throw new Error('URL too long');
    }
    return parsed.href;
  } catch (err) {
    throw new Error('Invalid URL: ' + err.message);
  }
}

export function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 10);
}

if (import.meta.env.NODE_ENV === "test") {
  const { test, expect } = await import('bun:test');

  test('validateUrl valid', () => {
    const url = validateUrl('https://example.com');
    expect(url).toBe('https://example.com/');
  });

  test('validateUrl invalid scheme', () => {
    expect(() => validateUrl('ftp://example.com')).toThrow('Invalid scheme');
  });

  test('validateUrl too long', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2048);
    expect(() => validateUrl(longUrl)).toThrow('URL too long');
  });

  test('generateRequestId', () => {
    const id = generateRequestId();
    expect(id.length).toBe(8);
    expect(id).toMatch(/^[a-z0-9]+$/);
  });
}
