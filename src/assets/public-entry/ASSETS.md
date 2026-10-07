# Public entry preview assets

## Score confirmation and naval detail (2026-10-01)

`confirmation-score.webp` (40,278 bytes), `confirmation-question.webp` (38,532 bytes), and `confirmation-signature.webp` (27,250 bytes) are 1280×960 captures of the actual `ScoreConfirmationView` exported by `src/pages/student/PerformanceScoreView.tsx`. A local-only harness supplied a fictional 52/60 history evaluation and no student identifier. Firebase imports, loaders, authentication, notification and write functions were replaced with offline fixtures or throwing stubs; CSP blocked external connections. The original page and modal JSX/CSS were retained. The small header is capture-only framing. No real student account, score, signature or inquiry was read or submitted. The last image deliberately keeps the signature field empty. Raw screenshots and harness are in ignored `.superloopy/sessions/2026-10-01-home-details/`.

The three images total 106,060 bytes, load lazily, and slide inside a CSS tablet. The homepage reuses the game's existing `yi-sunsin-cutin.webp` (206,926 bytes) and `impact-lines.webp` (440,682 bytes) for the commander entrance without importing game logic, playing video or making game requests.

## Current homepage: distinct teaching materials (2026-10-07)

The white-background homepage uses user-authorized teaching materials. The hero and three lesson slides each show a different published lesson. These five optimized, content-hashed WebP imports total **650,714 bytes** (about 635 KiB), including the unchanged map. Images outside the hero load lazily. The homepage does not fetch lessons, maps, student records, or cloud responses from Firebase.

| File | Bytes | Source |
| --- | ---: | --- |
| `hero-lesson-real.webp` | 119,848 | Hero: actual `LessonWorksheetStage` in `student-solve` mode with **① 조선 건국, 500년 역사의 시작**, 28 blank definitions |
| `worksheet-real.webp` | 107,824 | 한눈에 연결: first page of the published 2026-2 lesson **① 훈구와 사림의 대립** |
| `heritage-real.webp` | 205,924 | First page of the published 2026-2 lesson **② 조선 전기의 문화 유산** |
| `map-real.webp` | 100,968 | Existing **한반도 역사 지리** map resource |
| `lesson-real.webp` | 116,150 | 직접 채우기: actual `LessonWorksheetStage` in `student-solve` mode with **③ 조선 전기 지방 행정과 대외 관계**, 43 blank definitions |

The worksheet images retain their original author attribution. The two lesson screens are 1340×1050 captures of the real worksheet renderer with no persistence or annotation callbacks, not a claim that their minimal capture-only shell matches the entire authenticated portal. The overview is 1500×1060. No student account, answer, score, or identifier appears in these assets.

The 2026-10-07 refresh checked `site_settings/semester_active` (2026-2) and `isVisibleToStudents=true` before reading the selected lesson images and blank definitions. Source documents under `years/2026/semesters/2/lessons` are `unit-u-1789561583911` (hero), `unit-u-1789646074545` (overview), `unit-u-1789561708924` (fill), and `unit-u-1789646373378` (unchanged heritage). The former repeated **② 500년 국가의 기틀 확립** is no longer used. Keep these four lesson identities distinct when refreshing previews.

Read-only retrieval and capture scripts, local-only fixtures, original images, and capture checks are in ignored `.superloopy/entry-worksheets/` in the task worktree. Source URLs were immediately replaced with local image paths in those fixtures; neither Storage download tokens nor credentials are published. The real renderer displayed all 28/43 blank inputs, with zero external requests and zero rendering errors during capture. Production lesson documents and student work were not changed.

`entryMaterial.ts` contains the existing question 133 about Pericles and its original choices/explanation, plus 22 anonymous word/count aggregates from the actual **한국사라고 하면 떠오르는 것은?** activity. The first-semester activity was used because the current semester's activities had no responses. Only normalized response text was requested; submitter identities were not loaded. Irrelevant words were excluded. `WordCloudView` renders those aggregates locally, with `showSubmitters={false}`. The homepage's word additions and quiz choices are temporary local demonstrations.

The score calculator and growth line graph use explicitly labeled fictional values. The calculator reuses `getGradeBand` and its rounding convention; its 60/40 weights are a demonstration, not a fetched grading plan. Game art still comes from the existing naval-game assets without starting gameplay. CSS builds the device mockups; no video, 3D engine, remote rendering, or animation package is added.

The original 2026-10-01 source retrieval and capture evidence were kept in ignored `.superloopy/sessions/2026-10-01-public-entry-v2/`. The 2026-10-07 browser checks in `.superloopy/entry-worksheets/` cover 1280×900, 768×1024, 390×844, 320×568, and 1280×650: four distinct image sources, all three slides by keyboard, no horizontal page overflow, no failed images or runtime errors, and desktop scroll-driven slide changes. Build (including type and semester-archive checks) and full source formatting checks passed. Raw server metadata and token-bearing source URLs are not published or committed.

## Previous previews (retained, not used by the current homepage)

Captured 2026-09-30 from the actual Westory source at baseline `4244155` in the isolated working copy. These are static screenshots, not embedded application instances. No production student, school, notice, score, account session, or credential was used.

## Files

