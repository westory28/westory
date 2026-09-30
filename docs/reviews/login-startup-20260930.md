# Login startup patch verification — 2026-09-30

## Scope and integration

- Baseline: `424415555416fdefc577ba607da50f1190e092b0`.
- Independent branch: `codex/login-startup-performance-20260930`.
- Independent source: `%TEMP%\westory-login-startup-20260930\westory`.
- Original `C:\westory` remains clean on the baseline. The public-entry UI branch is separate.
- Integrate the Login logic changes with `codex/public-entry-intro` deliberately. Preserve the new recovery branch, flow ownership checks, shared bootstrap consumption, and onboarding dialog accessibility when resolving Login.tsx conflicts.
- No Firebase initialization, persistence, auth domain, Functions, rules, session-expiry policy, deployment config, release/allowlist configuration, or rank configuration changes. No production writes, push, merge, or deployment were performed.

## Behavior

Auth restoration now owns a generation-scoped startup operation: token epoch validation, server session handshake, then a server-confirmed profile snapshot. Cached snapshots and pending local writes cannot expose a portal user. A missing server profile exposes only a Login onboarding candidate. The route layout checks phase, profile UID, and teacher permissions before mounting protected content.

Login can consume the startup operation it joined while it was pending once. A later independent Login flow and every explicit retry perform a fresh server handshake; completed sessions are not cached for reuse. The existing in-flight callable is drained before retry because Firebase's callable transport cannot be aborted. The old response cannot unlock the new generation.

Each startup has a 15-second deadline. Network portions of redirect acquisition, persistence waiting, roster/consent lookup, and blocking profile writes also have bounded waits; time spent choosing an OAuth account or filling an onboarding form is not timed out. Errors offer retry or sign-out/re-login. Logout, account changes, new auth epochs, and abandoned login operations fence late work. Interactive SDK callbacks alone cannot complete a popup login; its owning flow must accept the credential. Cleanup of an abandoned result preserves a newer chooser and a newer flow's already accepted SDK object.

Blocking profile writes wait for a server snapshot matching their semantic fields before routing. Modal focus enters the form, stays inside with Tab/Shift+Tab, and Escape performs the same cancellation as the button. Cancel buttons have at least 44px height.

Opt-in `?westoryPerfLogin=1` (before the hash) records token, session, profile, bootstrap, and route stages. Metadata is allowlisted to finite counters, booleans, and fixed enums. No UID, email, token, pathname, or arbitrary error object is added to these measurements.

## Verification

| Check | Result |
| --- | --- |
| `node scripts/verify-application-session-startup.mjs` | 63 deterministic cases passed |
| `node scripts/verify-auth-route-gates.mjs` | Render gates and recovery actions passed |
| `node scripts/verify-history-dictionary-session.mjs` | Existing session/proof/epoch/failure checks passed |
| `node scripts/verify-login-bootstrap-performance.mjs` | Controlled source experiment passed |
| `node scripts/verify-auth-startup-browser.mjs` | 61 real-browser UI checks; 41 PNGs; no issues or page errors |
| `npm run typecheck` | Passed |
| `npm run format:check` | All source files passed |
| `npm run build` | Passed, including semester archive guards; existing large-chunk warning |
| Changed verification scripts: Prettier and Node syntax | Passed |
| `git diff --check` | Passed |

The repository has no separate lint or root test script. TypeScript, full-source Prettier, the relevant Node regressions, and the build were used. The Windows sandbox initially blocked esbuild child processes; the approved local build and isolated browser checks succeeded outside that restriction.

The browser fixture loads the actual Login, MainLayout, and AuthRecoveryState components with synthetic Firebase/AuthContext state in a new headless Edge process. It never controls the user's existing browsers or contacts Firebase. It covers 390/768/1280px layouts, keyboard/touch recovery, offline failure, forced re-login, popup cancellation, onboarding completion/cancellation, and server acknowledgement before portal rendering. Local Tailwind is used; remote fonts/icons are blocked. It does not establish real OAuth, Safari, production authorization, or deployment correctness.

UI evidence: sibling `../evidence/auth-startup-browser/report.json` and PNG files. The final report records source hashes; Login hash is `0f29c1f740a24ff9d8e7ea24310939d55845d63804f6d9adc28202e9cf32d066`. A real 15-second timer with a deliberately stalled synthetic redirect restored actions at 15,171ms. That is recovery-timer evidence, not normal-login latency.

