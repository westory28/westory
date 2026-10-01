import { useId, useRef, useState } from "react";
import {
  DEFAULT_POINT_RANK_POLICY,
  getPointRankAllowedEmojiIds,
  getPointRankDisplay,
  getPointRankEmojiRegistry,
  getPointRankTierMeta,
  getPointRankUnlockTierCodeForEmoji,
} from "../../lib/pointRanks";
import EntryGlow from "./EntryGlow";
import { entryMaterial } from "./entryMaterial";
import { MotionTitle, StoryLink } from "./EntryVisuals";
import "./entry-mypage-scene.css";

// Match the real MyPage menu; all profile and score data below are fictional.
const menus = [
  { id: "profile", label: "나의 기본 정보" },
  { id: "score", label: "나의 성적표" },
  { id: "wrong-note", label: "오답 노트" },
] as const;
type Menu = (typeof menus)[number]["id"];

const previewRank = getPointRankDisplay({
  rankPolicy: DEFAULT_POINT_RANK_POLICY,
  wallet: { earnedTotal: 180, rankEarnedTotal: 180 },
});
const allowedEmojiIds = getPointRankAllowedEmojiIds(
  DEFAULT_POINT_RANK_POLICY,
  previewRank?.tierCode,
);
const previewEmojiIds = new Set([
  "smile",
  "book",
  "cool",
  "clover",
  "nerd",
  "rocket",
  "sparkles",
  "fox",
]);
const previewEmojis = getPointRankEmojiRegistry(DEFAULT_POINT_RANK_POLICY)
  .filter((entry) => previewEmojiIds.has(entry.id))
  .map((entry) => ({
    ...entry,
    unlocked: allowedEmojiIds.includes(entry.id),
    unlockLabel: getPointRankTierMeta(
      DEFAULT_POINT_RANK_POLICY,
      DEFAULT_POINT_RANK_POLICY.activeThemeId,
      getPointRankUnlockTierCodeForEmoji(DEFAULT_POINT_RANK_POLICY, entry.id) ||
        "tier_1",
    ).label,
  }));

