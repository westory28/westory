# Westory DESIGN.md

이 문서는 Westory 프론트엔드 작업의 디자인 토큰 계약이다. 새 UI, 레이아웃, 색상, 간격, 그림자, 모션을 추가하거나 수정할 때는 먼저 이 문서를 확인하고, 필요한 값이 없으면 이 문서에 토큰을 추가한 뒤 코드에 반영한다.

## 1. Atmosphere / Signature

Westory는 중학교 수업 운영과 학생 학습 경험을 함께 담는 밝고 실용적인 교육용 웹앱이다. 시각 방향은 새로워 보이기보다 즉시 이해되는 관리도구형 정돈감, 학생에게는 단순한 다음 행동, 교사에게는 촘촘하지만 읽히는 운영 흐름이다. 기본 표면은 밝은 회색과 흰색 카드, 명확한 파란 primary, 제한적인 amber 브랜드 포인트를 유지한다.

Design Read: 교육 현장용 React 앱, 학생과 교사가 함께 쓰는 운영 UI, calm school utility 방향.

- `DESIGN_VARIANCE`: 3/10. 기존 화면을 전면 재배치하지 않고 한 화면, 한 섹션, 한 패턴씩 개선한다.
- `MOTION_INTENSITY`: 3/10. 상태 변화와 메뉴 전환은 빠르고 절제한다.
- `VISUAL_DENSITY`: 학생 4/10, 교사 7/10. 학생은 한 열 흐름, 교사는 정보 밀도를 허용하되 구조를 선명하게 한다.

## 2. Color

모든 새 색상은 아래 역할 중 하나로 매핑한다. 새 raw hex를 컴포넌트에 직접 추가하지 않는다.

| Token | CSS variable | Hex | Role |
| --- | --- | --- | --- |
| Page background | `--ws-bg` | `#f9fafb` | 앱 전체 배경 |
| Surface | `--ws-surface` | `#ffffff` | 카드, 모달, 메뉴 표면 |
| Surface subtle | `--ws-surface-subtle` | `#f8fafc` | 모바일 메뉴 상태 영역, 약한 섹션 배경 |
| Text strong | `--ws-text-strong` | `#111827` | 주요 제목, 활성 텍스트 |
| Text | `--ws-text` | `#1f2937` | 본문 기본 |
| Text muted | `--ws-text-muted` | `#6b7280` | 보조 설명 |
| Text soft | `--ws-text-soft` | `#9ca3af` | 비활성 설명, 약한 메타 |
| Border | `--ws-border` | `#e5e7eb` | 기본 구분선 |
| Border soft | `--ws-border-soft` | `#f3f4f6` | 내부 구분선 |
| Border blue | `--ws-border-blue` | `#dbeafe` | 파란 강조 표면 border |
| Primary | `--ws-primary` | `#2563eb` | 대표 행동, 활성 메뉴 |
| Primary hover | `--ws-primary-hover` | `#1d4ed8` | primary hover/active |
| Primary soft | `--ws-primary-soft` | `#eff6ff` | primary 배경 강조 |
| Primary text | `--ws-primary-text` | `#1e3a8a` | primary soft 위 텍스트 |
| Accent | `--ws-accent` | `#f59e0b` | Westory 로고 Story, 보상/브랜드 포인트 |
| Accent text | `--ws-accent-text` | `#92400e` | amber 계열 텍스트 |
| Accent soft | `--ws-accent-soft` | `#fffbeb` | 약한 amber 표면 |
| Danger | `--ws-danger` | `#ef4444` | 삭제, 오류 배지 |
| Danger text | `--ws-danger-text` | `#b91c1c` | 오류 텍스트 |
| Danger soft | `--ws-danger-soft` | `#fef2f2` | 오류 배경 |
| Success | `--ws-success` | `#16a34a` | 성공 행동, 완료 상태 |
| Success hover | `--ws-success-hover` | `#15803d` | 성공 hover/active |
| Success soft | `--ws-success-soft` | `#dcfce7` | 성공 배경 |
| Warning text | `--ws-warning-text` | `#dc2626` | 경고 텍스트 |
| Overlay | `--ws-overlay` | `rgba(15, 23, 42, 0.62)` | 모달 backdrop |
| Focus ring | `--ws-ring` | `#3b82f6` | focus-visible outline/ring |
| Solid label contrast | `--ws-solid-label-text` | `#000000` | 단색 일정 라벨에서 흰색·기본 본문색 모두 대비 4.5:1 미만일 때 사용하는 글자색 |

