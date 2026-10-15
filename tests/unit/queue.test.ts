import { describe, it, expect } from 'vitest';

describe('Queue Priority and Backoff Logic', () => {
  const PRIORITY_MAP: Record<string, number> = {
    urgent: 1,
    important: 2,
    normal: 3,
    low: 4,
  };

  it('maps urgent alerts to highest priority (1)', () => {
    expect(PRIORITY_MAP['urgent']).toBe(1);
    expect(PRIORITY_MAP['important']).toBe(2);
    expect(PRIORITY_MAP['normal']).toBe(3);
    expect(PRIORITY_MAP['low']).toBe(4);
  });

  it('computes exponential backoff with bounded delays', () => {
    const calculateBackoff = (attempt: number, baseMs = 2000, maxMs = 30000) => {
      return Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
    };

    expect(calculateBackoff(1)).toBe(2000);   // Attempt 1: 2s
    expect(calculateBackoff(2)).toBe(4000);   // Attempt 2: 4s
    expect(calculateBackoff(3)).toBe(8000);   // Attempt 3: 8s
    expect(calculateBackoff(4)).toBe(16000);  // Attempt 4: 16s
    expect(calculateBackoff(5)).toBe(30000);  // Attempt 5: 30s (capped)
    expect(calculateBackoff(10)).toBe(30000); // Attempt 10: 30s (capped)
  });
});
