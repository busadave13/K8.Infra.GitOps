// k6 Combined Load Test for Mockery, Weather, and Podinfo
// Runs all three services simultaneously with configurable RPS for each
//
// Run with docker-compose:
//   docker-compose run --rm k6 run /scripts/combined-load-test.js
//
// Run with custom settings:
//   docker-compose run --rm \
//     -e K6_MOCKERY_RPS=50 \
//     -e K6_WEATHER_RPS=50 \
//     -e K6_PODINFO_RPS=20 \
//     -e K6_DURATION=10m \
//     k6 run /scripts/combined-load-test.js
//
// Run directly with k6 CLI:
//   k6 run --env K6_MOCKERY_RPS=50 --env K6_DURATION=5m k6/combined-load-test.js
//
// Disable a service by setting its RPS to 0:
//   k6 run --env K6_MOCKERY_RPS=0 --env K6_WEATHER_RPS=100 --env K6_PODINFO_RPS=0 k6/combined-load-test.js

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics per service
const mockeryErrors = new Rate('mockery_errors');
const weatherErrors = new Rate('weather_errors');
const podinfoErrors = new Rate('podinfo_errors');

const mockeryDuration = new Trend('mockery_duration', true);
const weatherDuration = new Trend('weather_duration', true);
const podinfoDuration = new Trend('podinfo_duration', true);

const mockeryRequests = new Counter('mockery_requests');
const weatherRequests = new Counter('weather_requests');
const podinfoRequests = new Counter('podinfo_requests');

// Configurable parameters via environment variables
const MOCKERY_RPS = __ENV.K6_MOCKERY_RPS ? parseInt(__ENV.K6_MOCKERY_RPS) : 5;
const WEATHER_RPS = __ENV.K6_WEATHER_RPS ? parseInt(__ENV.K6_WEATHER_RPS) : 20;
const PODINFO_RPS = __ENV.K6_PODINFO_RPS ? parseInt(__ENV.K6_PODINFO_RPS) : 25;
const DURATION = __ENV.K6_DURATION || '30m';

// Service URLs
const MOCKERY_URL = __ENV.K6_MOCKERY_URL || 'http://mockery.local.com';
const WEATHER_URL = __ENV.K6_WEATHER_URL || 'http://weather.local.com';
const PODINFO_URL = __ENV.K6_PODINFO_URL || 'http://podinfo.local.com';

// Service-specific headers
const MOCK_ID = __ENV.K6_MOCK_ID || 'weather/prod/success';
const MOCKERY_MOCKS = __ENV.K6_MOCKERY_MOCKS || 'windsensor/success, windsensor/success-2, temperaturesensor/success, precipitationsensor/success';

// Build scenarios dynamically based on RPS (skip if RPS is 0)
const scenarios = {};

if (MOCKERY_RPS > 0) {
    scenarios.mockery = {
        executor: 'constant-arrival-rate',
        rate: MOCKERY_RPS,
        timeUnit: '1s',
        duration: DURATION,
        preAllocatedVUs: Math.ceil(MOCKERY_RPS / 4),
        maxVUs: Math.max(MOCKERY_RPS, 100),
        exec: 'mockeryTest',
        tags: { service: 'mockery' },
    };
}

if (WEATHER_RPS > 0) {
    scenarios.weather = {
        executor: 'constant-arrival-rate',
        rate: WEATHER_RPS,
        timeUnit: '1s',
        duration: DURATION,
        preAllocatedVUs: Math.ceil(WEATHER_RPS / 4),
        maxVUs: Math.max(WEATHER_RPS, 100),
        exec: 'weatherTest',
        tags: { service: 'weather' },
    };
}

