import { describe, it, expect } from 'vitest';

describe('FCM HTTP v1 Spec & Dead-Token Detection', () => {
  it('correctly stringifies nested data values for FCM v1 requirement', () => {
    const rawData = {
      rideId: 'ride-99',
      count: 42,
      meta: { nested: true, key: 'val' },
    };

    const stringified: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawData)) {
      stringified[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }

    expect(stringified.rideId).toBe('ride-99');
    expect(stringified.count).toBe('42');
    expect(stringified.meta).toBe('{"nested":true,"key":"val"}');
    expect(typeof stringified.count).toBe('string');
  });

  it('identifies unrecoverable dead token errors for automatic pruning', () => {
    const isUnrecoverableError = (errorCode: string) => {
      const deadCodes = ['UNREGISTERED', 'NOT_FOUND', 'INVALID_ARGUMENT'];
      return deadCodes.includes(errorCode);
    };

    expect(isUnrecoverableError('UNREGISTERED')).toBe(true);
    expect(isUnrecoverableError('NOT_FOUND')).toBe(true);
    expect(isUnrecoverableError('INVALID_ARGUMENT')).toBe(true);
    expect(isUnrecoverableError('UNAVAILABLE')).toBe(false);
    expect(isUnrecoverableError('INTERNAL_ERROR')).toBe(false);
  });

  it('correctly identifies retryable provider errors (429, 503)', () => {
    const isRetryableStatus = (status: number) => {
      return status === 429 || status >= 500;
    };

    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});
