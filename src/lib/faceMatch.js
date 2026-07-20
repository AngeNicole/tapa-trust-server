// Server-side face comparison — the authoritative version of the check that used
// to run only in the worker's browser. Because it runs here, the verdict can't be
// spoofed by a tampered client. It uses the SAME model and calibration as the
// client (see client `src/utils/faceMatch.js`) so the numbers agree either way.
//
// The images arrive as in-memory buffers, are compared, and are discarded — the
// caller never writes them to disk or the database. Only the verdict is stored.
//
// Decoding is done with tfjs-node's native image decoder (tf.node.decodeImage),
// NOT the `canvas` package — that avoids canvas's Cairo/Pango system-library build
// (a deployment headache) entirely. tfjs-node + face-api are required lazily on
// first use, so importing this module doesn't slow server startup.

const path = require('path');

// face-api's descriptor distance for the SAME person is typically ~0.3–0.55, and
// its FaceMatcher uses 0.6 as the default "same person" cutoff. Selfie-vs-ID sits
// at the high end (different lighting, an older/printed ID photo), so distance
// ≤ 0.6 counts as a match. Displayed score maps 0.6 → 65%, 0.0 → 100%.
const MATCH_DISTANCE = 0.6;
const MATCH_THRESHOLD = 65;

// Where the model weight files live on disk. Fetch them once with
// `npm run face:models` (downloads to ./models). Override with FACE_MODELS_DIR.
const MODELS_DIR = process.env.FACE_MODELS_DIR || path.join(__dirname, '..', '..', 'models');

let tf = null;
let faceapi = null;
let modelsPromise = null;

// Load the library + models once. Subsequent calls reuse the same promise.
async function ensureReady() {
  if (modelsPromise) return modelsPromise;
  modelsPromise = (async () => {
    tf = require('@tensorflow/tfjs-node'); // native tf backend + image decoder
    faceapi = require('@vladmandic/face-api');
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR);
  })().catch((e) => {
    modelsPromise = null; // let a later call retry (e.g. models not fetched yet)
    throw new Error(`face model load failed (${e.message || e}) — run "npm run face:models"`);
  });
  return modelsPromise;
}

// distance → similarity %, calibrated so MATCH_DISTANCE maps to MATCH_THRESHOLD.
function scoreForDistance(distance) {
  const pct = 100 - ((100 - MATCH_THRESHOLD) / MATCH_DISTANCE) * distance;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// Decode a buffer and return the 128-d face descriptor, or null if no face
// (also null if the buffer isn't a decodable image — treated as "no face").
async function descriptorFor(buffer) {
  // Decode to a 3-channel uint8 tensor (drops any alpha); no canvas needed.
  let tensor;
  try { tensor = tf.node.decodeImage(buffer, 3); } catch { return null; }
  try {
    // A more tolerant detector than the 0.5 default, so small/low-contrast faces
    // on an ID photo are still found (a missed face is worse than a weak one).
    const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3, maxResults: 1 });
    const det = await faceapi.detectSingleFace(tensor, opts).withFaceLandmarks().withFaceDescriptor();
    return det ? det.descriptor : null;
  } finally {
    tensor.dispose(); // free the decoded image tensor promptly
  }
}

// Compare a selfie against an ID photo (both Buffers).
// Returns { ok: true, match, score (0-100), distance } or { ok: false, reason }.
async function compareFaces(selfieBuffer, idBuffer) {
  await ensureReady();
  const selfie = await descriptorFor(selfieBuffer);
  const id = await descriptorFor(idBuffer);
  if (!selfie || !id) {
    const reason = !selfie && !id ? 'No face detected in either image'
      : !selfie ? 'No face detected in the selfie'
        : 'No clear face detected on the ID';
    return { ok: false, reason };
  }
  const distance = faceapi.euclideanDistance(selfie, id);
  const score = scoreForDistance(distance);
  // Verdict derived from the same score that's returned, so they can't disagree.
  return { ok: true, match: score >= MATCH_THRESHOLD, score, distance };
}

module.exports = { compareFaces, MATCH_THRESHOLD, MATCH_DISTANCE };
