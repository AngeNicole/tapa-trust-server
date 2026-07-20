// Backward-compatible functional adapter over the FaceMatcher class
// (src/domain/FaceMatcher.js). Existing callers keep importing
// { compareFaces, MATCH_THRESHOLD, MATCH_DISTANCE } unchanged.
const { FaceMatcher, defaultFaceMatcher } = require('../domain/FaceMatcher');

function compareFaces(selfieBuffer, idBuffer) {
  return defaultFaceMatcher.compare(selfieBuffer, idBuffer);
}

module.exports = {
  compareFaces,
  MATCH_THRESHOLD: FaceMatcher.MATCH_THRESHOLD,
  MATCH_DISTANCE: FaceMatcher.MATCH_DISTANCE,
};
