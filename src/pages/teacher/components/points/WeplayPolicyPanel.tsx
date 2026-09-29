import React, { useEffect, useMemo, useRef, useState } from "react";
import NumericInput from "../../../../components/common/NumericInput";
import { getYearSemester } from "../../../../lib/semesterScope";
import {
  getWeplayPolicy,
  saveWeplayPolicy,
  WEPLAY_DIFFICULTY_LABELS,
  type WeplayDifficulty,
  type WeplayPeriod,
  type WeplayPolicy,
  type WeplayRankRewards,
} from "../../../../lib/weplay";
import type { SystemConfig } from "../../../../types";
import "./WeplayPolicyPanel.css";

interface WeplayPolicyPanelProps {
  config: Pick<SystemConfig, "year" | "semester"> | null;
  canManage: boolean;
  active: boolean;
}

interface PolicyDraft {
  enabled: boolean;
  challengeCost: string;
  dailyChallengeLimit: string;
  resultRewards: { minCorrect: number; amount: string }[];
  rankingPeriod: WeplayPolicy["rankingPeriod"];
  rankingRewards: Record<
    WeplayDifficulty,
    { first: string; second: string; third: string }
  >;
}

type FieldErrors = Record<string, string>;

const rankFields = [
  { key: "first", label: "1위" },
  { key: "second", label: "2위" },
  { key: "third", label: "3위" },
] as const;

const difficultyFields = (["mild", "medium", "spicy"] as const).map((key) => ({
  key,
  label: WEPLAY_DIFFICULTY_LABELS[key],
}));

const toRankDraft = (rewards: WeplayRankRewards) => ({
  first: String(rewards.first),
  second: String(rewards.second),
  third: String(rewards.third),
});

const toDraft = (policy: WeplayPolicy): PolicyDraft => ({
  enabled: policy.enabled,
  challengeCost: String(policy.challengeCost),
  dailyChallengeLimit: String(policy.dailyChallengeLimit),
  resultRewards: policy.resultRewards.map((reward) => ({
    minCorrect: reward.minCorrect,
    amount: String(reward.amount),
  })),
  rankingPeriod: policy.rankingPeriod,
  rankingRewards: {
    mild: toRankDraft(policy.rankingRewards.mild),
    medium: toRankDraft(policy.rankingRewards.medium),
    spicy: toRankDraft(policy.rankingRewards.spicy),
  },
});

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(timestamp);

const formatPeriod = (period: WeplayPeriod) =>
  `${formatDate(period.startsAtMs)} ~ ${formatDate(period.endsAtMs - 1)}`;