export default function EntryMyPageScene() {
  const [menu, setMenu] = useState<Menu>("profile");
  const [profileEmojiId, setProfileEmojiId] = useState("nerd");
  const [showExplanation, setShowExplanation] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const profileEmoji = previewEmojis.find(
    (entry) => entry.id === profileEmojiId,
  )!;

  return (
    <section
      id="entry-mypage"
      className="entry-scene entry-mypage"
      data-entry-scene
      tabIndex={-1}
      aria-labelledby="entry-mypage-title"
    >
      <div className="entry-stage">
        <EntryGlow variant="wide" />
        <div className="entry-heading entry-mypage-heading">
          <StoryLink number="07" label="마이페이지" />
          <MotionTitle
            id="entry-mypage-title"
            lines={["나를 담고,", "내일을 정하다."]}
          />
        </div>

        <div className="entry-mypage-preview" data-entry-absorb>
          <div className="entry-mypage-topbar">
            <strong>마이페이지</strong>
            <span>가상 기록 미리보기</span>
          </div>
          <div
            className="entry-mypage-tabs"
            role="tablist"
            aria-label="마이페이지 미리보기 메뉴"
          >
            {menus.map((item, index) => (
              <button
                key={item.id}
                ref={(element) => {
                  tabs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${item.id}`}
                aria-selected={menu === item.id}
                aria-controls={`${id}-panel-${item.id}`}
                tabIndex={menu === item.id ? 0 : -1}
                onClick={() => setMenu(item.id)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % menus.length
                      : event.key === "ArrowLeft"
                        ? (index + menus.length - 1) % menus.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? menus.length - 1
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  setMenu(menus[next].id);
                  tabs.current[next]?.focus();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="entry-mypage-content">
            <div
              role="tabpanel"
              id={`${id}-panel-profile`}
              aria-labelledby={`${id}-tab-profile`}
              hidden={menu !== "profile"}
              tabIndex={0}
            >
              <div className="entry-mypage-profile">
                <div>
                  <div className="entry-mypage-identity">
                    <span className="entry-mypage-initial" aria-hidden="true">
                      {profileEmoji.emoji}
                    </span>
                    <div>
                      <span className="entry-mypage-label">나의 기본 정보</span>
                      <h3>예시 학생</h3>
                      <p className="entry-mypage-class">2학년 1반 1번</p>
                    </div>
                  </div>
                  <dl className="entry-mypage-summary">
                    <div>
                      <dt>현재 등급</dt>
                      <dd>{previewRank?.label}</dd>
                    </div>
                    <div>
                      <dt>학습 진행</dt>
                      <dd>60%</dd>
                    </div>
                  </dl>
                </div>
                <div
                  className="entry-mypage-emoji-picker"
                  role="group"
                  aria-labelledby={`${id}-emoji-title`}
                >
                  <div className="entry-mypage-emoji-heading">
                    <strong id={`${id}-emoji-title`}>프로필 이모지</strong>
                    <span aria-live="polite">{profileEmoji.label} 선택됨</span>
                  </div>
                  <div className="entry-mypage-emoji-options">
                    {previewEmojis.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        disabled={!entry.unlocked}
                        aria-pressed={profileEmojiId === entry.id}
                        aria-label={
                          entry.unlocked
                            ? `${entry.label} 이모지 선택`
                            : `${entry.label}, ${entry.unlockLabel}부터 선택 가능`
                        }
                        onClick={() => setProfileEmojiId(entry.id)}
                      >
                        <span aria-hidden="true">{entry.emoji}</span>
                        {profileEmojiId === entry.id && (
                          <svg
                            className="entry-mypage-emoji-check"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden="true"
                          >
                            <path d="m5 12 4 4L19 6" />
                          </svg>
                        )}
                        {!entry.unlocked && (
                          <small>
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              aria-hidden="true"
                            >
                              <rect
                                x="5"
                                y="10"
                                width="14"
                                height="11"
                                rx="2"
                              />
                              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                            </svg>
                            {entry.unlockLabel}
                          </small>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="entry-mypage-action"
                onClick={() => {
                  setMenu("wrong-note");
                  tabs.current[2]?.focus();
                }}
              >
                오답 노트 보기 <span aria-hidden="true">→</span>
              </button>
            </div>

            <div
              role="tabpanel"
              id={`${id}-panel-score`}
              aria-labelledby={`${id}-tab-score`}
              hidden={menu !== "score"}
              tabIndex={0}
            >
              <span className="entry-mypage-label">나의 성적표</span>
              <h3>역사, 나의 목표까지</h3>
              <div className="entry-mypage-score">
                <div>
                  <span>현재 점수</span>
                  <strong>
                    78<small>점</small>
                  </strong>
                </div>
                <div>
                  <span>목표 점수</span>
                  <b>85점</b>
                </div>
              </div>
              <div className="entry-mypage-progress" aria-hidden="true">
                <span />
              </div>
              <p className="entry-mypage-goal-gap">목표까지 7점</p>
            </div>

            <div
              role="tabpanel"
              id={`${id}-panel-wrong-note`}
              aria-labelledby={`${id}-tab-wrong-note`}
              hidden={menu !== "wrong-note"}
              tabIndex={0}
            >
              <span className="entry-mypage-label">오답 노트</span>
              <h3>다시 살펴볼 한 문제</h3>
              <p className="entry-mypage-question">
                {entryMaterial.quiz.question}
              </p>
              <button
                type="button"
                className="entry-mypage-action"
                aria-expanded={showExplanation}
                aria-controls={`${id}-explanation`}
                onClick={() => setShowExplanation((shown) => !shown)}
              >
                {showExplanation ? "해설 접기" : "정답과 해설 보기"}
                <span aria-hidden="true">{showExplanation ? "−" : "+"}</span>
              </button>
              <div
                id={`${id}-explanation`}
                className="entry-mypage-explanation"
                hidden={!showExplanation}
              >
                <strong>정답</strong>
                <p>{entryMaterial.quiz.answer}</p>
                <strong>해설</strong>
                <p>{entryMaterial.quiz.explanation}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
