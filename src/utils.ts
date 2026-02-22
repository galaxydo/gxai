// src/utils.ts

export function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 10);
}

if (import.meta.env.NODE_ENV === "test") {
  const { test, expect } = await import('bun:test');

  test('generateRequestId', () => {
    const id = generateRequestId();
    expect(id.length).toBe(8);
    expect(id).toMatch(/^[a-z0-9]+$/);
  });
}
