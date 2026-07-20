// Stress test — unlike the load test (fixed, expected concurrency), this ramps
// concurrency well past normal to find where latency degrades / errors appear.
// Hits the DB-backed endpoint (the realistic bottleneck).
//
//   npm run stress
//   TARGET=https://tapa-trust-server.onrender.com npm run stress
//   LEVELS=100,500,2000 DURATION=10 npm run stress
const autocannon = require('autocannon');

const BASE = process.env.TARGET || 'http://localhost:4000';
const ROUTE = process.env.ROUTE || '/api/public/workers';
const LEVELS = (process.env.LEVELS || '50,200,500,1000').split(',').map(Number);
const DURATION = Number(process.env.DURATION || 8);

function run(connections) {
  return new Promise((resolve, reject) => {
    autocannon({ url: `${BASE}${ROUTE}`, connections, duration: DURATION, pipelining: 1 },
      (err, res) => (err ? reject(err) : resolve(res)));
  });
}

(async () => {
  console.log(`Stress ramp → ${BASE}${ROUTE}  (${DURATION}s per level)\n`);
  console.log('conns | req/sec |  lat avg | p99(ms) | max(ms) |   2xx   | non-2xx | errors');
  console.log('------+---------+----------+---------+---------+---------+---------+-------');
  for (const c of LEVELS) {
    const r = await run(c);
    const row = [
      String(c).padStart(5),
      String(r.requests.average).padStart(7),
      String(`${r.latency.average}ms`).padStart(8),
      String(r.latency.p99).padStart(7),
      String(r.latency.max).padStart(7),
      String(r['2xx']).padStart(7),
      String(r.non2xx).padStart(7),
      String(r.errors).padStart(6),
    ];
    console.log(row.join(' | '));
  }
  console.log('\nDone.');
  process.exit(0);
})().catch((e) => { console.error('Stress test failed:', e.message); process.exit(1); });
