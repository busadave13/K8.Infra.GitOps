// k6 Constant Rate Load Test for Weather API
// Generates a configurable requests per second for specified duration
//
// Run with: docker-compose run --rm k6 run /scripts/weather-load-test.js
// With custom settings: docker-compose run --rm -e K6_RPS=100 -e K6_DURATION=5m k6 run /scripts/weather-load-test.js

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

// Mockery mocks header for weather sensors
const MOCKERY_MOCKS = __ENV.K6_MOCKERY_MOCKS || 'windsensor/success, windsensor/success-2, temperaturesensor/success, precipitationsensor/success';

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
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.01'],
  },
  // Disable connection reuse for better load distribution across pods
  noConnectionReuse: true,
};

export function setup() {
  console.log(`\n=== Weather Load Test Configuration ===`);
  console.log(`RPS: ${RPS}`);
  console.log(`Duration: ${DURATION}`);
  console.log(`Max VUs: ${MAX_VUS}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Mockery Mocks: ${MOCKERY_MOCKS}`);
  console.log(`========================================\n`);
}

export default function () {
  const params = {
    headers: {
      'X-Mockery-Mocks': MOCKERY_MOCKS,
    },
  };

  const response = http.get(`${BASE_URL}/api/weather`, params);

  responseTrend.add(response.timings.duration);

  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!success);
}

export function handleSummary(data) {
  console.log('\n=== Weather Load Test Summary ===');
  console.log(`Configuration: ${RPS} RPS for ${DURATION}`);
  console.log(`Total Requests: ${data.metrics.http_reqs.values.count}`);
  console.log(`Success Rate: ${((1 - data.metrics.errors.values.rate) * 100).toFixed(2)}%`);
  console.log(`Avg Response Time: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms`);
  console.log(`p95 Response Time: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms`);
  console.log(`p99 Response Time: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms`);

  return {
    stdout: JSON.stringify(data, null, 2),
  };
}
