# Westory Point Functions

This directory contains the trusted write path for the semester-scoped point system.

Current callable functions:
- `applyPointActivityReward`
- `createPointPurchaseRequest`
- `adjustTeacherPoints`
- `reviewTeacherPointOrder`

## Local verification

Prerequisites:
- JDK 21 or newer available in the current shell
- `functions/node_modules` installed
- root `node_modules` installed
- Firebase CLI available through `npx firebase-tools`

Verified command on March 16, 2026:

```bash
firebase emulators:exec --project demo-westory-points --only auth,firestore,functions "node scripts/verify-point-system.mjs"
```

Result:
- Auth emulator started
- Firestore emulator started
- Functions emulator started
- End-to-end point verification script completed successfully

## What the emulator run covered

- Student own wallet read allowed
- Student direct wallet write blocked
- Teacher direct order write blocked
- Attendance reward first claim and duplicate prevention
- Quiz reward first claim and duplicate prevention
- Lesson reward first claim and duplicate prevention
- Purchase request failures for insufficient balance and sold-out product
- Purchase request success
- Teacher manual adjust permission check
- Teacher manual adjust reason requirement
- Teacher manual adjust success
- Order state transitions:
  - requested -> fulfilled blocked
  - requested -> approved allowed
  - approved -> fulfilled allowed
  - requested -> rejected allowed
  - requested -> cancelled allowed

## Deployment order

1. Confirm `firestore.rules` and Functions code are both ready.
2. Confirm `years/{year}/semesters/{semester}/point_policies/current` exists.
3. Confirm teacher accounts have `point_read` or `point_manage` as needed.
4. Deploy Functions and Firestore Rules in the same release window.
5. Deploy frontend after Functions and Rules are live.

## Remaining cautions

- Firebase emulator warns that the installed `firebase-functions` package is older than the latest available version.
- Functions `package.json` targets Node 20, but this machine ran the emulator with host Node 24. Production should still use the configured runtime.
- `point_products` and `point_policies` are still teacher-managed client writes, while wallet, transaction, and order writes are server-only.
