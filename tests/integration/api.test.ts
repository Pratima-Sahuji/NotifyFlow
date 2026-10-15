import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { newDb } from 'pg-mem';
import { createApp } from '../../src/app.js';
import { generateToken } from '../../src/middleware/auth.middleware.js';
import { setCustomPool } from '../../src/database/connection.js';

describe('NotifyFlow REST API Integration Tests', () => {
  let app: any;
  let validToken: string;
  let testUserId = 'test-user-42';

  beforeAll(async () => {
    // Setup pg-mem in-memory postgres database
    const db = newDb();
    db.public.registerFunction({
      name: 'gen_random_uuid',
      implementation: () => '00000000-0000-4000-8000-000000000001',
    });

    const memPool = db.adapters.createPg().Pool;
    const poolInstance = new memPool();
    setCustomPool(poolInstance as any);

    // Run schema migrations in pg-mem
    await poolInstance.query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key VARCHAR(255) PRIMARY KEY,
        request_hash VARCHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
        status_code INT,
        response_body JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY,
        idempotency_key VARCHAR(255) UNIQUE,
        actor_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        channels TEXT[] NOT NULL DEFAULT ARRAY['websocket', 'fcm']::TEXT[],
        recipients JSONB NOT NULL,
        priority VARCHAR(20) NOT NULL DEFAULT 'normal',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY,
        event_id UUID,
        user_id VARCHAR(255) NOT NULL,
        actor_id VARCHAR(255),
        type VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        priority VARCHAR(20) NOT NULL DEFAULT 'normal',
        status VARCHAR(20) NOT NULL DEFAULT 'queued',
        read_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id UUID PRIMARY KEY,
        notification_id UUID NOT NULL,
        channel VARCHAR(50) NOT NULL,
        device_token TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        last_error TEXT,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS device_tokens (
        id UUID PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        token TEXT NOT NULL,
        platform VARCHAR(50) NOT NULL DEFAULT 'android',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, token)
      );

      CREATE TABLE IF NOT EXISTS notification_preferences (
        id UUID PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        channel VARCHAR(50) NOT NULL,
        event_type VARCHAR(100) NOT NULL DEFAULT '*',
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        quiet_hours_start TIME,
        quiet_hours_end TIME,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, channel, event_type)
      );

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

    app = createApp();
    validToken = generateToken({ userId: testUserId });
  });

  // 1. Health checks
  it('GET /health/live returns 200 OK', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });

  // 2. Auth protection
  it('rejects unauthenticated requests to protected routes', async () => {
    const res = await request(app).get('/api/v1/devices/tokens');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('rejects invalid JWT tokens', async () => {
    const res = await request(app)
      .get('/api/v1/devices/tokens')
      .set('Authorization', 'Bearer invalid-jwt-token');
    expect(res.status).toBe(401);
  });

  // 3. Device Tokens API
  it('POST /api/v1/devices/tokens registers a new device token', async () => {
    const res = await request(app)
      .post('/api/v1/devices/tokens')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        token: 'fcm-registration-token-alpha-12345',
        platform: 'android',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBe('fcm-registration-token-alpha-12345');
    expect(res.body.data.platform).toBe('android');
  });

  it('GET /api/v1/devices/tokens lists active registered tokens', async () => {
    const res = await request(app)
      .get('/api/v1/devices/tokens')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].token).toBe('fcm-registration-token-alpha-12345');
  });

  it('DELETE /api/v1/devices/tokens/:token deactivates the token', async () => {
    const res = await request(app)
      .delete('/api/v1/devices/tokens/fcm-registration-token-alpha-12345')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 4. Preferences API
  it('PUT /api/v1/preferences updates notification channel preferences', async () => {
    const res = await request(app)
      .put('/api/v1/preferences')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        channel: 'fcm',
        eventType: '*',
        enabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.channel).toBe('fcm');
    expect(res.body.data.enabled).toBe(true);
  });

  it('GET /api/v1/preferences retrieves user preferences', async () => {
    const res = await request(app)
      .get('/api/v1/preferences')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  // 5. Events Creation API
  it('validates request payload against Zod schema and rejects invalid body', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        eventType: '', // Invalid: empty string
        title: 'Hi',
        // Missing body and recipients
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation Error');
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it('POST /api/v1/events creates event, notifications, and outbox record', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        eventType: 'RIDE_HELP',
        title: 'Emergency SOS Alert',
        body: 'Rider needs assistance at km 45',
        recipients: ['user-marshal-1', 'user-marshal-2'],
        priority: 'urgent',
        channels: ['websocket', 'fcm'],
        data: { lat: 12.9716, lng: 77.5946 },
      });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.eventType).toBe('RIDE_HELP');
    expect(res.body.data.recipientsCount).toBe(2);
    expect(res.body.data.notificationsCreated.length).toBe(2);
  });

  // 6. Idempotency Support
  it('returns cached response on duplicate request with same Idempotency-Key', async () => {
    const idempotencyKey = 'idemp-test-unique-key-101';
    const payload = {
      eventType: 'ANNOUNCEMENT',
      title: 'Halt in 5 min',
      body: 'Prepare for ride resumption',
      recipients: ['rider-1'],
    };

    // First request
    const res1 = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${validToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res1.status).toBe(202);
    const originalEventId = res1.body.data.eventId;

    // Second duplicate request
    const res2 = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${validToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res2.status).toBe(202);
    expect(res2.header['x-cache-lookup']).toBe('HIT-IDEMPOTENT');
    expect(res2.body.data.eventId).toBe(originalEventId);
  });
});
