import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 20 },  // Ramp up to 20 virtual users
    { duration: '30s', target: 50 },  // Sustained load at 50 VUs
    { duration: '10s', target: 100 }, // Spike to 100 VUs
    { duration: '10s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'], // 95% of requests must complete under 300ms
    http_req_failed: ['rate<0.01'],   // Error rate must be under 1%
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';
const JWT_TOKEN = __ENV.JWT_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsb2FkLXRlc3QtdXNlciIsInVzZXJJZCI6ImxvYWQtdGVzdC11c2VyIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3MDcxNjgwMDB9.sample';

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${JWT_TOKEN}`,
  };

  // 1. Health check
  const healthRes = http.get(`${BASE_URL}/health/live`);
  check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
  });

  // 2. Publish Notification Event
  const payload = JSON.stringify({
    eventType: 'RIDE_HELP',
    title: 'Load Test SOS Notification',
    body: 'Automated k6 benchmark payload',
    recipients: [`user-${__VU}-${__ITER}`],
    channels: ['websocket', 'fcm'],
    priority: 'normal',
    data: { vu: __VU, iter: __ITER },
  });

  const eventRes = http.post(`${BASE_URL}/api/v1/events`, payload, {
    headers: {
      ...headers,
      'Idempotency-Key': `k6-${__VU}-${__ITER}-${Date.now()}`,
    },
  });

  check(eventRes, {
    'event creation accepted (202)': (r) => r.status === 202,
    'event response has eventId': (r) => r.json('data.eventId') !== undefined,
  });

  sleep(0.1);
}