| File | Raster size | Bytes | Source |
| --- | --- | ---: | --- |
| `dashboard-desktop.webp` | 1280 × 800 | 65,166 | Student `Dashboard`, `MainLayout`, `StudentWeekSchedule`, `NoticeBoard`, `WisRankingPanel` |
| `dashboard-mobile.webp` | 585 × 1266 | 41,182 | Same actual dashboard, 390px mobile viewport |
| `lesson-desktop.webp` | 1280 × 800 | 58,388 | Student `lesson/Note`, `LessonSidebar`, `LessonContent` |
| `lesson-mobile.webp` | 585 × 1266 | 49,000 | Same actual lesson, 390px mobile viewport |
| `score-desktop.webp` | 1280 × 800 | 67,152 | Actual `score/ScoreReport` / 나의 성적 리포트 |
| `score-mobile.webp` | 537 × 952 | 37,748 | Actual mobile ScoreReport's 교과별 성적 분석 section, cropped for readability |
| `weplay-desktop.webp` | 1000 × 380 | 64,726 | Actual `NavalBattleGame`, frozen native guide demo mode |
| `weplay-mobile.webp` | 537 × 570 | 60,762 | Same actual naval game, 390px mobile viewport and native compact layout |

All eight images total **444,124 bytes** (about 434 KiB). Mobile captures were taken at device scale 2 then resized to scale 1.5; desktop matches its CSS viewport. Pillow WebP quality 88/method 6 retains readable Hangul. Vite imports give these assets content-hashed build filenames; do not add redundant public copies.

## Fixture provenance

The harness is outside production source in the task workspace's `capture/` directory. It contains `setup_capture.py`, generated `fixtures.ts`, local-only mock facades, `capture.tsx`, `server.mjs`, `capture-images.cjs`, `optimize_images.py`, `capture-results.json`, and `image-manifest.json` (dimensions, sizes and SHA-256 hashes).

- School: fictional **이야기중학교**. Student: fictional **김이야기**, grade 3/class 2/number 7, UID `public-capture-student`, email `public-capture@example.invalid` (not displayed in screenshots).
- Leaderboard identities: fictional **학생 A–E**, each with a `public-capture-` UID. Attendance dates, schedules, grading plans and scores are deterministic synthetic examples.
- The final six dashboard/lesson/score captures use local rank-policy fixtures matching the user's latest approved names and thresholds: 노비 200, 상민 3,000, 중인 5,000, 양반 7,000, 왕족 10,000. The fictional account has 5,400 cumulative points. This only changes capture fixtures; no operating rank policy or wallet was read or written. `rank-refresh-capture-results.json` records the refresh with zero external requests/errors and no remaining 골품 tier names. The two game assets are byte-identical to the first capture.
- NoticeBoard displays a local synthetic notice SVG (`capture/notice.svg`) supplied through its real notice-image property. This is example notice content, not a new product feature.
- Lesson content is a locally authored example about 조선의 문화와 훈민정음 supplied through the real `lessonOverride` prop. `disablePersistence` uses the component's native preview mode; it does not change production save behavior.
- ScoreReport computes its existing charts, results and summaries from synthetic grading-plan/academic-record snapshots. The analysis UI and charts exist in the current source; none were invented for the public page.
- Game: the latest source's actual title is **내가 충무공이라고?!**. It differs from the design draft's earlier **역사가 내려와** wording. Assets come from the existing local `public/assets/weplay/naval/` directory. Native `guideDemo` freezes time and disables gameplay transport; `words`, `acceptedWordIds` and `acceptedEvents` are empty. The capture hides only the next-word waiting message and clears the input placeholder so a lightweight public overlay can animate a few sample words and an answer without duplicating baked text. No reward amount, problem fetch, ranking fetch, save, or real game runtime is needed on the public page.

## Capture isolation and fidelity

The harness imports the real visible components and their current CSS. Capture-only module aliases supply authentication, calendar, attendance, notices, grading plans and records. Firebase SDK imports point to inert local facades; writes fail explicitly. Two background controllers (dictionary session and rank-promotion controller) are omitted from captures to avoid remote session checks/toasts; they do not supply the visible captured panels. Header, navigation, schedule, notice, ranking, learning content, score report and game UI remain the actual components.

The original page relies on external Tailwind, icon and Google Fonts resources. The offline harness strips external font imports, loads the installed local Noto Sans KR variable font, uses local declarations for the existing Tailwind utility classes, and uses a small Unicode fallback for a few Font Awesome glyphs. Existing custom component CSS and SVG icons remain intact. Those minor glyph differences mean these are source-derived offline previews rather than a claim of pixel-identical screenshots from production.

Playwright used a fresh temporary headless Chromium context with service workers blocked. Request interception permits only the localhost harness and local data/blob resources. Every final scene at both viewport sizes recorded **0 external request attempts, 0 rendering/console errors, and 0 unloaded image elements**. Original `C:\westory` remained clean after capture. The shared dependency junction was read only; Vite's cache is `capture/.vite`.

## Dashboard assembly crops

Pixel boxes inside `dashboard-desktop.webp` (1280 × 800), measured from the real DOM:

| Real panel | X | Y | Width | Height |
| --- | ---: | ---: | ---: | ---: |
| Weekly schedule | 256 | 80 | 519.84375 | 660 |
| NoticeBoard | 791.84375 | 80 | 464.15625 | 316 |
| Wis ranking | 791.84375 | 412 | 464.15625 | 328 |

The earlier public-home version reused these panel crops as independent scroll-controlled layers and used a content-only lesson crop (584, 104, 664, 676). The current homepage uses the actual materials documented above instead. The game scene continues to layer the existing sea-battle.webp and allied-ship.webp art from public/assets/weplay/naval; it does not start the game runtime.

## Validation limits

All PNG and optimized WebP previews were inspected visually for text legibility and layout, including the source's desktop and mobile arrangements. These checks verify static preview asset quality and isolation; authenticated live data, Google OAuth, permissions, or landing-page interactions must be tested separately by the integration workflow. Browser/esbuild launch required a reviewed sandbox escalation because default child-process launch returned `spawn EPERM`.
