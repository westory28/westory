# Westory Point Functions

This directory contains the trusted write path for the semester-scoped point system.

## Weplay: 역사가 내려와

The Weplay callables use the same semester point wallets and transaction ledger.
`getWeplayLobby`, `startWeplayGame`, `submitWeplayAnswer`, and `finishWeplayGame`
require a current student profile. Starts also require the configured active semester.
Policy reads require `point_read` or `point_manage`; `saveWeplayPolicy` requires
`point_manage`. All new `weplay_*` documents are server-only under the existing
Firestore default-deny rules.

A game lasts 60 seconds plus a 3-second preparation countdown. Its 20 words are
distributed 7/7/6 across three 20-second phases. Students choose `mild`, `medium`,
or `spicy`; fall durations are respectively 12/10/8, 10/8/6, or 8/6/4 seconds.
Only currently visible lesson HTML blanks and valid PDF page blanks are used,
with semester lessons shadowing legacy lessons, including hidden overrides.
Answers longer than 12 characters are excluded. Challenge difficulty does not
change the shared daily limit, participation cost, or result payout table.

Start request IDs, answer event IDs, and result settlement are idempotent. The
server checks its own receipt time and the actual session word; it does not accept
a submitted score. A disconnected game keeps its entry cost and is automatically
settled by `settleWeplayOnSchedule` every five minutes. Its result is also recovered
on the student's next lobby visit. Policies are snapshotted per game and per ranking
period. Weekly periods start Monday at midnight in Korea; monthly periods start on
the first. Rankings and first/second/third rewards are separate for each class and
difficulty. Ties use the earlier achieved record, then a stable internal ID.
Period settlement waits three minutes after the period ends, settles all outstanding
games first, and uses unique ledger/award documents to prevent duplicate rewards.

Verification from the repository root:

```powershell
npm --prefix functions run check
npm --prefix functions run test:weplay
firebase emulators:exec --config firebase.weplay-test.json --project demo-westory-weplay --only firestore,auth "node functions/scripts/verify-weplay-emulator.cjs"
```

The isolated emulator script refuses a production project and checks real exported
handlers, Firestore transaction contention, point ledger effects, policy snapshots,
rank rewards, deleted-user recovery, and authenticated direct-access denial.

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