if (PODINFO_RPS > 0) {
    scenarios.podinfo = {
        executor: 'constant-arrival-rate',
        rate: PODINFO_RPS,
        timeUnit: '1s',
        duration: DURATION,
        preAllocatedVUs: Math.ceil(PODINFO_RPS * 2),
        maxVUs: Math.max(PODINFO_RPS * 5, 50),
        exec: 'podinfoTest',
        tags: { service: 'podinfo' },
    };
}

export const options = {
    scenarios: scenarios,
    thresholds: {
        // Overall thresholds
        http_req_duration: ['p(95)<500'],

        // Per-service thresholds
        'http_req_duration{service:mockery}': ['p(95)<500'],
        'http_req_duration{service:weather}': ['p(95)<500'],
        'http_req_duration{service:podinfo}': ['p(95)<500'],

        // Error rate thresholds
        mockery_errors: ['rate<0.01'],
        weather_errors: ['rate<0.01'],
        podinfo_errors: ['rate<0.01'],
    },
    // Disable connection reuse for better load distribution across pods
    noConnectionReuse: true,
};

export function setup() {
    const totalRPS = MOCKERY_RPS + WEATHER_RPS + PODINFO_RPS;

    console.log(`\n${'='.repeat(50)}`);
    console.log(`   COMBINED LOAD TEST CONFIGURATION`);
    console.log(`${'='.repeat(50)}`);
    console.log(`Duration: ${DURATION}`);
    console.log(`Total RPS: ${totalRPS}`);
    console.log(`${'='.repeat(50)}`);

    if (MOCKERY_RPS > 0) {
        console.log(`\n📦 MOCKERY`);
        console.log(`   URL: ${MOCKERY_URL}/api/mock`);
        console.log(`   RPS: ${MOCKERY_RPS}`);
        console.log(`   Mock ID: ${MOCK_ID}`);
    } else {
        console.log(`\n📦 MOCKERY: DISABLED (RPS=0)`);
    }

    if (WEATHER_RPS > 0) {
        console.log(`\n🌤️  WEATHER`);
        console.log(`   URL: ${WEATHER_URL}/api/weather`);
        console.log(`   RPS: ${WEATHER_RPS}`);
        console.log(`   Mocks: ${MOCKERY_MOCKS}`);
    } else {
        console.log(`\n🌤️  WEATHER: DISABLED (RPS=0)`);
    }

    if (PODINFO_RPS > 0) {
        console.log(`\n🔵 PODINFO`);
        console.log(`   URL: ${PODINFO_URL}`);
        console.log(`   RPS: ${PODINFO_RPS}`);
    } else {
        console.log(`\n🔵 PODINFO: DISABLED (RPS=0)`);
    }

    console.log(`\n${'='.repeat(50)}\n`);

    return {
        startTime: new Date().toISOString(),
        mockeryRPS: MOCKERY_RPS,
        weatherRPS: WEATHER_RPS,
        podinfoRPS: PODINFO_RPS,
    };
}

// Mockery test function
export function mockeryTest() {
    const params = {
        headers: {
            'X-Mock-ID': MOCK_ID,
        },
        tags: { service: 'mockery' },
    };

    const response = http.get(`${MOCKERY_URL}/api/mock`, params);

    mockeryRequests.add(1);
    mockeryDuration.add(response.timings.duration);

    const success = check(response, {
        'mockery: status is 200': (r) => r.status === 200,
        'mockery: response time < 500ms': (r) => r.timings.duration < 500,
    });

    mockeryErrors.add(!success);
}

// Weather test function
export function weatherTest() {
    const params = {
        headers: {
            'X-Mockery-Mocks': MOCKERY_MOCKS,
        },
        tags: { service: 'weather' },
    };

    const response = http.get(`${WEATHER_URL}/api/weather`, params);

    weatherRequests.add(1);
    weatherDuration.add(response.timings.duration);

    const success = check(response, {
        'weather: status is 200': (r) => r.status === 200,
        'weather: response time < 500ms': (r) => r.timings.duration < 500,
    });

    weatherErrors.add(!success);
}