const NumberField = ({
  id,
  label,
  accessibleLabel = label,
  value,
  suffix = "위스",
  max = 10000,
  disabled,
  error,
  onChange,
}: {
  id: string;
  label: string;
  accessibleLabel?: string;
  value: string;
  suffix?: string;
  max?: number;
  disabled: boolean;
  error?: string;
  onChange: (value: string) => void;
}) => (
  <div className="weplay-policy__field">
    <label htmlFor={id}>{label}</label>
    <div className="weplay-policy__number">
      <NumericInput
        id={id}
        allowEmpty
        value={value}
        min={0}
        max={max}
        step={1}
        inputMode="numeric"
        disabled={disabled}
        aria-label={`${accessibleLabel} (${suffix})`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <span aria-hidden="true">{suffix}</span>
    </div>
    {error && (
      <p id={`${id}-error`} className="weplay-policy__field-error">
        {error}
      </p>
    )}
  </div>
);

const WeplayPolicyPanel: React.FC<WeplayPolicyPanelProps> = ({
  config,
  canManage,
  active,
}) => {
  const scope = useMemo(
    () => getYearSemester(config),
    [config?.year, config?.semester],
  );
  const scopeKey = `${scope.year}/${scope.semester}`;
  const scopeReady = Boolean(config?.year && config?.semester);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const panelRef = useRef<HTMLElement>(null);
  const savingRef = useRef(false);
  const [loadedScope, setLoadedScope] = useState("");
  const [savedPolicy, setSavedPolicy] = useState<WeplayPolicy | null>(null);
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [period, setPeriod] = useState<WeplayPeriod | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!active || loadedScope === scopeKey) return;
    if (!scopeReady) {
      setLoading(false);
      setLoadError("현재 학기를 확인하지 못했습니다. 새로고침해 주세요.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setFeedback(null);
    setErrors({});
    getWeplayPolicy(scope)
      .then((result) => {
        if (cancelled) return;
        setSavedPolicy(result.policy);
        setDraft(toDraft(result.policy));
        setPeriod(result.currentRankingPeriod);
        setLoading(false);
        setLoadedScope(scopeKey);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadError(
            "위플레이 정책을 불러오지 못했습니다. 다시 시도해 주세요.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, loadedScope, retryKey, scope, scopeKey, scopeReady]);

  const dirty = Boolean(
    draft &&
    savedPolicy &&
    JSON.stringify(draft) !== JSON.stringify(toDraft(savedPolicy)),
  );

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const updateDraft = (update: (previous: PolicyDraft) => PolicyDraft) => {
    setDraft((previous) => (previous ? update(previous) : previous));
    setFeedback(null);
  };

  const handleSave = async () => {
    if (
      !canManage ||
      !active ||
      !scopeReady ||
      !draft ||
      !savedPolicy ||
      !dirty ||
      savingRef.current ||
      loadedScope !== scopeKey
    )
      return;
    const nextErrors: FieldErrors = {};
    const parseInteger = (id: string, value: string, max: number) => {
      const parsed = Number(value);
      if (
        !value.trim() ||
        !Number.isInteger(parsed) ||
        parsed < 0 ||
        parsed > max
      )
        nextErrors[id] =
          `0~${max.toLocaleString("ko-KR")} 사이의 정수를 입력해 주세요.`;
      return parsed;
    };
    const parseRankRewards = (difficulty: WeplayDifficulty) => ({
      first: parseInteger(
        `weplay-rank-${difficulty}-first`,
        draft.rankingRewards[difficulty].first,
        10000,
      ),
      second: parseInteger(
        `weplay-rank-${difficulty}-second`,
        draft.rankingRewards[difficulty].second,
        10000,
      ),
      third: parseInteger(
        `weplay-rank-${difficulty}-third`,
        draft.rankingRewards[difficulty].third,
        10000,
      ),
    });
    const nextPolicy: WeplayPolicy = {
      ...savedPolicy,
      enabled: draft.enabled,
      challengeCost: parseInteger("weplay-cost", draft.challengeCost, 10000),
      dailyChallengeLimit: parseInteger(
        "weplay-daily-limit",
        draft.dailyChallengeLimit,
        20,
      ),
      resultRewards: draft.resultRewards.map((reward) => ({
        minCorrect: reward.minCorrect,
        amount: parseInteger(
          `weplay-reward-${reward.minCorrect}`,
          reward.amount,
          10000,
        ),
      })),
      rankingPeriod: draft.rankingPeriod,
      rankingRewards: {
        mild: parseRankRewards("mild"),
        medium: parseRankRewards("medium"),
        spicy: parseRankRewards("spicy"),
      },
    };
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setFeedback({
        tone: "error",
        message: "입력값을 확인해 주세요. 정책은 저장되지 않았습니다.",
      });
      requestAnimationFrame(() =>
        panelRef.current
          ?.querySelector<HTMLInputElement>("[aria-invalid='true']")
          ?.focus(),
      );
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFeedback(null);
    const savingScope = scopeKey;
    try {
      const result = await saveWeplayPolicy(scope, nextPolicy);
      if (currentScope.current !== savingScope) return;
      setSavedPolicy(result.policy);
      setDraft(toDraft(result.policy));
      setPeriod(result.currentRankingPeriod);
      setFeedback({
        tone: "success",
        message: "위플레이 정책을 저장했습니다.",
      });
    } catch {
      if (currentScope.current === savingScope)
        setFeedback({
          tone: "error",
          message:
            "정책을 저장하지 못했습니다. 입력한 값은 유지됩니다. 다시 저장해 주세요.",
        });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const disabled = !canManage || saving || !active;
  const ready = scopeReady && loadedScope === scopeKey && draft && savedPolicy;

  return (
    <section
      ref={panelRef}
      className="weplay-policy"
      hidden={!active}
      aria-labelledby="weplay-policy-title"
      aria-busy={loading || saving}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          void handleSave();
        }
      }}
    >
      <header className="weplay-policy__header">
        <h3 id="weplay-policy-title">역사가 내려와 (60초)</h3>
        {ready && (
          <span
            className={
              dirty ? "weplay-policy__unsaved" : "weplay-policy__saved"
            }
          >
            {dirty ? "저장되지 않은 변경사항" : "저장된 정책과 동일"}
          </span>
        )}
      </header>

      {loading && (
        <p className="weplay-policy__status" role="status">
          위플레이 정책을 불러오는 중입니다.
        </p>
      )}
      {loadError && (
        <div className="weplay-policy__feedback is-error" role="alert">
          <p>{loadError}</p>
          <button
            type="button"
            className="weplay-policy__secondary"
            onClick={() => setRetryKey((key) => key + 1)}
          >
            다시 불러오기
          </button>
        </div>
      )}

      {ready && (
        <>
          {!canManage && (
            <p className="weplay-policy__notice">
              위플레이 정책을 수정할 권한이 없습니다.
            </p>
          )}
          <fieldset className="weplay-policy__group" disabled={disabled}>
            <legend>위스 도전</legend>
            <p className="weplay-policy__notice">
              변경한 정책은 다음 판부터 적용됩니다. 진행 중인 판은 시작할 때의
              정책을 따릅니다.
            </p>
            <label className="weplay-policy__toggle">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) =>
                  updateDraft((previous) => ({
                    ...previous,
                    enabled: event.target.checked,
                  }))
                }
              />
              <span>위스 도전 허용</span>
            </label>
            <div className="weplay-policy__grid">
              <NumberField
                id="weplay-cost"
                label="도전 비용"
                value={draft.challengeCost}
                disabled={disabled}
                error={errors["weplay-cost"]}
                onChange={(challengeCost) =>
                  updateDraft((previous) => ({ ...previous, challengeCost }))
                }
              />
              <NumberField
                id="weplay-daily-limit"
                label="하루 도전 횟수"
                suffix="회"
                max={20}
                value={draft.dailyChallengeLimit}
                disabled={disabled}
                error={errors["weplay-daily-limit"]}
                onChange={(dailyChallengeLimit) =>
                  updateDraft((previous) => ({
                    ...previous,
                    dailyChallengeLimit,
                  }))
                }
              />
            </div>
            <h4>결과별 지급액</h4>
            <p className="weplay-policy__notice">
              종료 시 지급하는 금액입니다. 실제 위스 증감은 지급액에서 도전
              비용을 뺀 값입니다.
            </p>
            <div className="weplay-policy__rewards">
              {draft.resultRewards.map((reward, index) => {
                const maximum =
                  (draft.resultRewards[index + 1]?.minCorrect ?? 21) - 1;
                const label =
                  reward.minCorrect === maximum
                    ? `${reward.minCorrect}개 처리`
                    : `${reward.minCorrect}~${maximum}개 처리`;
                return (
                  <NumberField
                    key={reward.minCorrect}
                    id={`weplay-reward-${reward.minCorrect}`}
                    label={label}
                    value={reward.amount}
                    disabled={disabled}
                    error={errors[`weplay-reward-${reward.minCorrect}`]}
                    onChange={(amount) =>
                      updateDraft((previous) => ({
                        ...previous,
                        resultRewards: previous.resultRewards.map((entry) =>
                          entry.minCorrect === reward.minCorrect
                            ? { ...entry, amount }
                            : entry,
                        ),
                      }))
                    }
                  />
                );
              })}
            </div>
          </fieldset>

          <fieldset className="weplay-policy__group" disabled={disabled}>
            <legend>난이도별 학급 랭킹 보상</legend>
            <p className="weplay-policy__notice">
              집계 기간과 순위 보상 변경은 다음 랭킹 기간부터 적용됩니다. 기간이
              끝난 뒤 확정 순위에 한 번만 지급합니다.
            </p>
            {period && (
              <div className="weplay-policy__current-period">
                <span>현재 기간 · {formatPeriod(period)}</span>
                {difficultyFields.map(({ key, label }) => (
                  <span key={key}>
                    {label} · 1위{" "}
                    {period.rankingRewards[key].first.toLocaleString("ko-KR")}
                    위스 · 2위{" "}
                    {period.rankingRewards[key].second.toLocaleString("ko-KR")}
                    위스 · 3위{" "}
                    {period.rankingRewards[key].third.toLocaleString("ko-KR")}
                    위스
                  </span>
                ))}
              </div>
            )}
            <div className="weplay-policy__field">
              <label htmlFor="weplay-ranking-period">집계 기간</label>
              <select
                id="weplay-ranking-period"
                value={draft.rankingPeriod}
                onChange={(event) =>
                  updateDraft((previous) => ({
                    ...previous,
                    rankingPeriod: event.target
                      .value as WeplayPolicy["rankingPeriod"],
                  }))
                }
              >
                <option value="weekly">주간</option>
                <option value="monthly">월간</option>
              </select>
            </div>
            {difficultyFields.map(
              ({ key: difficulty, label: difficultyLabel }) => (
                <div className="weplay-policy__difficulty" key={difficulty}>
                  <h4>{difficultyLabel}</h4>
                  <div className="weplay-policy__rewards">
                    {rankFields.map(({ key, label }) => (
                      <NumberField
                        key={key}
                        id={`weplay-rank-${difficulty}-${key}`}
                        label={`${label} 보상`}
                        accessibleLabel={`${difficultyLabel} ${label} 보상`}
                        value={draft.rankingRewards[difficulty][key]}
                        disabled={disabled}
                        error={errors[`weplay-rank-${difficulty}-${key}`]}
                        onChange={(amount) =>
                          updateDraft((previous) => ({
                            ...previous,
                            rankingRewards: {
                              ...previous.rankingRewards,
                              [difficulty]: {
                                ...previous.rankingRewards[difficulty],
                                [key]: amount,
                              },
                            },
                          }))
                        }
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
          </fieldset>

          {feedback && (
            <p
              className={`weplay-policy__feedback is-${feedback.tone}`}
              role={feedback.tone === "error" ? "alert" : "status"}
            >
              {feedback.message}
            </p>
          )}
          <footer className="weplay-policy__footer">
            <button
              type="button"
              className="weplay-policy__primary"
              disabled={disabled || !dirty}
              onClick={() => void handleSave()}
            >
              {saving ? "저장 중…" : "위플레이 정책 저장"}
            </button>
          </footer>
        </>
      )}
    </section>
  );
};

export default WeplayPolicyPanel;
