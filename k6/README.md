# k6 Load Testing

This directory contains k6 load testing scripts for testing applications in the local Kubernetes cluster.

> **Note:** k6 uses HTTP/2 connection reuse by default, which can cause uneven load distribution across Kubernetes pods. The scripts in this directory have `noConnectionReuse: true` configured to mitigate this. For in-cluster load testing with a web UI, consider using [Locust](http://locust.tools.com) instead.

## Quick Start

```bash
# Run combined load test (5/20/25 RPS for Mockery/Weather/Podinfo)
docker-compose run --rm k6 run /scripts/combined-load-test.js

# Run weather load test (200 RPS for 30 minutes)
docker-compose run --rm k6 run /scripts/weather-load-test.js

# Run weather alerts load test (30 RPS for 30 minutes)
docker-compose run --rm k6 run /scripts/weather-alerts-load-test.js

# Run mockery load test (200 RPS for 30 minutes)
docker-compose run --rm k6 run /scripts/mockery-load-test.js

# Run podinfo load test (10 RPS for 30 minutes)
docker-compose run --rm k6 run /scripts/podinfo-load-test.js
```

## Running in Detached Mode

```bash
# Run in background with custom settings
docker-compose run -d --rm \
  -e K6_MOCKERY_RPS=50 \
  -e K6_WEATHER_RPS=50 \
  -e K6_PODINFO_RPS=20 \
  -e K6_DURATION=10m \
  k6 run /scripts/combined-load-test.js

# View running k6 containers
docker ps --filter ancestor=grafana/k6

# View logs (find container ID from docker ps)
docker logs -f <container_id>

# Stop all k6 containers
docker ps --filter ancestor=grafana/k6 -q | ForEach-Object { docker stop $_ }
```

## Available Scripts

| Script | Default RPS | Target | Description |
|--------|-------------|--------|-------------|
| `combined-load-test.js` | 5/20/25 | All services | Tests Mockery, Weather, and Podinfo simultaneously |
| `weather-load-test.js` | 200 | weather.local.com/api/weather | Tests Weather API with Mockery mocks |
| `weather-alerts-load-test.js` | 30 | weather.local.com/api/alerts | Tests Weather Alerts endpoint |
| `mockery-load-test.js` | 200 | mockery.local.com | Tests Mockery API directly |
| `podinfo-load-test.js` | 10 | podinfo.local.com | Tests Podinfo endpoints |

## Configuration

All scripts support configurable parameters via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `K6_RPS` | Script-specific | Requests per second |
| `K6_DURATION` | 30m | Test duration (e.g., 5m, 1h, 30s) |
| `K6_MAX_VUS` | auto | Maximum virtual users |
| `K6_BASE_URL` | Script-specific | Target URL |

### Script-specific Variables

**Weather Load Test:**
| Variable | Default | Description |
|----------|---------|-------------|
| `K6_MOCKERY_MOCKS` | `windsensor/success, windsensor/success-2, temperaturesensor/success, precipitationsensor/success` | X-Mockery-Mocks header value |

**Mockery Load Test:**
| Variable | Default | Description |
|----------|---------|-------------|
| `K6_MOCK_ID` | `weather/prod/success` | X-Mock-ID header value |

**Combined Load Test:**
| Variable | Default | Description |
|----------|---------|-------------|
| `K6_MOCKERY_RPS` | 5 | Mockery requests per second |
| `K6_WEATHER_RPS` | 20 | Weather requests per second |
| `K6_PODINFO_RPS` | 25 | Podinfo requests per second |
| `K6_DURATION` | 30m | Test duration for all scenarios |
| `K6_MOCK_ID` | `weather/prod/success` | Mockery X-Mock-ID header |
| `K6_MOCKERY_MOCKS` | (sensor mocks) | Weather X-Mockery-Mocks header |
| `K6_MOCKERY_URL` | `http://mockery.local.com` | Mockery base URL |
| `K6_WEATHER_URL` | `http://weather.local.com` | Weather base URL |
| `K6_PODINFO_URL` | `http://podinfo.local.com` | Podinfo base URL |

## Examples

```bash
# Weather: Default 200 RPS for 30 minutes
docker-compose run --rm k6 run /scripts/weather-load-test.js

# Weather: Light load 50 RPS for 5 minutes
docker-compose run --rm -e K6_RPS=50 -e K6_DURATION=5m k6 run /scripts/weather-load-test.js

# Weather: Custom mocks
docker-compose run --rm -e K6_MOCKERY_MOCKS="custom/mock1, custom/mock2" k6 run /scripts/weather-load-test.js

# Mockery: 100 RPS for 15 minutes
docker-compose run --rm -e K6_RPS=100 -e K6_DURATION=15m k6 run /scripts/mockery-load-test.js

# Mockery: Custom mock ID
docker-compose run --rm -e K6_MOCK_ID=api/v2/users k6 run /scripts/mockery-load-test.js

# Podinfo: 50 RPS for 10 minutes
docker-compose run --rm -e K6_RPS=50 -e K6_DURATION=10m k6 run /scripts/podinfo-load-test.js

# Combined: Default settings (5/20/25 RPS)
docker-compose run --rm k6 run /scripts/combined-load-test.js

# Combined: Custom RPS per service
docker-compose run --rm -e K6_MOCKERY_RPS=50 -e K6_WEATHER_RPS=50 -e K6_PODINFO_RPS=20 -e K6_DURATION=10m k6 run /scripts/combined-load-test.js

# Combined: Test only weather (disable others by setting RPS to 0)
docker-compose run --rm \
  -e K6_MOCKERY_RPS=0 \
  -e K6_WEATHER_RPS=100 \
  -e K6_PODINFO_RPS=0 \
  k6 run /scripts/combined-load-test.js

# Combined: Direct k6 CLI with --env flags
k6 run --env K6_MOCKERY_RPS=50 --env K6_DURATION=5m k6/combined-load-test.js
```

## Custom Load Tests

Create your own test script in the `k6/` directory:

```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 10,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p(95)<500'],
  },
  noConnectionReuse: true,
};

export default function () {
  const response = http.get('http://your-service.local.com/api/endpoint');
  
  check(response, {
    'status is 200': (r) => r.status === 200,
  });
}
```

Run your custom test:

```bash
docker-compose run --rm k6 run /scripts/your-test.js
```

## Troubleshooting

### k6 can't reach Kubernetes endpoints

Ensure your hosts file has the correct mappings:
```
127.0.0.1 mockery.local.com
127.0.0.1 podinfo.local.com
127.0.0.1 weather.local.com
```

### Uneven load distribution

The scripts use `noConnectionReuse: true` to improve load distribution. If you still see uneven distribution, consider using [Locust](http://locust.tools.com) for in-cluster testing.

### Git Bash path translation issues

When running from Git Bash (MINGW64), paths starting with `/` are converted to Windows paths. Use double slashes:
```bash
docker-compose run --rm k6 run //scripts/combined-load-test.js
```

Or set `MSYS_NO_PATHCONV=1`:
```bash
MSYS_NO_PATHCONV=1 docker-compose run --rm k6 run /scripts/combined-load-test.js
```

## Directory Structure

```
k6/
├── README.md                     # This file
├── combined-load-test.js         # Combined load test for all services
├── weather-load-test.js          # Weather API load test (/api/weather)
├── weather-alerts-load-test.js   # Weather Alerts load test (/api/alerts)
├── mockery-load-test.js          # Mockery API load test
└── podinfo-load-test.js          # Podinfo load test
