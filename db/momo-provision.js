require('dotenv').config();
const crypto = require('crypto');

// One-time MTN MoMo SANDBOX provisioning. With only your Collections
// subscription key set (MOMO_SUBSCRIPTION_KEY), this creates a sandbox API user
// + API key and prints them to paste into .env. No real money, no KYC.
//
//   1. Sign up at https://momodeveloper.mtn.com, subscribe to "Collections",
//      copy the "Primary Key" → put it in .env as MOMO_SUBSCRIPTION_KEY.
//   2. Run:  npm run momo:provision
//   3. Paste the printed MOMO_API_USER and MOMO_API_KEY into .env.
const BASE = process.env.MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const SUB_KEY = process.env.MOMO_SUBSCRIPTION_KEY;

async function main() {
  if (!SUB_KEY) {
    console.error('MOMO_SUBSCRIPTION_KEY is not set. Subscribe to "Collections" on the MoMo portal and put its Primary Key in .env first.');
    process.exit(1);
  }
  const apiUser = crypto.randomUUID();

  // 1. Create the API user (X-Reference-Id becomes the user id).
  let res = await fetch(`${BASE}/v1_0/apiuser`, {
    method: 'POST',
    headers: {
      'X-Reference-Id': apiUser,
      'Ocp-Apim-Subscription-Key': SUB_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ providerCallbackHost: 'localhost' }),
  });
  if (res.status !== 201) {
    console.error(`Create API user failed (${res.status}):`, await res.text().catch(() => ''));
    process.exit(1);
  }

  // 2. Generate the API key for that user.
  res = await fetch(`${BASE}/v1_0/apiuser/${apiUser}/apikey`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': SUB_KEY },
  });
  if (res.status !== 201) {
    console.error(`Create API key failed (${res.status}):`, await res.text().catch(() => ''));
    process.exit(1);
  }
  const { apiKey } = await res.json();

  console.log('\n✅ Sandbox API user provisioned. Add these to your .env:\n');
  console.log(`MOMO_API_USER=${apiUser}`);
  console.log(`MOMO_API_KEY=${apiKey}\n`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