Contrast notes:

- `--ws-text` on `--ws-bg` and `--ws-surface` is safe for normal text.
- `--ws-primary` with white text is reserved for large or bold controls. For small text on soft blue backgrounds, use `--ws-primary-text`.
- Amber is an accent, not a default CTA color.

## 3. Typography

Calendar editor contract:
- 공휴일 날짜와 이름은 요일보다 우선하여 빨간색으로 표시한다. 토요일과 겹친 공휴일도 빨간색이며, 공휴일이 아닌 토요일만 파란색으로 표시한다.
- Teacher event dialog: maximum width 960px; two columns from 768px, one column below it.
- Existing category palette in `scheduleCategories.ts` also supplies optional per-event label colors; labels use dark text on a 22% tint of the chosen color.
- Calendar label height: 24px; text: existing 12px label size, 4px horizontal padding, single-line ellipsis. FullCalendar owns the date-span width.
- Editor controls: 40px minimum height; dialog gaps/padding use 8px, 12px, 16px, 24px. Memo height: 96px (64px on short landscape screens).
- Category management edits one selected category at a time, without growing the dialog vertically.

Font stack: `Noto Sans KR`, system sans-serif. Korean readability and school-device compatibility are more important than novelty.

| Role | Token | Size | Weight | Line height | Letter spacing |
| --- | --- | --- | --- | --- | --- |
| Logo | `--ws-type-logo` | `1.62rem` | 800 | 1 | `-0.025em` |
| Teacher header logo (desktop) | `--ws-type-teacher-logo` | `2rem` | 800 | 1 | `-0.025em` |
| Teacher header logo (mobile/tablet) | `--ws-type-teacher-logo-compact` | `1.62rem` | 800 | 1 | `-0.025em` |
| Page title | `--ws-type-page-title` | `1.75rem` | 800 | 1.25 | 0 |
| Section title | `--ws-type-section-title` | `1.25rem` | 800 | 1.3 | 0 |
| Card title | `--ws-type-card-title` | `1rem` | 800 | 1.35 | 0 |
| Body | `--ws-type-body` | `1rem` | 400 | 1.6 | 0 |
| Body strong | `--ws-type-body-strong` | `1rem` | 700 | 1.5 | 0 |
| Small | `--ws-type-small` | `0.875rem` | 500 | 1.55 | 0 |
| Label | `--ws-type-label` | `0.75rem` | 800 | 1.2 | 0 |
| Button | `--ws-type-button` | `0.95rem` | 700 | 1.2 | 0 |
| Meta | `--ws-type-meta` | `0.72rem` | 700 | 1.25 | 0 |

Rules:

- 학생 화면 본문은 14px 이하로 장시간 읽게 만들지 않는다.
- 교사 화면의 표, 상태, 보조 정보는 작게 쓸 수 있지만 label과 값의 위계를 유지한다.
- 새 표시 텍스트에는 과한 영문 마케팅 문구를 넣지 않는다.
- 색, 아이콘, 표 헤더, 선택 상태만으로 의미가 충분히 전달되는 곳에는 사용법 설명 문단을 추가하지 않는다. 학생 점수 확인, 교사 운영 모달, OMR·정오표처럼 반복 확인하는 화면은 특히 설명보다 구조와 라벨을 우선한다.

## 4. Spacing

Base unit: 4px. 새 margin, padding, gap은 아래 토큰을 우선 사용한다. 1px border와 0은 예외다.

