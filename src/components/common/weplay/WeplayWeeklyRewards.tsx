import { InlineLoading } from "../LoadingState";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import {
  canReadLessonManagement,
  canWriteLessonManagement,
} from "../../../lib/permissions";
import { getHistoryDictionaryCallable } from "../../../lib/historyDictionarySession";
import { getYearSemester } from "../../../lib/semesterScope";
import { getWeplayRankingWeek } from "../../../lib/weplayRanking";
import {
  WEPLAY_DIFFICULTY_LABELS,
  type WeplayGameId,
} from "../../../lib/weplay";
import { useAppToast } from "../AppToastProvider";
import { RHYTHM_SONGS } from "./rhythm/rhythmSongs";
import "./weplay-weekly-rewards.css";

type Tier = { throughRank: number; wis: number };
type Plan = {
  tiers: Tier[];
  revision: number;
  status: string;
  paidCount: number;
  paidWis: number;
  skippedCount: number;
  lastError?: string;
  mode?: "week" | "recurring";
  enabled?: boolean;
  manualOverride?: boolean;
  origin?: "recurring" | null;
  week: { endsAtMs: number };
};
const weekIdAt = (time: number) =>
  new Date(getWeplayRankingWeek(time).startsAtMs + 9 * 3600000)
    .toISOString()
    .slice(0, 10);
const statuses: Record<string, string> = {
  unscheduled: "미설정",
  scheduled: "주 종료 후 자동 지급",
  disabled: "지급 안 함",
  settling: "지급 중",
  paid: "지급 완료",
  recurring: "매주 자동 지급",
};

