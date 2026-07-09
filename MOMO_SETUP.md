# MTN MoMo sandbox — setup

The escrow **deposit** can make a real MTN MoMo **sandbox** "request to pay"
collection from the requester. It's **sandbox only — no real money, no KYC**, and
fully optional: with no keys set, the deposit uses the existing simulated flow
and nothing changes. Release/payout stays simulated (Disbursements is a separate
product, out of scope).

## One-time setup (~5 min)

1. Create a free account at **https://momodeveloper.mtn.com**.
2. Subscribe to the **Collections** product. Open your profile → copy the
   **Primary Key** (this is your subscription key).
3. In `tapa-trust-server/.env`, set:
   ```
   MOMO_SUBSCRIPTION_KEY=<your Collections primary key>
   ```
4. Provision a sandbox API user + key (uses only the subscription key):
   ```
   npm run momo:provision
   ```
   It prints two lines — paste them into `.env`:
   ```
   MOMO_API_USER=<printed uuid>
   MOMO_API_KEY=<printed key>
   ```
5. Restart the server. Done — the next escrow deposit will call the sandbox.

For the **deployed** API (Render), add the same three env vars in the Render
dashboard (Environment) and redeploy.

## How it behaves

- **Deposit** (`POST /bookings/:id/escrow/deposit`): if all three MoMo vars are
  present, the server calls `requesttopay` for the agreed amount against the
  requester's phone (sandbox MSISDN), stores the reference on `payment_status
  .momo_reference`, and holds escrow. The worker's notification reads
  "collected via MoMo (sandbox)".
- **No keys / any error** → falls back to the simulated hold, so the trust loop
  is never blocked.
- Sandbox currency is **EUR** and amounts/numbers are test values.

## Notes

- The freeze-on-dispute and release-on-completion logic is unchanged and already
  demonstrable on the simulated status; MoMo just makes the *deposit* real-looking.
- Real production MoMo/Airtel/eKash (real funds, disbursement payouts, RWF,
  compliance/KYC) is future work.