| Token | Value | Use |
| --- | --- | --- |
| `--space-1` | 4px | 아이콘과 짧은 라벨 사이 |
| `--space-2` | 8px | 작은 버튼 내부, 짧은 리스트 gap |
| `--space-3` | 12px | 일반 control gap |
| `--space-4` | 16px | 모바일 페이지 gutter, 카드 내부 최소 padding |
| `--space-5` | 20px | 카드 header/body gap |
| `--space-6` | 24px | 일반 섹션 padding |
| `--space-8` | 32px | 데스크톱 카드/섹션 gap |
| `--space-10` | 40px | 데스크톱 페이지 gutter |
| `--space-12` | 48px | 큰 섹션 간격 |
| `--space-16` | 64px | sticky header 높이 |
| `--space-20` | 80px | 넓은 랜딩성 영역에만 사용 |

Layout tokens:

- Teacher sidebar: 232px expanded by default on desktop, including direct settings entry; 88px compact only when requested through the menu control. Preserve the current expanded/compact state when entering or leaving settings; compact entries retain an icon and short visible label, with the full existing name available to assistive technology and on hover. Compact menu rows are 60px (52px below 820px viewport height); expanded rows remain 44px (40px below 820px). Icons use 24px outlines with 1.8px rounded strokes and 16px chevrons. The rail starts at the top of the viewport with the original Westory wordmark and tagline; compact mode uses the short We mark; its menu list scrolls independently when needed, with settings accessible at the bottom. Below 1024px, place the hamburger at the far right of the account header and anchor the full-label drawer to the right edge (320px maximum width, 40px minimum backdrop strip); keep its close button at the upper right. Desktop navigation stays on the left.
- Teacher account toolbar: retain the original transparent 48px desktop account area inside the main column, without a full-width white bar or bottom border; the full Westory wordmark and tagline belong in the expanded sidebar. The existing name, notification, remaining session time, extension and logout controls remain together. The dashboard semester badge remains visible; narrow screens may use a second header row. Keep the desktop rail at z-index 30 and header at 40, below existing content modals/panels at 50 or higher; the mobile navigation drawer retains its existing overlay layer.
- Teacher settings workspace: join the 288px flat settings navigation directly to the global rail at desktop widths (1024px and above). Extend this navigation upward across the transparent 48px account area so it begins at viewport top without an empty strip; keep the account controls and settings content in their existing positions. At 768–1023px use a 256px settings navigation; below 768px use a labeled expandable menu above the content. The seven existing setting sections remain separate and keep their full names. Use 44px minimum navigation rows, a 24px heading inset, existing blue active-state tokens and outline icons. The workspace fills the remaining viewport width, with 32px desktop padding (24px below 1280px, 16px below 768px). Keep general-settings content groups within 1280px. When the content area is at least 800px wide, arrange general settings in two equal columns with a 24px gap: semester switching beside readiness, then semester preparation beside student-menu visibility. Student-menu choices occupy one horizontal row on this layout. Smaller content areas stack the sections. Allow action rows to wrap and keep button labels unbroken. The settings navigation sticks at viewport top after the transparent toolbar scrolls away. Do not enlarge the font or change setting behavior to fill the space.
- Teacher settings panels: at a content width of 800px or more, school settings place school level and grades in the left column and classes in the right; interface main settings use two equal columns. Reuse the 24px gap and stack below this width. Sitemap previews for both roles place all top-level menus in one equal-width row at this width, using the existing 12px gap; use two columns from 480px and one below. School-level choices also sit side by side from 480px. Keep the settings footer inside the content column and extend the navigation surface through the footer so scrolling to the page end leaves no bottom gap.
- Teacher weekly dashboard: 1536px maximum width, 16px panel gap, desktop content height `clamp(620px, calc(100dvh - 140px), 880px)`; small screens use natural document scrolling.
- Teacher dashboard weeks run Sunday through Saturday, matching the full calendar. Week navigation, current-week reset and search selection share this boundary; Sunday is red, Saturday is blue, and public-holiday red takes precedence.
- Teacher navigation motion: accordion content unfolds with grid rows 0fr↔1fr and opacity for 200ms on an explicit teacher menu click, including reduced-motion mode as requested; this height transition is a scoped exception to transform-only motion. Initial navigation does not animate. Week changes move only date numerals and event text by 12px for 140ms in the requested direction; the calendar frame, day hit areas, ribbon circles, row dividers and navigation arrows stay fixed. Interrupted transitions cancel cleanly. At the user's explicit request, user-triggered week changes retain this animation in reduced-motion mode; initial rendering does not animate.
- Teacher footer: transparent with 8px top, 16px horizontal and 12px bottom padding; existing policy links and copyright remain centered.
- Teacher semester label: display the configured year/semester beneath the sidebar wordmark and tagline, using 12px bold primary-text on primary-soft, a 16px line height, 0/8px padding and 4px corners. Keep the label in normal flow, with an 8px gap below the tagline and the existing 12px brand-bottom padding plus 8px navigation-top gap (4px in the short-desktop layout) below it. Preserve menu item sizing, inter-item spacing and overflow behavior; the brand area reserves the label height instead of overlapping the first menu. In compact mode the logo tooltip retains the semester and the label is hidden like the tagline. Below 1024px show the same small label under the header logo, within its existing 64px row, and also in the open drawer. The teacher dashboard no longer has a separate semester heading in its account row; the student heading remains unchanged.
- Teacher portal account placement: on every teacher route, add 24px above the existing 48px desktop account row. Give its container the same 1536px maximum width and 24px horizontal padding as the weekly dashboard (16px below 1120px, 12px below 640px), so the right edge of the account controls aligns with the right card. Preserve dashboard panel heights and allow natural document scrolling. Use the same account alignment on dashboard, management, calendar and settings pages. Settings secondary navigation offsets by the full 72px account area to remain flush with the viewport top; its workspace minimum height subtracts that same area. Mobile account layout keeps its existing responsive row arrangement.
- Weekly date ribbons: a date with non-holiday schedules uses the first schedule in the existing chronological list as its representative ribbon. Apply that event's configured color (including custom labelColor), darkened with the existing readable-event-color helper for legible white numerals, to the date circle. Expose the representative event title in the date tooltip and accessible label. Holiday-only dates retain red text. A ribbon on today keeps its event color and gains a blue outer ring; selection keeps its existing indication. Multi-day schedules color every included day.
- Weekly numeral alignment: use a one-em line box, tabular numerals and a -0.05em optical top offset inside the centered date circle; keep the horizontal text transition independent. Event metadata uses a 12px category badge with 20px line height, 0/8px padding, neutral surface, a 1px neutral border and 4px corners, a 12px gray vertical divider, and a 16px outline clock before the unbroken period label. Animate only the inner label text so badges, dividers and icons remain fixed.
- Weekly event dots: keep the shared 4px marker slot and apply a common -2px optical vertical offset on all viewport sizes. Event and holiday dots use the same offset and numeral-to-dot distance regardless of ribbon, today or selection; retain a single horizontal baseline without moving the numerals or weekday labels.
- Weekly calendar readability: desktop title/date numbers 24px, event title 18px, date/period metadata 14–16px; event rows 80px. Mobile event titles remain 16px and section titles 18px. Search/add/filter controls reuse the current calendar's bordered search, blue add, and 44px control sizing.
- Teacher dashboard ranking: reserve at least 328px in the desktop grid so all five ranking rows fit at shorter viewport heights.
- Weekly calendar actions: filter, search and add sit beside the calendar title at the top right, wrapping below the title on narrow screens. Search/add use labeled 44px square icon buttons. Search opens a 160px input to the left of its icon (160ms width/opacity reveal; reduced-motion disables this input transition), retaining the existing title/description search across the supplied semester events. Results replace the event list in place. The labeled 44px full-calendar icon sits between search and add in one non-wrapping action row. The inline search field may shrink on narrow screens to keep all three icons together. Weekly event titles have no ribbon box: they use the event hue (darkened only as needed for 4.5:1 text contrast on the date tint), with holidays in danger text red and no redundant holiday category label. Non-holiday dates use a 4px-radius ribbon badge with the existing event-color border and 22% tint. Dates are written as M월 D일, including both ends of date ranges. The upper action row starts with a 16px bold week-range badge and a 16px current-week button; the badge explicitly names the month (and the year in its accessible label). Remove the separate month column. Previous/next week controls sit at the two edges of the date strip, 44px each; on narrow screens they occupy its top corners above the seven dates. Range badges use 8px/12px padding and primary-soft color.
- Page max width: `--ws-page-max: 1280px`.
- Header height: `--ws-header-height: 64px`.
- Header dropdown min width: `--ws-header-dropdown-min: 11rem`.
- Header dropdown max width: `--ws-header-dropdown-max: min(24rem, calc(100vw - 2rem))`.
- Mobile gutter: `--space-4`.
- Desktop gutter: `--space-10`.
- Student page default: one column first.
- Teacher page default: dense grid allowed only when labels, actions, and overflow remain clear.
- Teacher dashboard width contract (768px and above): maximum `min(96rem, calc(100vw - 2rem))` (1536px cap), horizontal padding `clamp(1.5rem, 2.6vw, 2.5rem)` (24–40px). Keep the existing five-column grid with calendar spanning three columns and the side panels spanning two; gap remains 16px. These values must not depend on Tailwind CDN insertion order. Do not add `max-w-7xl` or `px-4` overrides to this container.

