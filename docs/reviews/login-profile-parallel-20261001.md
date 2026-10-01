# Login profile latency — 2026-10-01

## Change and safety boundary

Baseline: `9e8af51065a3eb49074f0ec4cbe7d9465fb92758`, matching production deployment `dpl_CJztKoQfYAH4b2MkqwRLUjpdF1bo` on `www.westory.kr` before this patch.

The startup controller previously waited for `openApplicationSession` before subscribing to the user's profile. It now starts the own-profile subscription alongside that handshake, after reading the token's authentication epoch. Only a server-confirmed snapshot without pending writes is eligible. The controller still waits for successful session verification and a second epoch check before exposing identity, role, or onboarding. Cache/pending-write events invalidate any buffered snapshot. Existing generation fences, listener cleanup, retry rules, deadlines, and live profile updates remain in force.

The live Firestore rules release (updated September 29) was inspected through the read-only Rules API. `users/{userId}` permits an allowed authenticated account to read its own profile without an application-session prerequisite. The inspected rules are saved outside the repository at `%TEMP%\westory-login-speed-20261001\deployed-firestore.rules`. This was checked against deployed rules, not inferred from an old commit.

No Firebase initialization, persistence, OAuth redirect choice, permission policy, session duration, Functions, rules, maintenance, student-release settings, or UI layout changes are included. Settings still load after the session handshake. The local Functions source does not contain the deployed session handler; it is intentionally not deployed.

## Production baseline observations

Chrome's existing teacher account was used through normal Google sign-in. Opt-in `?westoryPerfLogin=1` console timestamps record these samples without storing identities or tokens:

| Operation | Auth SDK restoration | Session handshake | Subsequent profile wait | App-load to layout ready |
| --- | ---: | ---: | ---: | ---: |
| Google redirect return, sample 1 | 1,659 ms | 980 ms | 444 ms | 3,145 ms |
| Google redirect return, sample 2 | 1,795 ms | 926 ms | 1,521 ms | 4,309 ms |
| Existing-session reload, sample 1 | 305 ms | 1,297 ms | 254 ms | 1,863 ms |
| Existing-session reload, sample 2 | 388 ms | 1,173 ms | 515 ms | 2,084 ms |

These samples show variable network latency. The patch removes the serial profile wait; it does not eliminate Google authentication or the server handshake. Production before/after samples are observations, not a controlled benchmark or a universal latency guarantee.

## Validation and release

- `npm run build`: passed, including TypeScript and semester-archive guards; existing large-chunk warning only.
- `npm run format:check`: passed.
- `node scripts/verify-auth-route-gates.mjs`: passed.
- `node scripts/verify-history-dictionary-session.mjs`: passed.
- Local production build in the in-app browser: unauthenticated `/teacher/dashboard` redirects to `/`, login is available, no protected teacher navigation is mounted, and no console errors were reported.
- `node scripts/verify-application-session-startup.mjs`: 78 cases passed, including 15 new parallel-profile regressions.
- `node scripts/verify-login-bootstrap-performance.mjs`: three controlled comparisons against the baseline's actual controller source passed. With a simulated 800 ms handshake and 120 ms profile read, readiness changes from 920 to 800 ms; with a 1,200 ms profile read, 2,000 to 1,200 ms. Both versions make one handshake and one profile subscription. These are synthetic results.
- Read-only safety review found no new session bypass, stale-response, profile-buffer, or listener-cleanup issue.
- Production deployment identity and after-release timings will be saved separately under `%TEMP%\westory-login-speed-20261001` after domain verification. This commit documents pre-release validation, not completed deployment.

Rollback target: the baseline deployment above. A source rollback only needs to revert this frontend change; backend/rules rollback is not involved.
