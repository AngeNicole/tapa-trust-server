const crypto = require('crypto');

// MTN MoMo Collections — SANDBOX client. Collects the escrow deposit from the
// requester as a real-looking "request to pay". Entirely gated on env vars: when
// they're absent the caller falls back to the simulated flow, so nothing breaks
// without keys. No real money — sandbox uses EUR and test MSISDNs.
//
// Required env (see MOMO_SETUP.md):
//   MOMO_SUBSCRIPTION_KEY  — Collections product subscription key (from portal)
//   MOMO_API_USER          — provisioned API user UUID (npm run momo:provision)
//   MOMO_API_KEY           — provisioned API key
// Optional:
//   MOMO_BASE_URL   (default https://sandbox.momodeveloper.mtn.com)
//   MOMO_TARGET_ENV (default sandbox)
//   MOMO_CURRENCY   (default EUR — sandbox requires EUR)
const BASE = process.env.MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const TARGET_ENV = process.env.MOMO_TARGET_ENV || 'sandbox';
const CURRENCY = process.env.MOMO_CURRENCY || 'EUR';
const SUB_KEY = process.env.MOMO_SUBSCRIPTION_KEY;
const API_USER = process.env.MOMO_API_USER;
const API_KEY = process.env.MOMO_API_KEY;

function momoEnabled() {
  return Boolean(SUB_KEY && API_USER && API_KEY);
}

// Sandbox accepts arbitrary MSISDNs; force digits and fall back to a known test
// number so a malformed/empty phone never breaks the request.
function toMsisdn(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits : '46733123450';
}

async function getToken() {
  const auth = Buffer.from(`${API_USER}:${API_KEY}`).toString('base64');
  const res = await fetch(`${BASE}/collection/token/`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Ocp-Apim-Subscription-Key': SUB_KEY },
  });
  if (!res.ok) throw new Error(`MoMo token failed (${res.status})`);
  const body = await res.json();
  return body.access_token;
}

// Initiate a collection from the requester. Returns { referenceId }.
// requesttopay responds 202 with no body; the X-Reference-Id we send IS the id.
async function requestToPay({ amount, phone, externalId, message }) {
  const token = await getToken();
  const referenceId = crypto.randomUUID();
  const res = await fetch(`${BASE}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Reference-Id': referenceId,
      'X-Target-Environment': TARGET_ENV,
      'Ocp-Apim-Subscription-Key': SUB_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: String(Math.round(Number(amount) || 0)),
      currency: CURRENCY,
      externalId: String(externalId),
      payer: { partyIdType: 'MSISDN', partyId: toMsisdn(phone) },
      payerMessage: message || 'TaPa Trust escrow deposit',
      payeeNote: message || 'TaPa Trust escrow deposit',
    }),
  });
  if (res.status !== 202) {
    const txt = await res.text().catch(() => '');
    throw new Error(`MoMo requestToPay failed (${res.status}) ${txt}`.trim());
  }
  return { referenceId };
}

// PENDING | SUCCESSFUL | FAILED
async function getRequestStatus(referenceId) {
  const token = await getToken();
  const res = await fetch(`${BASE}/collection/v1_0/requesttopay/${referenceId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Target-Environment': TARGET_ENV,
      'Ocp-Apim-Subscription-Key': SUB_KEY,
    },
  });
  if (!res.ok) throw new Error(`MoMo status failed (${res.status})`);
  return res.json();
}

module.exports = { momoEnabled, requestToPay, getRequestStatus, CURRENCY, TARGET_ENV, BASE };
