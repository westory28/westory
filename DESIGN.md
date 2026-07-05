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

Contrast notes:

- `--ws-text` on `--ws-bg` and `--ws-surface` is safe for normal text.
- `--ws-primary` with white text is reserved for large or bold controls. For small text on soft blue backgrounds, use `--ws-primary-text`.
- Amber is an accent, not a default CTA color.

## 3. Typography

Font stack: `Noto Sans KR`, system sans-serif. Korean readability and school-device compatibility are more important than novelty.

| Role | Token | Size | Weight | Line height | Letter spacing |
| --- | --- | --- | --- | --- | --- |
| Logo | `--ws-type-logo` | `1.62rem` | 800 | 1 | `-0.025em` |
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

- Page max width: `--ws-page-max: 1280px`.
- Header height: `--ws-header-height: 64px`.
- Header dropdown min width: `--ws-header-dropdown-min: 13.5rem`.
- Mobile gutter: `--space-4`.
- Desktop gutter: `--space-10`.
- Student page default: one column first.
- Teacher page default: dense grid allowed only when labels, actions, and overflow remain clear.

## 5. Components

### Header

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

For visible frontend work, use this sequence before editing UI code:

1. Read `AGENTS.md`, `UI_RULES.md`, and this `DESIGN.md`.
2. State the Design Read and confirm whether the surface is student, teacher, or shared.
3. Add or adjust tokens here before writing new values in code.
4. Run the anti-slop pre-flight: no generic purple glow, no unsupported font/palette drift, no hidden raw hex outside approved legacy areas, no unmanaged spacing.
5. Capture real-browser evidence for changed screens at 390px, 768px, and 1280px when UI pixels change.
6. Record evidence under `.superloopy/sessions/<session-id>/evidence/` or the active Superloopy evidence root.

No visible UI work is complete until the design contract and verification evidence agree.
