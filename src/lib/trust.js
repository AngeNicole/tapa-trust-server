// Shared trust helpers — single source of truth so the authed and public worker
// projections can't drift.

// Three-tier trust ladder, derived from a worker's real signals:
//   Admin-Certified — an admin reviewed & approved their submission (verified).
//   Peer-Verified   — proven by peers: >= 2 completed jobs with >= 4.0 avg rating.
//   Unverified      — neither yet.
function computeTier(verification, completedJobs = 0, rating = 0) {
  if (verification === 'verified') return 'Admin-Certified';
  if (Number(completedJobs) >= 2 && Number(rating) >= 4) return 'Peer-Verified';
  return 'Unverified';
}

module.exports = { computeTier };
