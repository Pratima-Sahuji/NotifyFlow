import { describe, it, expect, beforeAll } from 'vitest';
import { newDb } from 'pg-mem';
import { setCustomPool, query } from '../../src/database/connection.js';

describe('Transactional Outbox Pattern & Reliability', () => {
  beforeAll(async () => {
    const db = newDb();
    db.public.registerFunction({
      name: 'gen_random_uuid',
      implementation: () => '00000000-0000-4000-8000-000000000002',
    });

    const memPool = db.adapters.createPg().Pool;
    const poolInstance = new memPool();
    setCustomPool(poolInstance as any);

    await poolInstance.query(`
      CREATE TABLE IF NOT EXISTS outbox (
        id UUID PRIMARY KEY,
        event_id UUID,
        queue_name VARCHAR(100) NOT NULL DEFAULT 'notifications',
        payload JSONB NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at TIMESTAMPTZ
      );
    `);
  });

  it('persists outbox records in PostgreSQL and verifies pending state', async () => {
    const outboxId = '11111111-1111-4111-8111-111111111111';
    const eventId = '22222222-2222-4222-8222-222222222222';
    const payload = {
      notificationId: 'notif-1',
      userId: 'user-99',
      title: 'SOS Alert',
      body: 'Need help',
    };

    await query(
      `INSERT INTO outbox (id, event_id, queue_name, payload, status)
       VALUES ($1, $2, 'notifications', $3, 'pending')`,
      [outboxId, eventId, JSON.stringify(payload)]
    );

    const pending = await query(
      `SELECT id, status, payload FROM outbox WHERE status = 'pending'`
    );

    expect(pending.rows.length).toBe(1);
    expect(pending.rows[0].id).toBe(outboxId);
    expect(pending.rows[0].status).toBe('pending');
    expect(pending.rows[0].payload.userId).toBe('user-99');
  });

  it('transitions outbox record to published upon queue delivery', async () => {
    const outboxId = '11111111-1111-4111-8111-111111111111';

    await query(
      `UPDATE outbox
       SET status = 'published', published_at = NOW()
       WHERE id = $1`,
      [outboxId]
    );

    const check = await query(`SELECT status, published_at FROM outbox WHERE id = $1`, [outboxId]);
    expect(check.rows[0].status).toBe('published');
    expect(check.rows[0].published_at).not.toBeNull();
  });
});
