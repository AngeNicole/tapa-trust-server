const VerificationStrategy = require('./VerificationStrategy');
const { dataUrlToBuffer } = require('../../lib/dataUrl');
const { defaultFaceMatcher } = require('../FaceMatcher');

// Online path: recompute the face match on the SERVER (authoritative, tamper-
// proof) using match-then-discard — the ID + selfie are compared transiently in
// memory and never retained (the outcome always carries idDocument: null and
// selfie: null). The matcher is injected so a stub can be used in tests
// (dependency inversion — no model load in unit tests).
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
        // keep the client's on-device hint and let the admin follow up.
        console.error('[verification] server face match unavailable:', e.message);
      }
    }

    // Match-then-discard: the images were compared in memory above and are never
    // retained. The outcome carries only the score + pass/fail verdict; the ID
    // and selfie are always null so they can never be persisted or retrieved.
    const marker = `SIMULATED — online: ${serverVerified ? 'server-verified' : 'on-device'} face match `
      + `${score == null ? 'not conclusive' : `${score}%`} (match-then-discard; no images retained)`;

    return { method: 'online', score, passed, marker, idDocument: null, selfie: null };
  }
}

module.exports = OnlineVerification;
