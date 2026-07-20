// Abstract base for a worker verification path (Strategy pattern). Subclasses
// implement run() to turn a submission into a normalized outcome the controller
// persists: { method, score, passed, marker, idDocument, selfie }.
//
// Demonstrates:
//   • ABSTRACTION  — this base defines the contract and can't be instantiated.
//   • INHERITANCE  — OnlineVerification / InPersonVerification extend it.
//   • POLYMORPHISM — the factory returns a subclass and the controller calls
//                    run() without knowing (or caring) which one it got.
class VerificationStrategy {
  constructor(payload = {}) {
    if (new.target === VerificationStrategy) {
      throw new Error('VerificationStrategy is abstract — instantiate a subclass');
    }
    this.payload = payload;
  }

  // Which verification method this strategy represents ('online' | 'physical').
  get method() {
    throw new Error(`${this.constructor.name} must define a method getter`);
  }

  // Produce the normalized outcome. Async because some paths (online) do I/O.
  async run() {
    throw new Error(`${this.constructor.name} must implement run()`);
  }
}

module.exports = VerificationStrategy;
