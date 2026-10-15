process.env.RATE_LIMIT_MAX = '5000';
process.env.LOG_LEVEL = 'warn';

import http from 'http';
import { newDb } from 'pg-mem';

async function runBenchmark() {
  console.log('===========================================================');
  console.log('?? RUNNING NOTIFYFLOW PERFORMANCE & THROUGHPUT BENCHMARK');
  console.log('===========================================================\n');

  // Dynamic import after env vars are set
  const { createApp } = await import('../src/app.js');
  const { generateToken } = await import('../src/middleware/auth.middleware.js');
  const { setCustomPool } = await import('../src/database/connection.js');

  // In-memory DB setup for benchmark
  const db = newDb();
  db.public.registerFunction({
    name: 'gen_random_uuid',
    implementation: () => '00000000-0000-4000-8000-000000000009',
  });
  const memPool = db.adapters.createPg().Pool;
  const poolInstance = new memPool();
  setCustomPool(poolInstance as any);

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

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(4099, resolve));

  const token = generateToken({ userId: 'bench-user' });
  const totalRequests = 500;
  const concurrency = 25;

  console.log(`Configuration: Total Requests = ${totalRequests}, Concurrency = ${concurrency}`);
  console.log('Target: POST http://localhost:4099/api/v1/events\n');

  const latencies: number[] = [];
  let successfulRequests = 0;
  let failedRequests = 0;

  const startTime = Date.now();

  const makeRequest = (index: number): Promise<void> => {
    return new Promise((resolve) => {
      const payload = JSON.stringify({
        eventType: 'LOAD_TEST',
        title: `Benchmark Event #${index}`,
        body: 'Load test payload body',
        recipients: [`user-${index % 50}`],
        priority: 'normal',
      });

      const reqStart = Date.now();
      const req = http.request(
        {
          hostname: 'localhost',
          port: 4099,
          path: '/api/v1/events',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'Idempotency-Key': `bench-${index}`,
          },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => {
            const reqDuration = Date.now() - reqStart;
            latencies.push(reqDuration);
            if (res.statusCode === 202) {
              successfulRequests++;
            } else {
              failedRequests++;
            }
            resolve();
          });
        }
      );

      req.on('error', () => {
        failedRequests++;
        resolve();
      });

      req.write(payload);
      req.end();
    });
  };

  for (let i = 0; i < totalRequests; i += concurrency) {
    const chunk = [];
    for (let j = 0; j < concurrency && i + j < totalRequests; j++) {
      chunk.push(makeRequest(i + j));
    }
    await Promise.all(chunk);
  }

  const totalTimeSeconds = (Date.now() - startTime) / 1000;
  server.close();

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const throughput = Math.round(successfulRequests / totalTimeSeconds);

  console.log('-----------------------------------------------------------');
  console.log('?? BENCHMARK EXECUTION RESULTS');
  console.log('-----------------------------------------------------------');
  console.log(`Total Completed Requests : ${successfulRequests} / ${totalRequests}`);
  console.log(`Failed Requests          : ${failedRequests}`);
  console.log(`Total Time Elapsed       : ${totalTimeSeconds.toFixed(2)}s`);
  console.log(`Average Throughput       : ${throughput} req/sec`);
  console.log(`Latency p50 (Median)     : ${p50} ms`);
  console.log(`Latency p95              : ${p95} ms`);
  console.log(`Latency p99              : ${p99} ms`);
  console.log('-----------------------------------------------------------\n');

  if (failedRequests === 0) {
    console.log('? BENCHMARK PASSED (100% success rate)');
    process.exit(0);
  } else {
    console.error('? BENCHMARK ENCOUNTERED FAILURES');
    process.exit(1);
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
