# Point System Operations Checklist

## Verification status

Verified on March 16, 2026 with local Firebase emulators.

Completed:
- `npm exec tsc -- --noEmit`
- `npm run build`
- `node --check functions/index.js`
- `firebase emulators:exec --project demo-westory-points --only auth,firestore,functions "node scripts/verify-point-system.mjs"`

The emulator run passed the core point scenarios for rewards, purchases, teacher adjustments, and order reviews.

## Pre-deploy checklist

- Confirm `firestore.rules` in the deploy target matches the current repository version.
- Confirm Functions source in `functions/index.js` is the current repository version.
- Confirm `point_policies/current` exists for the target year and semester.
- Confirm teacher test or production accounts have `point_read` and `point_manage` as intended.
- Confirm at least one active product exists if student purchase flow will be enabled immediately.

## Recommended deployment order

1. Deploy Firestore Rules.
2. Deploy Functions.
3. Verify `point_policies/current` and teacher permissions in the target project.
4. Deploy frontend.
5. Run a short smoke test:
   - attendance reward
   - quiz reward
   - lesson reward
   - purchase request
   - teacher approve and fulfill

## Emulator verification summary

- Rules:
  - student own wallet read: pass
  - student direct wallet write: blocked
  - teacher direct order write: blocked
- Reward flows:
  - attendance first claim: pass
  - attendance duplicate: pass
  - quiz first claim: pass
  - quiz duplicate: pass
  - lesson first claim: pass
  - lesson duplicate: pass
- Purchase flows:
  - insufficient balance: pass
  - sold-out product: pass
  - normal purchase request: pass
- Teacher flows:
  - point manager required: pass
  - manual adjust reason required: pass
  - manual adjust success: pass
  - direct fulfill from requested blocked: pass
  - approve: pass
  - fulfill after approve: pass
  - reject: pass
  - cancel: pass

## Data integrity notes from emulator run

- Final student wallet balance after the full scenario set: `29`
- Reward transaction counts:
  - attendance: `1`
  - quiz: `1`
  - lesson: `1`
- Manual adjust transaction count: `2`
  - one bootstrap adjust used by the verification script
  - one explicit teacher manual adjust test
- Final order states:
  - approved flow order: `fulfilled`
  - rejection flow order: `rejected`
  - cancel flow order: `cancelled`
- Final `gift` product stock after purchase, reject, and cancel flows: `4`

## Remaining operational risks

- Emulator showed a warning that `firebase-functions` is not on the latest version.
- Emulator used host Node 24 while `functions/package.json` targets Node 20.
- Production should still be smoke-tested once after deploy because emulator verification does not replace real project config checks.