## 5. Components

### Assessment stacked bars

- Student assessment ratios use one horizontal 0–100% stacked bar per subject. A score view uses the same item order and colors on a 0–100 point axis; unentered scores remain labeled as unentered.
- Segment palette reuses `--ws-primary`, `--ws-accent`, `--ws-success`, `--ws-text-muted`, `--ws-ring`, and `--ws-accent-text` in item order. Each segment has a matching visible item name and value; color is never the only label.
- Use existing 40px bar height, 8px radius, 8/12/16/24px spacing and 12/14/16px type. Long assessment names wrap. Charts remain one column on mobile and update directly from the current data without decorative motion.

### Teacher assessment editor

- Use separate white, bordered editor and list surfaces with 12px radius, 24px padding (16px on mobile), and a 24px gap. The grading page uses the existing 96rem maximum width; at 1280px viewport and above use a 5:7 editor-to-list split. Smaller screens place the editor first. Card actions share the subject heading row at the upper right without wrapping. Below 640px use labeled 40px icon buttons; truncate long subjects with a full title. Assessment details retain the full card width. Keep percentages unbroken, and allow long names to wrap only when they cannot fit. The registered-plan list scrolls internally after min(70dvh, 48rem), with its heading and sort control outside the scrolling area; short lists retain natural height. Reuse 8px gaps, and do not make the editor sticky.
- Inputs are 44px high with 8px radius and 14px text. Grade and subject share a row above 640px. Each assessment has a full-width area name followed by type, maximum score and weight; below 640px the type spans a row and the two numeric fields share a row.
- Use visible labels and units, 40px minimum action targets, and existing primary/surface/border/text tokens. A 8px stacked ratio strip reuses the student chart palette; show the numeric total and remaining/excess ratio in text. Primary save stays blue for both creation and editing.
- Preview dialogs use a 72rem maximum width and equal columns from 1024px. Score inputs stay in an 80px right-hand column at every viewport, matching the student score card, with 44px height. Description text occupies the flexible left column and metadata phrases wrap as whole units. The graph total stays at the right of its heading. Reuse 8/12/16/24px spacing and the existing typography and palette.

