// k6 Constant Rate Load Test for Podinfo
// Generates a configurable requests per second for specified duration
//
// Run with: docker-compose run --rm k6 run -o influxdb=http://influxdb:8086/k6 /scripts/podinfo-load-test.js
// With custom settings: docker-compose run --rm -e K6_RPS=50 -e K6_DURATION=10m k6 run -o influxdb=http://influxdb:8086/k6 /scripts/podinfo-load-test.js

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const successRate = new Rate('success');
const responseTrend = new Trend('response_time_ms');
const requestCount = new Counter('total_requests');

// Configurable parameters via environment variables
const RPS = __ENV.K6_RPS ? parseInt(__ENV.K6_RPS) : 10;
const DURATION = __ENV.K6_DURATION || '30m';
const MAX_VUS = __ENV.K6_MAX_VUS ? parseInt(__ENV.K6_MAX_VUS) : Math.max(RPS * 5, 50);
const BASE_URL = __ENV.K6_BASE_URL || 'http://podinfo.local.com';

// Test configuration - constant arrival rate
export const options = {
  scenarios: {
    constant_load: {
      executor: 'constant-arrival-rate',
      rate: RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.ceil(RPS * 2),
      maxVUs: MAX_VUS,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
};

export function setup() {
  console.log(`\n=== Podinfo Load Test Configuration ===`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`RPS: ${RPS}`);
  console.log(`Duration: ${DURATION}`);
  console.log(`Max VUs: ${MAX_VUS}`);
  console.log(`========================================\n`);

  // Verify the service is reachable
  const res = http.get(`${BASE_URL}/healthz`);
  if (res.status !== 200) {
    console.error(`Service health check failed. Status: ${res.status}`);
    throw new Error(`Service is not healthy at ${BASE_URL}`);
  }
  console.log('✓ Service is healthy, starting load test...\n');

  return { startTime: new Date().toISOString() };
}

export default function () {
  const res = http.get(`${BASE_URL}/`, {
    headers: {
      'Accept': 'application/json',
    },
    tags: { name: 'main' },
  });

  requestCount.add(1);
  responseTrend.add(res.timings.duration);

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!success);
  successRate.add(success);
}

export function teardown(data) {
  console.log(`\n=== Test Completed ===`);
  console.log(`Started: ${data.startTime}`);
  console.log(`Ended: ${new Date().toISOString()}`);
}

export function handleSummary(data) {
  console.log('\n=== Podinfo Load Test Summary ===');
  console.log(`Configuration: ${RPS} RPS for ${DURATION}`);
  console.log(`Total Requests: ${data.metrics.http_reqs.values.count}`);
  console.log(`Success Rate: ${((1 - data.metrics.http_req_failed.values.rate) * 100).toFixed(2)}%`);
  console.log(`Avg Response Time: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms`);
  console.log(`p95 Response Time: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms`);
  console.log(`p99 Response Time: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms`);
  
  return {
    stdout: JSON.stringify(data, null, 2),
  };
}
