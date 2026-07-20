const VerificationStrategy = require('./VerificationStrategy');

// In-person path: an admin/office/agent confirms identity — no device, no upload,
// no biometrics (the inclusive path for a worker without a capable phone). There's
// nothing to compute or store beyond the pending marker; the admin approves later.
class InPersonVerification extends VerificationStrategy {
  get method() { return 'physical'; }

  async run() {
    return {
      method: 'physical',
      score: null,
      passed: null,
      marker: 'SIMULATED — in-person: awaiting admin/office confirmation',
      idDocument: null,
      selfie: null,
    };
  }
}

module.exports = InPersonVerification;