### Header

- Mobile account blocks place the bold 16px profile directly above one unbroken row of notification, countdown/extension and logout controls, with 8px row spacing and 40px minimum targets. Countdown text stays centered with equal-width icon/extension columns. Keep desktop placement unchanged. Notification panels anchor 8px below their bell, clamp horizontally to 12px viewport margins, and scroll within the remaining viewport height; never cover the trigger. Reuse the existing 360px popover width.
- Mobile student-list filters and points grade/class/sort selectors share one row using flexible equal columns and existing 4/8px gaps, 40px controls and 12/14px text. Search expands into its own row on request. Student pagination uses one row, the existing 32px minimum number width with 40px height and 4px gaps, with ellipses replacing distant pages (first four plus final two initially; current neighbors and end anchors afterward).

- Teacher header: keep the existing 64px row height and center the logo, navigation labels, and account actions on the same axis.
- Teacher logo optical offset: `--ws-teacher-logo-optical-offset: -0.0625em` (2px upward at 32px). Apply only to the lettering to balance the descending `y`, scale with the compact logo, and preserve the link's hit area.
- Teacher active navigation underline: `--ws-header-nav-indicator: 3px`; position independently of the label so it does not shift vertical alignment.

- Background: `--ws-surface`.
- Border: `1px solid --ws-border`.
- Height: `--ws-header-height`.
- Position: sticky top 0.
- Active nav: `--ws-primary` text and bottom border.
- Mobile menu: fixed below header, full viewport height minus header.

