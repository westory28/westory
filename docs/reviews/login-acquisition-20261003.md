# First Google login latency — 2026-10-03

Baseline: `dd688617ace8ade4b8c3d10cc53d33f974360593`, deployed to `www.westory.kr` as `dpl_FAoT99KnmE1rv9N3fVLCE6UB7c32` before this change.

## Diagnosis and change

The embedded-browser workaround introduced by `efb65ab9` forced every HTTPS browser to redirect. Regular desktop Chrome, Edge, and Firefox therefore discarded the loaded application and restored Firebase again after Google account selection. A production Chrome observation measured 3,121 ms from login click to the chooser and 5,968 ms from account selection to layout readiness. The latter included 2,793 ms from application load to layout readiness, including approximately 1,800 ms of SDK/redirect restoration. These are warm-browser observations, not cold-cache benchmarks or a universal timing guarantee.

The login policy now uses popup acquisition for recognizable desktop Chromium/Firefox browsers. Mobile, Safari, touch iPad desktop mode, known embedded user agents, WebView2 hosts, frames, and unknown browsers retain redirect acquisition. Localhost behavior is preserved. User-agent and host-bridge detection cannot identify every browser that conceals its embedded environment.

The Login screen starts standard Google preconnect hints and prepares the Functions SDK module without calling a backend function. Both are optional optimizations, not authority or cached verification. The semester archive skips this preparation. Links are removed on unmount.

Popup cancellation clears the pending attempt and restores controls without automatically starting a redirect. Actual popup/environment failures retain the existing redirect fallback. A stale fallback waiting for persistence exits without reporting against or unlocking a newer attempt. Opt-in timing marks identify login request and popup credential receipt without identifiers or tokens.

## Security boundary

- Google account selection remains explicit (`prompt: select_account`).
- School-email restrictions, server-confirmed user profile, server session handshake, token authentication epoch, role/onboarding checks, generation fences, and route gates remain in place.
- Popup acquisition still occurs directly from the click path; no new await precedes it.
- No session authority is cached, extended, bypassed, or issued speculatively.
- Firebase auth domain, persistence, proxy, Functions, Firestore/Storage rules, and backend settings are unchanged. The current checkout lacks the deployed session function source; no backend deployment is included.
- The other session calls observed after teacher layout readiness belong to deferred portal features, not three sequential login gates. They are outside this patch.

## Validation before release

- `npm run build`: passed, including TypeScript and semester-archive guards; existing large-chunk warning only.
- `npm run format:check`: passed.
- `node scripts/verify-login-acquisition.mjs`: 49 deterministic cases passed using the real Login helpers/acquisition closure and synthetic SDK boundaries. Covers browser choice, chooser prompt, persistence ordering, cancellation, popup failure fallback, acquired credential failure, stale/unmounted responses, and newer-attempt ownership.
- `node scripts/verify-application-session-startup.mjs`: 78 security/startup regressions passed.
- `node scripts/verify-auth-route-gates.mjs`: passed.
- Local production build in Chrome: popup chooser opened, closing it restored login controls and cancellation text without a redirect. Retrying and selecting the existing administrator account reached the teacher dashboard. The browser automation could read but not click the popup reliably; the user completed the account selection. Credential receipt to layout readiness was 1,132 ms, with no application reload. This interval excludes the user's selection time and is not directly comparable to the full production baseline.
- Independent read-only review found no remaining actionable authentication or authorization regression.

Production deployment identity, domain bundle verification, and after-release observations are recorded separately in `%TEMP%\westory-login-speed-20261003` after release. This document records pre-release validation, not a claim that deployment is already complete.

Rollback target: baseline deployment above; source rollback requires reverting this frontend patch only.