export default function WeplayWeeklyRewards({
  gameId,
}: {
  gameId: WeplayGameId;
}) {
  const { currentUser, userData, config, authGeneration } = useAuth();
  const { showToast } = useAppToast();
  const canRead = canReadLessonManagement(userData, currentUser?.email);
  const canWrite = canWriteLessonManagement(userData, currentUser?.email);
  const categories =
    gameId === "joseon-yut"
      ? [{ id: "wins", label: "온라인 우승" }]
      : gameId === "history-rain"
        ? Object.entries(WEPLAY_DIFFICULTY_LABELS).map(([id, label]) => ({
            id,
            label,
          }))
        : RHYTHM_SONGS.flatMap((song) => [
            { id: `${song.id}:normal`, label: `${song.title} · 자진모리` },
            { id: `${song.id}:hard`, label: `${song.title} · 휘모리` },
          ]);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(categories[0].id);
  const [weekId, setWeekId] = useState(() => weekIdAt(Date.now()));
  const [mode, setMode] = useState<"week" | "recurring">("recurring");
  const [enabled, setEnabled] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const scope = `${currentUser?.uid}/${authGeneration}/${config?.year}/${config?.semester}/${canRead}/${canWrite}/${gameId}/${category}/${weekId}/${mode}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const busy = useRef<string | null>(null);
  const requestRef = useRef<{ fingerprint: string; id: string }>();
  const call = async (name: string, values: object) => {
    const fn = await getHistoryDictionaryCallable<object, Plan>(name, {
      reuseSessionProof: true,
    });
    return (
      await fn({
        ...getYearSemester(config),
        gameId,
        category,
        weekId: mode === "recurring" ? weekIdAt(Date.now()) : weekId,
        mode,
        ...values,
      })
    ).data;
  };
  useEffect(() => {
    setSaving(false);
  }, [scope]);
  useEffect(() => {
    let active = true;
    setPlan(null);
    setError("");
    requestRef.current = undefined;
    if (!open || !canRead || !config?.year || !config?.semester) return;
    setLoading(true);
    void call("getWeplayWeeklyRewards", {})
      .then((value) => {
        if (active) {
          setPlan(value);
          setTiers(value.tiers);
          setEnabled(value.enabled === true);
        }
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "보상 설정을 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, scope, retry]);
  const locked =
    !canWrite ||
    !plan ||
    loading ||
    saving ||
    (mode === "week" &&
      (plan.week.endsAtMs <= Date.now() ||
        ["paid", "settling"].includes(plan.status)));
  const dirty =
    !!plan &&
    (JSON.stringify(tiers) !== JSON.stringify(plan.tiers) ||
      (mode === "week" && plan.origin === "recurring") ||
      (mode === "recurring" && enabled !== Boolean(plan.enabled)));
  const valid = tiers.every(
    (tier, index) =>
      Number.isSafeInteger(tier.throughRank) &&
      tier.throughRank > (tiers[index - 1]?.throughRank || 0) &&
      tier.throughRank <= 50 &&
      Number.isSafeInteger(tier.wis) &&
      tier.wis >= 0 &&
      tier.wis <= 100000,
  );
  const save = async () => {
    if (locked || !dirty || !valid || busy.current === scope) return;
    busy.current = scope;
    setSaving(true);
    setError("");
    const started = scope;
    const payload = {
      tiers,
      revision: plan.revision,
      ...(mode === "recurring" ? { enabled } : {}),
    };
    const fingerprint = JSON.stringify([scope, payload]);
    if (requestRef.current?.fingerprint !== fingerprint)
      requestRef.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const value = await call("saveWeplayWeeklyRewards", {
        ...payload,
        requestId: requestRef.current.id,
      });
      if (scopeRef.current === started) {
        setPlan(value);
        setTiers(value.tiers);
        setEnabled(value.enabled === true);
        requestRef.current = undefined;
        showToast({ title: "주간 보상 설정을 저장했습니다.", tone: "success" });
      }
    } catch (reason) {
      if (scopeRef.current === started)
        setError(
          reason instanceof Error
            ? reason.message
            : "저장하지 못했습니다. 다시 시도해 주세요.",
        );
    } finally {
      if (busy.current === started) busy.current = null;
      if (scopeRef.current === started) setSaving(false);
    }
  };
  if (!canRead) return null;
  return (
    <details
      className="weplay-weekly-rewards"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-expanded={open}>
        <svg
          className="weplay-weekly-rewards-chevron"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 3 5 5-5 5" />
        </svg>
        주간 랭킹 보상
      </summary>
      <div className="weplay-weekly-rewards-controls">
        <label>
          적용
          <select
            aria-label="보상 적용 방식"
            value={mode}
            disabled={saving}
            onChange={(event) => {
              setPlan(null);
              setMode(event.target.value as "week" | "recurring");
            }}
          >
            <option value="recurring">매주 반복</option>
            <option value="week">주차별 설정</option>
          </select>
        </label>
        {mode === "week" && (
          <label>
            주차{" "}
            <input
              type="date"
              aria-label="보상 주차"
              value={weekId}
              disabled={saving}
              onChange={(event) => {
                if (event.target.value)
                  setWeekId(
                    weekIdAt(
                      Date.parse(`${event.target.value}T12:00:00+09:00`),
                    ),
                  );
              }}
            />
          </label>
        )}
        <label>
          전체 랭킹{" "}
          <select
            value={category}
            aria-label="보상 랭킹"
            disabled={saving}
            onChange={(event) => setCategory(event.target.value)}
          >
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {mode === "recurring" && plan && (
          <label>
            매주 지급
            <select
              aria-label="매주 지급"
              value={enabled ? "on" : "off"}
              disabled={locked}
              onChange={(event) => setEnabled(event.target.value === "on")}
            >
              <option value="on">사용</option>
              <option value="off">중지</option>
            </select>
          </label>
        )}
        {plan && (
          <span className="weplay-weekly-rewards-status">
            {mode === "week" && plan.origin === "recurring"
              ? "매주 반복 · "
              : ""}
            {statuses[plan.status] || plan.status}
          </span>
        )}
        <button
          type="button"
          disabled={loading || saving}
          onClick={() => setRetry((value) => value + 1)}
        >
          새로고침
        </button>
      </div>
      {loading && <InlineLoading />}
      {plan && (
        <>
          {mode === "recurring" && (
            <p className="weplay-weekly-rewards-status">
              이번 주부터 · 현재 학기까지
              {plan.manualOverride ? " · 이번 주는 주차별 설정 우선" : ""}
            </p>
          )}
          <div className="weplay-weekly-rewards-tiers">
            {tiers.map((tier, index) => (
              <div className="weplay-weekly-rewards-tier" key={index}>
                <span>{(tiers[index - 1]?.throughRank || 0) + 1}위부터</span>
                <label>
                  <input
                    type="number"
                    min={(tiers[index - 1]?.throughRank || 0) + 1}
                    max="50"
                    aria-label={`${index + 1}구간 마지막 순위`}
                    value={tier.throughRank}
                    disabled={locked}
                    onChange={(event) =>
                      setTiers((previous) =>
                        previous.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                throughRank: Number(event.target.value),
                              }
                            : item,
                        ),
                      )
                    }
                  />
                  위까지
                </label>
                <label>
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    aria-label={`${index + 1}구간 지급 위스`}
                    value={tier.wis}
                    disabled={locked}
                    onChange={(event) =>
                      setTiers((previous) =>
                        previous.map((item, i) =>
                          i === index
                            ? { ...item, wis: Number(event.target.value) }
                            : item,
                        ),
                      )
                    }
                  />
                  위스씩
                </label>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    setTiers((previous) =>
                      previous.filter((_, i) => i !== index),
                    )
                  }
                  aria-label={`${index + 1}구간 삭제`}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
          <div className="weplay-weekly-rewards-actions">
            <button
              type="button"
              disabled={locked || (tiers.at(-1)?.throughRank || 0) >= 50}
              onClick={() =>
                setTiers((previous) => [
                  ...previous,
                  {
                    throughRank: (previous.at(-1)?.throughRank || 0) + 1,
                    wis: 0,
                  },
                ])
              }
            >
              보상 구간 추가
            </button>
            <button
              type="button"
              className="teacher-weplay-button is-primary"
              disabled={locked || !dirty || !valid}
              onClick={() => void save()}
            >
              {saving
                ? "저장 중…"
                : mode === "week" && plan.origin === "recurring"
                  ? "이 주차만 저장"
                  : "보상 설정 저장"}
            </button>
          </div>
          {!valid && (
            <p role="alert">
              순위는 1~50위 오름차순, 위스는 0~100,000의 정수로 입력해 주세요.
            </p>
          )}
          {plan.status === "paid" && (
            <p>
              지급 {plan.paidCount}명 · {plan.paidWis.toLocaleString()}위스
              {plan.skippedCount
                ? ` · 탈퇴·승인 해제 ${plan.skippedCount}명 제외`
                : ""}
            </p>
          )}
          {plan.lastError && (
            <p role="alert">
              자동 지급을 완료하지 못했습니다. 학기·계좌 상태를 확인해 주세요.
              서버에서 재시도합니다.
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