### Buttons

Primary button:

- Background: `--ws-primary`, hover `--ws-primary-hover`.
- Text: white.
- Radius: `--radius-full` for login/large CTA, `--radius-md` or `--radius-lg` for admin tools.
- Padding: x `--space-4` to `--space-6`, y `--space-2` to `--space-3`.
- Disabled: opacity 0.6 plus disabled cursor.

Secondary button:

- Background: `--ws-surface`.
- Border: `--ws-border`.
- Text: `--ws-text`.
- Hover: `--ws-surface-subtle`.

Danger button:

- Background or text must use `--ws-danger` or `--ws-danger-text`.
- Destructive copy must state the object being changed or deleted.

Icon-only controls:

- Must have `aria-label`.
- Minimum touch target: 40px by 40px.

### Cards and Sections

- Card background: `--ws-surface`.
- Border: `1px solid --ws-border`.
- Radius: `--radius-lg` by default.
- Shadow: `--shadow-sm` for routine cards, `--shadow-md` for overlays or lifted cards.
- Do not nest cards inside cards unless the inner card is a distinct interactive object.
- Simple counts or one-line metadata should use plain layout before adding a card.
- 학생 점수 화면에서 문항 목록, 피드백, 확인 요청 대상은 카드 안 카드 구조를 피한다. 필요한 경우 같은 표면 안에서 header, list, footer로 나누고 내부 배경은 한 단계만 사용한다.

### Forms

- Labels are required. Placeholder cannot replace label.
- Input border: `--ws-border`, focus ring `--ws-ring`.
- Help text and validation text stay near the field.
- Risk fields such as semester, permission, visibility, delete, and public range need explicit helper copy.

### Tabs and Segmented Controls

- Use when switching views inside the same data context.
- Active state must be visible through both color and weight.
- Keep 2 to 5 items when possible.
- Mobile overflow should scroll horizontally only for the control row, not the whole page.

### Badges and Status

- Color must communicate a real state, not decoration.
- Do not rely on color alone. Pair with text.
- Teacher screens should avoid new emoji badges.
- Add a shared status mapping when the same state appears in two or more places.

### Modals and Panels

- 수업 PDF 목록은 `a5b3c45`의 겹침 패널을 따른다. 폭 20rem, PDF 안쪽 여백 12px, 화면 최대 높이는 `calc(100dvh - 2rem)`이며 내부 목록만 스크롤한다. 작은 PDF에서도 조작할 수 있도록 목록이 열린 편집 영역의 최소 높이는 `min(28rem, 70dvh)`다.

- 알림장 관리 팝업은 기존 `d360227` 레이아웃을 따른다: 최대 80rem, 목록 16rem, 이미지 영역 16rem/최대 높이 180px, 목록 3개씩 표시. 1024px 미만에서는 편집기를 먼저 배치하고 팝업 본문 하나만 스크롤한다. 간격과 색상은 기존 토큰을 사용한다.

- Backdrop: `--ws-overlay`.
- Surface: `--ws-surface`.
- Radius: `--radius-xl`.
- Shadow: `--shadow-xl`.
- One modal at a time.
- Long editing flows should become a section or side panel instead of a deep modal.

### Tables and Lists

- Teacher comparisons and operations can use tables.
- Student flows should prefer lists, steps, or simple cards.
- Sticky table header only for genuinely long lists.
- Row click and row action buttons must not compete.

