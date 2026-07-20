const path = require('path');

// Encapsulates the face-recognition engine. It OWNS the (lazily loaded) model
// state via truly private fields (#tf/#faceapi/#ready) and exposes a small public
// surface — compare() and scoreForDistance(); callers never touch tfjs/face-api
// directly. Decoding is canvas-free (tf.node.decodeImage), and images are used in
// memory only. A single shared instance (defaultFaceMatcher) loads the ~12 MB of
// weights once per process.
class FaceMatcher {
  // face-api's descriptor distance for the SAME person is ~0.3–0.55; its own
  // FaceMatcher uses 0.6 as the "same person" cutoff. Score maps 0→100%, 0.6→65%.
  static MATCH_DISTANCE = 0.6;
  static MATCH_THRESHOLD = 65;

  #modelsDir;
  #tf = null;
  #faceapi = null;
  #ready = null;

  constructor({ modelsDir } = {}) {
    this.#modelsDir = modelsDir
      || process.env.FACE_MODELS_DIR
      || path.join(__dirname, '..', '..', 'models');
  }

  // distance → similarity %, calibrated so MATCH_DISTANCE lands on MATCH_THRESHOLD.
  scoreForDistance(distance) {
    const { MATCH_DISTANCE, MATCH_THRESHOLD } = FaceMatcher;
    const pct = 100 - ((100 - MATCH_THRESHOLD) / MATCH_DISTANCE) * distance;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  // Lazily load tfjs-node + face-api + the models once; reuse the promise so the
  // heavy deps never slow startup and load at most once.
  #ensureReady() {
    if (this.#ready) return this.#ready;
    this.#ready = (async () => {
      this.#tf = require('@tensorflow/tfjs-node');
      this.#faceapi = require('@vladmandic/face-api');
      await this.#faceapi.nets.ssdMobilenetv1.loadFromDisk(this.#modelsDir);
      await this.#faceapi.nets.faceLandmark68Net.loadFromDisk(this.#modelsDir);
      await this.#faceapi.nets.faceRecognitionNet.loadFromDisk(this.#modelsDir);
    })().catch((e) => {
      this.#ready = null; // allow a later retry (e.g. weights not fetched yet)
      throw new Error(`face model load failed (${e.message || e}) — run "npm run face:models"`);
    });
    return this.#ready;
  }

  // Decode a buffer → 128-d descriptor, or null if no face / not a decodable image.
  // Low detector confidence on purpose: a real ID's face is a small fraction of
  // the frame and scores ~0.16 (see the client's faceMatch notes).
  async #descriptorFor(buffer) {
    let tensor;
    try { tensor = this.#tf.node.decodeImage(buffer, 3); } catch { return null; }
    try {
      const opts = new this.#faceapi.SsdMobilenetv1Options({ minConfidence: 0.1, maxResults: 1 });
      const det = await this.#faceapi.detectSingleFace(tensor, opts).withFaceLandmarks().withFaceDescriptor();
      return det ? det.descriptor : null;
    } finally {
      tensor.dispose();
    }
  }

  // Compare a selfie against an ID photo (both Buffers). Returns
  // { ok:true, match, score(0-100), distance } or { ok:false, reason }.
  async compare(selfieBuffer, idBuffer) {
    await this.#ensureReady();
    const selfie = await this.#descriptorFor(selfieBuffer);
    const id = await this.#descriptorFor(idBuffer);
    if (!selfie || !id) {
      const reason = !selfie && !id ? 'No face detected in either image'
        : !selfie ? 'No face detected in the selfie'
          : 'No clear face detected on the ID';
      return { ok: false, reason };
    }
    const distance = this.#faceapi.euclideanDistance(selfie, id);
    const score = this.scoreForDistance(distance);
    return { ok: true, match: score >= FaceMatcher.MATCH_THRESHOLD, score, distance };
  }
}

// Shared process-wide instance so model weights load only once.
const defaultFaceMatcher = new FaceMatcher();

module.exports = { FaceMatcher, defaultFaceMatcher };
