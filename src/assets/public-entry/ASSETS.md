# Public entry preview assets

## Current homepage: actual teaching materials (2026-10-01)

The white-background homepage replaces the synthetic lesson and dashboard crops below with user-authorized teaching materials. These four optimized, content-hashed WebP imports total **574,580 bytes** (about 561 KiB). Images outside the hero load lazily. The homepage does not fetch lessons, maps, student records, or cloud responses from Firebase.

| File | Bytes | Source |
| --- | ---: | --- |
| `worksheet-real.webp` | 143,042 | First page of the published 2026-2 lesson **② 500년 국가의 기틀 확립** |
| `heritage-real.webp` | 205,924 | First page of the published 2026-2 lesson **② 조선 전기의 문화 유산** |
| `map-real.webp` | 100,968 | Existing **한반도 역사 지리** map resource |
| `lesson-real.webp` | 124,646 | Actual `LessonWorksheetStage` in `student-solve` preview with the first lesson's 47 blank definitions; local capture shell |

The worksheet images retain their original author attribution. The lesson screen is a capture of the real worksheet renderer with persistence disabled, not a claim that its minimal capture-only shell matches the entire authenticated portal. No student account, answer, score, or identifier appears in these assets.

`entryMaterial.ts` contains the existing question 133 about Pericles and its original choices/explanation, plus 22 anonymous word/count aggregates from the actual **한국사라고 하면 떠오르는 것은?** activity. The first-semester activity was used because the current semester's activities had no responses. Only normalized response text was requested; submitter identities were not loaded. Irrelevant words were excluded. `WordCloudView` renders those aggregates locally, with `showSubmitters={false}`. The homepage's word additions and quiz choices are temporary local demonstrations.

The score calculator and growth line graph use explicitly labeled fictional values. The calculator reuses `getGradeBand` and its rounding convention; its 60/40 weights are a demonstration, not a fetched grading plan. Game art still comes from the existing naval-game assets without starting gameplay. CSS builds the device mockups; no video, 3D engine, remote rendering, or animation package is added.

Read-only source retrieval, original files, capture harness, and visual verification evidence are kept in ignored `.superloopy/sessions/2026-10-01-public-entry-v2/`. Raw server metadata and token-bearing source URLs are not published or committed.

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
