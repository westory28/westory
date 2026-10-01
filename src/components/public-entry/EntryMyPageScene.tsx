import { useEffect, useId, useRef, useState } from "react";
import EntryRibbon from "./EntryRibbon";
import { MotionTitle, StoryLink } from "./EntryVisuals";
import "./entry-mypage-scene.css";

// Examples from the actual profile registry; the public demo has no account data.
const profileExamples = [
  { id: "smile", emoji: "😀", label: "웃는 얼굴" },
  { id: "book", emoji: "📚", label: "책" },
  { id: "cool", emoji: "😎", label: "선글라스" },
  { id: "clover", emoji: "🍀", label: "행운" },
  { id: "tiger", emoji: "🐯", label: "호랑이" },
  { id: "whale", emoji: "🐳", label: "고래" },
];
const subjects = ["역사", "국어", "수학"] as const;
type Subject = (typeof subjects)[number];

function ProfileEmojiHelp() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className="entry-mypage-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!root.current?.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="entry-mypage-help-button"
        aria-label="프로필 이모지 선택 안내"
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span id={id} role="tooltip" className="entry-mypage-tooltip">
          포인트 등급에 따라 선택할 수 있는 이모지가 늘어납니다. 여기서는 예시
          이모지를 자유롭게 골라 볼 수 있습니다.
        </span>
      )}
    </span>
  );
}

export default function EntryMyPageScene() {
  const [profile, setProfile] = useState(profileExamples[0]);
  const [goals, setGoals] = useState<Record<Subject, string>>({
    역사: "85",
    국어: "90",
    수학: "80",
  });
  const goalId = useId();

  const updateGoal = (subject: Subject, draft: string) => {
    // Retain an empty draft while editing, and never turn it into a saved score.
    const value = draft === "" ? "" : Number(draft);
    if (value !== "" && !Number.isFinite(value)) return;
    setGoals((current) => ({
      ...current,
      [subject]: value === "" ? "" : String(Math.min(100, Math.max(0, value))),
    }));
  };

  return (
    <section
      id="entry-mypage"
      className="entry-scene entry-mypage"
      data-entry-scene
      tabIndex={-1}
      aria-labelledby="entry-mypage-title"
    >
      <div className="entry-stage">
        <EntryRibbon variant="wide" />
        <div className="entry-heading entry-mypage-heading">
          <StoryLink number="07" label="마이페이지" />
          <MotionTitle
            id="entry-mypage-title"
            lines={["나를 담고,", "내일을 정하다."]}
          />
        </div>

        <div className="entry-mypage-space">
          <div className="entry-mypage-profile">
            <div className="entry-mypage-panel-heading">
              <h3>나를 닮은 이모지</h3>
              <ProfileEmojiHelp />
            </div>
            <div className="entry-mypage-avatar" aria-live="polite">
              <span role="img" aria-label={`선택한 이모지: ${profile.label}`}>
                {profile.emoji}
              </span>
            </div>
            <div className="entry-mypage-emoji-picker" aria-label="이모지 선택">
              {profileExamples.map((example) => (
                <button
                  key={example.id}
                  type="button"
                  aria-label={`${example.label} 이모지`}
                  aria-pressed={profile.id === example.id}
                  onClick={() => setProfile(example)}
                >
                  <span aria-hidden="true">{example.emoji}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="entry-mypage-goals">
            <div className="entry-mypage-panel-heading">
              <h3>과목마다, 나의 목표</h3>
              <span className="entry-mypage-out-of">100점 만점</span>
            </div>
            <div className="entry-mypage-goal-list">
              {subjects.map((subject) => (
                <div className="entry-mypage-goal-row" key={subject}>
                  <label htmlFor={`${goalId}-${subject}`}>{subject}</label>
                  <div className="entry-mypage-goal-value">
                    <input
                      id={`${goalId}-${subject}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={1}
                      value={goals[subject]}
                      aria-label={`${subject} 목표 점수`}
                      onChange={(event) =>
                        updateGoal(subject, event.target.value)
                      }
                    />
                    <span aria-hidden="true">점</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="entry-mypage-demo-note">
          가상 프로필 체험 · 저장되지 않습니다
        </p>
      </div>
    </section>
  );
}
