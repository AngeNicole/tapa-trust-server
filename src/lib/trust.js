// Shared trust helpers — single source of truth so the authed and public worker
// projections can't drift.

// Two-tier trust state: a worker is either admin-verified (and therefore
// bookable / visible in browse) or not. Verification by an admin is the single
// gate to work — there is no "earn it from jobs" path, because an unverified
// worker can't be booked in the first place (see createWorkerBooking).
//   Admin-Certified — an admin reviewed & approved their submission (verified).
//   Unverified      — not yet approved; cannot be booked or surfaced publicly.
// (completedJobs/rating are accepted for signature compatibility but no longer
// affect the tier.)
function computeTier(verification) {
  return verification === 'verified' ? 'Admin-Certified' : 'Unverified';
}

module.exports = { computeTier };
