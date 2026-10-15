import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

describe('Idempotency Request Hashing', () => {
  it('generates identical hashes for matching payloads regardless of key ordering', () => {
    const payloadA = { title: 'Alert', body: 'Regroup', recipients: ['u1', 'u2'] };
    const payloadB = { title: 'Alert', body: 'Regroup', recipients: ['u1', 'u2'] };

    const hashA = crypto.createHash('sha256').update(JSON.stringify(payloadA)).digest('hex');
    const hashB = crypto.createHash('sha256').update(JSON.stringify(payloadB)).digest('hex');

    expect(hashA).toBe(hashB);
  });

  it('generates different hashes for modified payloads with same key', () => {
    const payloadOriginal = { title: 'Alert', body: 'Regroup at checkpoint 1' };
    const payloadTampered = { title: 'Alert', body: 'Regroup at checkpoint 2' };

    const hash1 = crypto.createHash('sha256').update(JSON.stringify(payloadOriginal)).digest('hex');
    const hash2 = crypto.createHash('sha256').update(JSON.stringify(payloadTampered)).digest('hex');

    expect(hash1).not.toBe(hash2);
  });
});
