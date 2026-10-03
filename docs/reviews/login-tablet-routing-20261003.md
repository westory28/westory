# Tablet-safe login acquisition — 2026-10-03

Baseline: `de9d3dde2b5bf2024f444ec79fa12caf56991038`, production deployment `dpl_EHGu3j9Qry2vBMoB5syNiAQthvBw` on `www.westory.kr`.

## Decision

The previous patch could select popup login on Galaxy Tab Chrome in desktop-site mode: Chrome documents that this mode reports a Linux desktop user agent and Linux platform instead of Android. Samsung Internet DeX has a similar desktop user agent. A source-extracted comparison reproduced redirect before `de9d3dd` and popup after it. This was a policy regression, not a claim of observed OAuth failure on a physical tablet.

Popup now requires a recognized Windows/macOS Chrome/Chromium/Edge/Firefox browser, exactly zero supported touch points, a fine primary pointer, hover support, and no coarse pointing device. Existing Safari, mobile, embedded browser, WebView2, frame and localhost rules remain. Missing or throwing capability APIs choose redirect. Screen width and orientation are not used.

| Environment | Acquisition |
| --- | --- |
| Non-touch Windows/macOS desktop with fine pointer and hover | Popup |
| Galaxy Tab Chrome, regular or desktop-site mode, with or without mouse | Redirect |
| Android desktop-shaped Linux user agent, including absent touch information | Redirect |
| iPhone/iPad, including desktop-site mode | Redirect |
| Samsung Internet DeX, Windows tablets, touch laptops | Redirect |
| Linux desktop, ChromeOS, unknown or incomplete capabilities | Redirect |

The conservative tradeoff is that genuine Linux desktops, Chromebooks and touch laptops keep the pre-optimization redirect flow. They do not receive the desktop popup speedup. A concealed embedded environment cannot always be identified, so the existing popup-error fallback remains necessary.

Official references: [Chrome tablet desktop mode](https://developer.chrome.com/blog/desktop-mode), [Samsung DeX](https://developer.samsung.com/browser/android/web-development-guide-for-dex.html), [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin).

## Performance and security

The only production logic change is acquisition-policy selection. There is no new asynchronous work before the chooser. The Functions SDK preparation, Google preconnect hints, shared session bootstrap and parallel server-profile read are unchanged. Google account selection stays explicit; the existing server session, authentication epoch, role, allowed-email, profile and stale-attempt checks remain mandatory for either acquisition method. Auth initialization, storage persistence, routing, Functions and security rules are unchanged.

Controlled source experiments still show an 800 ms handshake plus 120 ms profile read completing in 800 ms rather than 920 ms; an 800 ms handshake plus 1,200 ms profile read completes in 1,200 ms rather than 2,000 ms. These are synthetic scheduler measurements, not physical-device or production speed promises.

## Validation

- `npm run build`: passed, including TypeScript and archive guards; existing bundle-size warning only.
- `npm run format:check`: passed.
- `node scripts/verify-login-acquisition.mjs`: 80 cases passed, including tablet desktop user agents, external mouse, missing/invalid capabilities, popup cancellation, fallback, both roles and stale attempts.
- `node scripts/verify-login-redirect-recovery.mjs`: 21 source-driven cases passed, including marker expiry, null results, cancellation, persistence ordering, StrictMode, cleanup, timeout and failed bootstrap. Existing storage-denial limitations are identified as such.
- `node scripts/verify-application-session-startup.mjs`: 78 cases passed.
- `node scripts/verify-auth-route-gates.mjs`: passed.
- `node scripts/verify-login-bootstrap-performance.mjs`: three controlled before/after scenarios passed.
- Independent review found no new authority bypass, stale-attempt or added serial wait.
- CUA with isolated synthetic services: at 390 px, failed authentication exposes retry/relogin controls and retry keeps protected content gated; redirect acquisition reaches its real 15-second deadline and restores both login buttons with the timeout notice. At 768 px, popup cancellation restores both login buttons and displays the cancellation notice. The fixture's missing Vite `BASE_URL` was also repaired before these checks.

The isolated browser fixture is maintained separately from production: the missing Functions SDK preparation mock is restored and a serve-only mode allows CUA to inspect real React rendering without launching another browser automation runtime. It uses synthetic identities and prevents remote resource access. Synthetic browser checks and desktop viewport resizing do not emulate Android Chrome or Safari storage/OAuth behavior.

Production release identity, asset verification, desktop smoke observations and any physical-device confirmation are recorded separately under `%TEMP%\westory-login-tablet-release-20261003` after promotion. This document does not claim physical Galaxy Tab OAuth verification.

Rollback: reverting this patch returns to the known tablet classification gap in `de9d3dd`. For an acquisition-only safety rollback, preserve the parallel bootstrap and restore redirect for all production browsers instead of rolling back the performance/security startup patches.