// Podinfo test function
export function podinfoTest() {
    const params = {
        headers: {
            'Accept': 'application/json',
        },
        tags: { service: 'podinfo' },
    };

    const response = http.get(`${PODINFO_URL}/`, params);

    podinfoRequests.add(1);
    podinfoDuration.add(response.timings.duration);

    const success = check(response, {
        'podinfo: status is 200': (r) => r.status === 200,
        'podinfo: response time < 500ms': (r) => r.timings.duration < 500,
    });

    podinfoErrors.add(!success);
}

export function teardown(data) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`   TEST COMPLETED`);
    console.log(`${'='.repeat(50)}`);
    console.log(`Started: ${data.startTime}`);
    console.log(`Ended: ${new Date().toISOString()}`);
    console.log(`${'='.repeat(50)}\n`);
}

export function handleSummary(data) {
    const output = [];

    output.push('\n' + '='.repeat(60));
    output.push('   COMBINED LOAD TEST SUMMARY');
    output.push('='.repeat(60));

    // Overall stats
    output.push('\n📊 OVERALL');
    output.push(`   Total Requests: ${data.metrics.http_reqs?.values?.count || 0}`);
    output.push(`   Total Duration: ${DURATION}`);
    if (data.metrics.http_req_duration?.values) {
        output.push(`   Avg Response Time: ${data.metrics.http_req_duration.values.avg?.toFixed(2) || 'N/A'}ms`);
        output.push(`   p95 Response Time: ${data.metrics.http_req_duration.values['p(95)']?.toFixed(2) || 'N/A'}ms`);
    }

    // Mockery stats
    if (data.metrics.mockery_requests?.values?.count > 0) {
        output.push('\n📦 MOCKERY');
        output.push(`   Requests: ${data.metrics.mockery_requests.values.count}`);
        output.push(`   Error Rate: ${((data.metrics.mockery_errors?.values?.rate || 0) * 100).toFixed(2)}%`);
        if (data.metrics.mockery_duration?.values) {
            output.push(`   Avg Duration: ${data.metrics.mockery_duration.values.avg?.toFixed(2) || 'N/A'}ms`);
            output.push(`   p95 Duration: ${data.metrics.mockery_duration.values['p(95)']?.toFixed(2) || 'N/A'}ms`);
        }
    }

    // Weather stats
    if (data.metrics.weather_requests?.values?.count > 0) {
        output.push('\n🌤️  WEATHER');
        output.push(`   Requests: ${data.metrics.weather_requests.values.count}`);
        output.push(`   Error Rate: ${((data.metrics.weather_errors?.values?.rate || 0) * 100).toFixed(2)}%`);
        if (data.metrics.weather_duration?.values) {
            output.push(`   Avg Duration: ${data.metrics.weather_duration.values.avg?.toFixed(2) || 'N/A'}ms`);
            output.push(`   p95 Duration: ${data.metrics.weather_duration.values['p(95)']?.toFixed(2) || 'N/A'}ms`);
        }
    }

    // Podinfo stats
    if (data.metrics.podinfo_requests?.values?.count > 0) {
        output.push('\n🔵 PODINFO');
        output.push(`   Requests: ${data.metrics.podinfo_requests.values.count}`);
        output.push(`   Error Rate: ${((data.metrics.podinfo_errors?.values?.rate || 0) * 100).toFixed(2)}%`);
        if (data.metrics.podinfo_duration?.values) {
            output.push(`   Avg Duration: ${data.metrics.podinfo_duration.values.avg?.toFixed(2) || 'N/A'}ms`);
            output.push(`   p95 Duration: ${data.metrics.podinfo_duration.values['p(95)']?.toFixed(2) || 'N/A'}ms`);
        }
    }

    output.push('\n' + '='.repeat(60) + '\n');

    console.log(output.join('\n'));

    return {
        stdout: JSON.stringify(data, null, 2),
    };
}