Component radius tokens:

- `--radius-sm: 4px`.
- `--radius-md: 8px`.
- `--radius-lg: 12px`.
- `--radius-xl: 16px`.
- `--radius-full: 9999px`.

## 6. Motion

### Student portal layout alignment

- Student routes reuse the teacher portal's 232px desktop sidebar (88px collapsed), 1024px drawer breakpoint, transparent account toolbar, outline icons, surface colors, spacing and footer. The shared navigation receives only the existing visible student menus and student routes; teacher settings and management actions remain absent.
- On mobile, show the Westory logo and menu trigger in the header; place the semester, student profile/rank, notifications, session controls and logout inside the right drawer. Preserve focus trapping, Escape/backdrop dismissal, body scroll locking, and focus return. Use the existing 320px drawer width, safe-area padding and 40px action targets.
- Student dashboard: reuse the teacher dashboard's 1536px maximum width, 16px gaps and 24/16/12px responsive gutters. Keep the student's calendar/list/search/attendance interactions. Desktop places the calendar on the left and notice/ranking on the right; below 1120px use natural page scrolling in notice, calendar, ranking order. The semester appears in navigation, without a second dashboard badge.
- Student content uses the same main-column alignment while retaining page-specific reading widths and student controls. No additional palette, font, shadow or motion system is introduced.

Motion supports orientation only. Do not use motion to decorate routine admin surfaces.

| Token | Value | Use |
| --- | --- | --- |
| `--motion-fast` | 160ms | hover, active, small state changes |
| `--motion-base` | 200ms | menu open, toast, simple reveal |
| `--motion-slow` | 300ms | side panel or modal transition |
| `--ease-out` | `ease-out` | default entrance |
| `--ease-standard` | `ease` | routine color/border changes |
| `--press-scale` | `0.985` | press feedback |

Rules:

- Animate only transform, opacity, or filter for new motion.
- Respect `prefers-reduced-motion: reduce`.
- Student reward/recognition motion can be more expressive, but it must not block learning flow.

## 7. Depth

Depth strategy: light surfaces use borders first, then restrained shadows only where hierarchy or overlay behavior needs it.

| Token | Value | Use |
| --- | --- | --- |
| `--shadow-xs` | `0 1px 2px rgba(15, 23, 42, 0.04)` | subtle surface lift |
| `--shadow-sm` | `0 8px 18px rgba(15, 23, 42, 0.04)` | routine cards |
| `--shadow-md` | `0 14px 28px rgba(15, 23, 42, 0.10)` | hover or emphasized panel |
| `--shadow-lg` | `0 18px 40px rgba(15, 23, 42, 0.14)` | drawer, popover |
| `--shadow-xl` | `0 24px 60px rgba(15, 23, 42, 0.22)` | modal |
| `--shadow-danger` | `0 4px 10px rgba(239, 68, 68, 0.22)` | notification or danger badge |
| `--shadow-accent` | `0 10px 24px rgba(146, 64, 14, 0.14)` | amber reward emphasis only |

## Superloopy Frontend Gate

Optional help uses a circular 16px information glyph beside its heading or main label, with a 40px button target. Keep its text hidden until hover, focus, click or tap; dismiss on Escape, outside click or focus exit. Use existing 12px padding, 8px radius, surface/border/text colors and popover shadow, with a maximum width of 320px bounded by its container. Delete redundant introductory or instructional sentences rather than moving them into permanent captions. Preserve essential validation and consent text.

For visible frontend work, use this sequence before editing UI code:

1. Read `AGENTS.md`, `UI_RULES.md`, and this `DESIGN.md`.
2. State the Design Read and confirm whether the surface is student, teacher, or shared.
3. Add or adjust tokens here before writing new values in code.
4. Run the anti-slop pre-flight: no generic purple glow, no unsupported font/palette drift, no hidden raw hex outside approved legacy areas, no unmanaged spacing.
5. Capture real-browser evidence for changed screens at 390px, 768px, and 1280px when UI pixels change.
6. Record evidence under `.superloopy/sessions/<session-id>/evidence/` or the active Superloopy evidence root.

