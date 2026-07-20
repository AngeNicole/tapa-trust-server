const VerificationStrategy = require('./VerificationStrategy');
const OnlineVerification = require('./OnlineVerification');
const InPersonVerification = require('./InPersonVerification');

// Factory (polymorphic dispatch): choose the strategy for a submission. Anything
// that isn't an explicit 'online' request falls back to the in-person path.
// `deps` (e.g. { matcher }) is forwarded to the strategy for testability.
function forPayload(payload = {}, deps = {}) {
  return payload.method === 'online'
    ? new OnlineVerification(payload, deps)
    : new InPersonVerification(payload, deps);
}

module.exports = { VerificationStrategy, OnlineVerification, InPersonVerification, forPayload };
