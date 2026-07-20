// API load test — measures throughput + latency under concurrent load.
// Hits a static endpoint (/api/health, no DB) and a real DB-backed query
// (/api/public/workers) so we see both raw server overhead and query cost.
//
//   npm run perf                                  # local server on :4000
//   TARGET=https://tapa-trust-server.onrender.com npm run perf   # deployed
//   CONNECTIONS=50 DURATION=20 npm run perf       # heavier run
const autocannon = require('autocannon');

const BASE = process.env.TARGET || 'http://localhost:4000';
const DURATION = Number(process.env.DURATION || 10);
const CONNECTIONS = Number(process.env.CONNECTIONS || 20);
const PATHS = ['/api/health', '/api/public/workers'];

function run(path) {
  return new Promise((resolve, reject) => {
    autocannon(
      { url: `${BASE}${path}`, connections: CONNECTIONS, duration: DURATION },
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });
}

(async () => {
  console.log(`Load test → ${BASE}  (${CONNECTIONS} connections, ${DURATION}s each)\n`);
  for (const path of PATHS) {
    const r = await run(path);
    console.log(`=== ${path} ===`);
    console.log(`  requests/sec   avg ${r.requests.average}   (total ${r.requests.total})`);
    console.log(`  latency (ms)   avg ${r.latency.average}   p50 ${r.latency.p50}   p97.5 ${r.latency.p97_5}   p99 ${r.latency.p99}   max ${r.latency.max}`);
    console.log(`  responses      2xx ${r['2xx']}   non-2xx ${r.non2xx}   errors ${r.errors}\n`);
  }
  console.log('Done.');
  process.exit(0);
})().catch((e) => { console.error('Load test failed:', e.message); process.exit(1); });