## Performance comparison and limits

The benchmark executes baseline Provider/Login bootstrap source and the patched controller against the same virtual scheduler: session RPC 800ms, profile response 120ms. Profile counts below are logical consumers, not measured Firestore network requests.

| Scenario | Session RPCs before → after | Profile consumers before → after | Route-ready virtual time before → after |
| --- | --- | --- | --- |
| Concurrent Provider/Login startup | 1 → 1 | 2 → 1 | 920 → 920ms |
| Login consumes a startup it joined, after Provider completion | 2 → 1 | 2 → 1 | 1920 → 1000ms |

There is no measured production speedup. OAuth/persistence latency, real network delay, backend cold start, and production account behavior were not measured. The first patch proves removal of duplicate logical work and bounds failure recovery; it does not claim to eliminate backend latency.

## Remaining release gates and rollback

Parent integration must complete real HTTPS login/smoke tests in the explicitly designated teacher (westoria28) and student browser sessions after the browser-control queue permits it. Check fresh login, refresh, expired/reauth-required session, logout and stale response, account switching, teacher/student permissions, missing-profile onboarding, offline failure/retry, and the public-entry UI integration. Record token/session/profile/route timings without identity or token data.

Read and preserve the actual production maintenance/release/student access/allowlist state and the concurrent Joseon rank settings before deployment. This patch does not change them, but their current production values were not verified here. Do not open access to all students or schedule an opening. Until these checks are completed, this is a verified local patch awaiting integrated release QA, not a production-ready completion claim.

The deployed openApplicationSession source was previously verified read-only against commit `b7cb77b`, revision `openapplicationsession-00003-bey`; the checkout does not contain that deployed implementation. Deploy frontend only after parent review. Do not deploy Functions/rules from this baseline to resolve drift.

For release rollback, retain the prior verified Vercel production deployment/commit. If login smoke fails, restore that prior deployment to the production domain and verify teacher/student access again. Revert this frontend commit through the integration branch for source history. No backend or rules rollback should be necessary because this patch does not change them.

If live stage timing still shows long session waits, the next separately reviewed candidates are backend cold-start/module loading and the deployed session transaction path, after recovering and reconciling its authoritative source. Persistence/redirect initialization remains a separate compatibility investigation; do not change it on the strength of synthetic timing.

## Integrated release checkpoint - 2026-10-01

The patch was integrated onto remote main `7b2d268749c25b5c878e364f2d5a883714aa674c` in `%TEMP%\westory-release-20261001\westory`, branch `codex/login-release-20261001`. Public entry and the Joseon rank correction are preserved. Auth implementation commit: `974d5ab19f5070a58512fc5323f3ad64679e8c3f`. The earlier scope/verification sections describe the original independent patch, not current deployment status.

Integration resolves Login's dialog semantics with a single outer dialog, keeps accessible labels, and runs the legacy focus handler only for `?entry=classic`; PublicEntry owns the normal focus handling. Both ignore IME composition Escape. A separate read-only safety review approved the integration. No auth core behavior changed during integration.

Repeated checks: 63 auth regression cases; route-gate/recovery tests; existing session proof tests; controlled performance comparison; full-source Prettier; TypeScript; production build and semester archive verification all passed. Integrated browser QA passed 81 checks with 51 screenshots, including PublicEntry at 320/390/768/1280px and classic at 390/768/1280px, modal focus/IME/scroll locking, retry and server acknowledgement before rendering. Evidence: sibling `../evidence/auth-startup-browser/report.json`. These are synthetic-auth browser checks, not real OAuth or production speed measurements.

Production read-only baseline: student maintenance enabled, blockedRoles includes student, one existing bypass entry (identity omitted). Five Joseon grades and point policy hash match the verified rank task. Baseline production deployment: `dpl_6zkEgbnqeNFA2hQfP8YtNTPJS4H3`, source main `7b2d268749c25b5c878e364f2d5a883714aa674c`. Retain this deployment for rollback. Settings hashes/update times are in `%TEMP%\westory-login-preservation-20261001\evidence\before.json`; compare after frontend release. Functions/rules and all access/rank settings remain outside the deployment scope.

Release status at this commit: integration and local validation complete; production push, domain verification and live-account smoke must be recorded in the external release evidence after deployment. Do not interpret this checkpoint as completed production verification.