No visible UI work is complete until the design contract and verification evidence agree.

### Teacher notice image sizing

- The dashboard notice viewport fills the space remaining after the heading and controls. Images and the carousel track use the measured slot without intrinsic aspect ratios imposing a minimum height; images use `contain` and never zoom on hover.
- Measure the viewport with `ResizeObserver`. In the image registration/editing dialog only, recommend a 16:9 source at twice its contained image size, rounded to whole 16:9 units and capped at the existing 1200×675 upload maximum. The existing 16:9 center crop/compression contract remains unchanged; other editor entry points keep the 1200×675 fallback recommendation.
- Do not show image size guidance below the dashboard notice image, including the empty state.

- Weekly event rows keep date, title, category/class metadata and period on one line when space allows. Below 768px, use compact M/D dates (M/D–M/D for ranges), 12px dates/categories, 14px titles and existing 4px gaps. Category badges and periods always show their complete text without shrinking; allocate the remaining width to the full event title. Overflowing mobile titles pause at the start for 2400ms, pan left at 24px/s (at least 2000ms), pause at the end for 1200ms, then reset and repeat after the start pause. Measure the actual text/slot width; short titles remain still. Below 360px or with reduced motion on mobile, place metadata on a second full-width row to preserve title space. Reduced-motion users receive wrapped full titles. The heading 이번 주 학사 일정 never wraps. Mobile dashboard order is notice, schedule, ranking; desktop order remains unchanged.
- Below the existing 1024px hamburger breakpoint, the teacher header shows only its logo and menu button. Show the year/semester and profile name only inside the drawer, with notifications, session countdown/extension and logout directly below; reuse the same handlers and session state. Use 12px/8px gaps, 40px controls and existing neutral tokens. Center countdown numerals with a one-line flex box, tabular numerals and symmetric badge padding. Keep desktop account placement unchanged. Notification popovers opened inside the mobile menu stay within the dynamic viewport and scroll internally.
- Mobile teacher header (below 1024px): reserve 24px plus the top safe-area inset above the logo row. Session extension, logout and close controls use at least 40px touch targets. The patch memo panel uses dynamic viewport height with safe-area padding and a scrollable body.
- Lesson materials, think cloud, maps, question registration, Wis policy and rank management reuse the settings submenu pattern through `TeacherSubNavigation`: a flat white 228px navigation (208px at 768–1023px), existing blue active-state tokens, 44px minimum menu rows and the same content padding. Below 768px, show the current selection in an expandable menu above the content; selection closes it and returns keyboard focus to the toggle. Escape also closes it. Preserve nested lesson units, visible management actions, map ordering, classroom filters and unsaved-state indicators. These submenus replace the former mobile content drawers and floating list launchers.
# Teacher navigation labels

Teacher menu names and lesson tree labels stay on one line. Long labels use ellipsis with the full title available on hover. Lesson add, rename and delete controls remain on the same row as their item, including narrow screens.

### Student weekly dashboard and shared submenus

- The student dashboard uses the teacher weekly schedule pattern: seven-day strip, previous/next week, current week, selected-day event list, search and full-calendar access. Keep student attendance and class-visible schedule data; omit teacher editing and class-management controls.
- Student lesson contents, think cloud, maps, My Page and score lists use the same settings submenu through `PortalSubNavigation`, including the 228px desktop/208px tablet rail, flat surfaces, 44px rows and mobile disclosure below 768px. Preserve student-only items, selection, public-content filtering and learning actions. The original teacher component remains a compatibility export of the shared component and uses the unchanged shared stylesheet.

- Teacher submenu width: 288px desktop / 256px tablet (768–1023px); lesson curriculum: 360px / 320px. Below 768px retain full-width disclosure. Truncated teacher menu labels expose full names with native title tooltips. Student submenu dimensions stay unchanged.

- Student weekly schedule keeps date, title, category and period on one row at every viewport, including reduced-motion mode. Reduced motion uses static single-line ellipsis instead of title animation or wrapping.
