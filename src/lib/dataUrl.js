// Decode a base64 data URL (e.g. "data:image/jpeg;base64,....") to a Buffer.
// Returns null for anything that isn't a non-empty data URL. Shared by the
// verification strategy and the face-match endpoint.
function dataUrlToBuffer(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl) return null;
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

module.exports = { dataUrlToBuffer };
