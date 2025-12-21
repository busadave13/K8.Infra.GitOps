// k6 Constant Rate Load Test for Weather Alerts API
// Targets the /api/alerts endpoint specifically
// Generates a configurable requests per second for specified duration
//
// Run with: docker-compose run --rm k6 run /scripts/weather-alerts-load-test.js
// With custom settings: docker-compose run --rm -e K6_RPS=100 -e K6_DURATION=5m k6 run /scripts/weather-alerts-load-test.js

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const responseTrend = new Trend('response_time');

// Configurable parameters via environment variables
const RPS = __ENV.K6_RPS ? parseInt(__ENV.K6_RPS) : 30;
const DURATION = __ENV.K6_DURATION || '30m';
const MAX_VUS = __ENV.K6_MAX_VUS ? parseInt(__ENV.K6_MAX_VUS) : Math.max(RPS, 30);
const BASE_URL = __ENV.K6_BASE_URL || 'http://weather.local.com';

// Mockery mocks header (optional - set if alerts endpoint uses mockery)
const MOCKERY_MOCKS = __ENV.K6_MOCKERY_MOCKS || '';

export const options = {
  scenarios: {
    constant_rate: {
      executor: 'constant-arrival-rate',
      rate: RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.ceil(RPS / 4),
      maxVUs: MAX_VUS,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
  // Disable connection reuse for better load distribution across pods
  noConnectionReuse: true,
};

export function setup() {
  console.log(`\n=== Weather Alerts Load Test Configuration ===`);
  console.log(`Endpoint: ${BASE_URL}/api/alerts`);
  console.log(`RPS: ${RPS}`);
  console.log(`Duration: ${DURATION}`);
  console.log(`Max VUs: ${MAX_VUS}`);
  if (MOCKERY_MOCKS) {
    console.log(`Mockery Mocks: ${MOCKERY_MOCKS}`);
  }
  console.log(`==============================================\n`);
}

export default function () {
  const params = {
    headers: {},
  };

  // Only add Mockery header if configured
  if (MOCKERY_MOCKS) {
    params.headers['X-Mockery-Mocks'] = MOCKERY_MOCKS;
  }

  const response = http.get(`${BASE_URL}/api/alerts`, params);

  responseTrend.add(response.timings.duration);

  const success = check(response, {
    'status is 204': (r) => r.status === 204,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!success);
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs?.values?.count || 0;
  const avgDuration = data.metrics.http_req_duration?.values?.avg || 0;
  const p95Duration = data.metrics.http_req_duration?.values?.['p(95)'] || 0;
  const p99Duration = data.metrics.http_req_duration?.values?.['p(99)'] || 0;
  const errorRateValue = data.metrics.errors?.values?.rate || 0;

  console.log('\n=== Weather Alerts Load Test Summary ===');
  console.log(`Endpoint: ${BASE_URL}/api/alerts`);
  console.log(`Configuration: ${RPS} RPS for ${DURATION}`);
  console.log(`Total Requests: ${totalRequests}`);
  console.log(`Success Rate: ${((1 - errorRateValue) * 100).toFixed(2)}%`);
  console.log(`Avg Response Time: ${avgDuration.toFixed(2)}ms`);
  console.log(`p95 Response Time: ${p95Duration.toFixed(2)}ms`);
  console.log(`p99 Response Time: ${p99Duration.toFixed(2)}ms`);
  console.log(`=========================================\n`);

  return {};
}
