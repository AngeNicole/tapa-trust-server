const VerificationStrategy = require('./VerificationStrategy');
const { dataUrlToBuffer } = require('../../lib/dataUrl');
const { defaultFaceMatcher } = require('../FaceMatcher');

// Online path: recompute the face match on the SERVER (authoritative, tamper-
// proof) and keep the ID + selfie for admin review. The matcher is injected so a
// stub can be used in tests (dependency inversion — no model load in unit tests).
class OnlineVerification extends VerificationStrategy {
  constructor(payload = {}, { matcher = defaultFaceMatcher } = {}) {
    super(payload);
    this.matcher = matcher;
  }

  get method() { return 'online'; }

  async run() {
    const { selfie, idImage, faceMatchScore, faceMatchPassed } = this.payload;

    // Start from the client's on-device hint; the server verdict overrides it
    // whenever we can actually run the match.
    let score = Number.isFinite(Number(faceMatchScore)) ? Math.round(Number(faceMatchScore)) : null;
    let passed = typeof faceMatchPassed === 'boolean' ? faceMatchPassed : null;
    let serverVerified = false;

    const selfieBuf = dataUrlToBuffer(selfie);
    const idBuf = dataUrlToBuffer(idImage);
    if (selfieBuf && idBuf) {
      try {
        const result = await this.matcher.compare(selfieBuf, idBuf);
        score = result.ok ? result.score : null;
        passed = result.ok ? result.match : false;
        serverVerified = true;
      } catch (e) {
        // Matcher unavailable (e.g. weights missing): don't block the worker —
        // keep the hint and let the admin confirm from the stored images.
        console.error('[verification] server face match unavailable:', e.message);
      }
    }

    // Keep the images so the admin can confirm the document is genuine and the
    // faces match. 'simulated' means no camera was available — nothing to store.
    const idDocument = typeof idImage === 'string' && idImage ? idImage : null;
    const keptSelfie = typeof selfie === 'string' && selfie && selfie !== 'simulated' ? selfie : null;
    const marker = `SIMULATED — online: ${serverVerified ? 'server-verified' : 'on-device'} face match `
      + `${score == null ? 'not conclusive' : `${score}%`} (ID + selfie kept for admin review)`;

    return { method: 'online', score, passed, marker, idDocument, selfie: keptSelfie };
  }
}

module.exports = OnlineVerification;
