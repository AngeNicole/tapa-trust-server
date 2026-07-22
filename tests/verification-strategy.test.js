// Unit tests for the OOP verification domain (src/domain/verification). These run
// with NO database and NO model load — the face matcher is injected as a stub,
// which is the point: the strategy classes are decoupled and testable in
// isolation. They cover abstraction, polymorphism, and the authoritative-override
// behavior of the online path.
const {
  VerificationStrategy, OnlineVerification, InPersonVerification, forPayload,
} = require('../src/domain/verification');

// A stub matcher standing in for FaceMatcher (dependency injection).
const stubMatcher = (result) => ({ compare: async () => result });

describe('VerificationStrategy (abstract base)', () => {
  test('cannot be instantiated directly', () => {
    expect(() => new VerificationStrategy({})).toThrow(/abstract/i);
  });
});

describe('forPayload factory (polymorphic dispatch)', () => {
  test('returns OnlineVerification for method "online"', () => {
    expect(forPayload({ method: 'online' })).toBeInstanceOf(OnlineVerification);
  });
  test('falls back to InPersonVerification otherwise', () => {
    expect(forPayload({ method: 'physical' })).toBeInstanceOf(InPersonVerification);
    expect(forPayload({})).toBeInstanceOf(InPersonVerification);
  });
});

describe('InPersonVerification.run()', () => {
  test('produces a pending physical outcome with no biometric or images', async () => {
    const out = await new InPersonVerification({}).run();
    expect(out).toMatchObject({
      method: 'physical', score: null, passed: null, idDocument: null, selfie: null,
    });
    expect(out.marker).toMatch(/in-person/i);
  });
});

describe('OnlineVerification.run()', () => {
  const IMG = 'data:image/jpeg;base64,AAAA';

  test('uses the SERVER verdict and ignores a spoofed client hint', async () => {
    // Client claims a passing 99%, but the (stub) server match says 88% / true.
    const out = await new OnlineVerification(
      { selfie: IMG, idImage: IMG, faceMatchScore: 99, faceMatchPassed: false },
      { matcher: stubMatcher({ ok: true, match: true, score: 88 }) }
    ).run();
    expect(out.score).toBe(88);
    expect(out.passed).toBe(true);
    expect(out.marker).toMatch(/server-verified/);
    expect(out.marker).toMatch(/88%/);
  });

  test('match-then-discard: images sent are never retained (idDocument/selfie null)', async () => {
    const out = await new OnlineVerification(
      { selfie: IMG, idImage: IMG },
      { matcher: stubMatcher({ ok: true, match: true, score: 70 }) }
    ).run();
    expect(out.idDocument).toBeNull();
    expect(out.selfie).toBeNull();
  });

  test('no face found → score null, passed false, and images still discarded', async () => {
    const out = await new OnlineVerification(
      { selfie: IMG, idImage: IMG },
      { matcher: stubMatcher({ ok: false, reason: 'No clear face detected on the ID' }) }
    ).run();
    expect(out.score).toBeNull();
    expect(out.passed).toBe(false);
    expect(out.idDocument).toBeNull();
    expect(out.selfie).toBeNull();
  });

  test("a 'simulated' selfie (no camera) is discarded like any other", async () => {
    const out = await new OnlineVerification(
      { selfie: 'simulated', idImage: IMG, faceMatchScore: 80, faceMatchPassed: true },
      { matcher: stubMatcher({ ok: true, match: true, score: 80 }) }
    ).run();
    expect(out.selfie).toBeNull();
    expect(out.idDocument).toBeNull();
  });
});
