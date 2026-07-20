// Downloads the face-api model weights this server needs for server-side face
// matching (see src/lib/faceMatch.js) into ./models. Run once: `npm run face:models`.
// The weights are the same ones the client lazy-loads from the CDN, kept locally
// here so the server has no runtime network dependency.

const fs = require('fs');
const path = require('path');

const VERSION = '1.7.14';
const BASE = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${VERSION}/model`;
const NETS = ['ssd_mobilenetv1', 'face_landmark_68', 'face_recognition'];
const OUT = path.join(__dirname, '..', 'models');

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`  saved ${path.basename(dest)} (${buf.length.toLocaleString()} bytes)`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const net of NETS) {
    const manifestName = `${net}_model-weights_manifest.json`;
    console.log(net);
    await download(`${BASE}/${manifestName}`, path.join(OUT, manifestName));
    // The manifest lists its own weight shard files under `paths` — fetch each.
    const manifest = JSON.parse(fs.readFileSync(path.join(OUT, manifestName), 'utf8'));
    const shards = manifest.flatMap((group) => group.paths || []);
    for (const shard of shards) await download(`${BASE}/${shard}`, path.join(OUT, shard));
  }
  console.log(`\nDone — models in ${OUT}`);
})().catch((err) => {
  console.error('\nfetch-face-models failed:', err.message);
  process.exit(1);
});
