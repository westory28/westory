import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { getYearSemester } from "../../lib/semesterScope";
import { InlineLoading } from "./LoadingState";
import PointRankBadge from "./PointRankBadge";
import WisIcon from "./WisIcon";
import { getWisHallOfFameGradeLeaderboard } from "../../lib/wisHallOfFame";
import { getWisRankingPreview } from "../../lib/wisRankingPreview";
import { subscribePointsUpdated } from "../../lib/appEvents";
import { subscribeAvatarUpdated } from "../../features/avatar/events";
import AvatarPlaceholder from "../../features/avatar/AvatarPlaceholder";
import "./wisRankingAvatar.css";
import {
  getPointRankDefaultEmojiValue,
  getPointRankDisplay,
} from "../../lib/pointRanks";
import type {
  PointPolicy,
  PointWallet,
  SystemConfig,
  WisHallOfFameEntry,
} from "../../types";

interface WisRankingPanelProps {
  config: SystemConfig | null | undefined;
  hallOfFamePath?: string;
}

const formatWis = (value: unknown) => {
  const amount = Math.max(0, Number(value || 0));
  return amount.toLocaleString("ko-KR");
};

const rankTone = (rank: number) => {
  if (rank === 1) return "border-amber-200 bg-amber-50 text-amber-700";
  if (rank === 2) return "border-slate-200 bg-slate-50 text-slate-600";
  if (rank === 3) return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-gray-200 bg-white text-gray-900";
};

const rankIcon = (rank: number) => {
  if (rank === 1) return "fas fa-crown text-amber-500";
  if (rank === 2) return "fas fa-crown text-slate-400";
  if (rank === 3) return "fas fa-crown text-orange-500";
  return "";
};

const rankAccentClassName = (rank: number) => {
  if (rank >= 1 && rank <= 5) return `wis-ranking-row--rank-${rank}`;
  return "wis-ranking-row--default";
};

const buildRankWallet = (entry: WisHallOfFameEntry): PointWallet => ({
  uid: entry.uid,
  studentName: entry.studentName,
  grade: entry.grade,
  class: entry.class,
  number: entry.number || "",
  balance: Number(entry.currentBalance || 0),
  earnedTotal: Number(entry.cumulativeEarned || 0),
  rankEarnedTotal: Number(entry.cumulativeEarned || 0),
  spentTotal: 0,
  adjustedTotal: 0,
  rankSnapshot: null,
});

const avatarAsset = (character: string) =>
  `${import.meta.env.BASE_URL}avatar/v1/${character === "boy" ? "boy" : "girl"}-preview-v2.webp`;

const RankingAvatar: React.FC<{ entry: WisHallOfFameEntry }> = ({ entry }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const fallback = avatarAsset(entry.avatar?.look.character || "girl");
  const name = entry.displayName || entry.studentName;
  const hasSavedAvatar = Boolean(entry.avatar?.thumbnailUrl);

  return (
    <div className="wis-ranking-avatar" data-avatar-student={entry.uid}>
      <div className="wis-ranking-avatar__frame">
        {!hasSavedAvatar || imageFailed ? (
          <AvatarPlaceholder />
        ) : (
          <img
            className="wis-ranking-avatar__image"
            src={entry.avatar?.thumbnailUrl || fallback}
            alt={`${name} 학생의 아바타`}
            loading="lazy"
            decoding="async"
            onError={(event) => {
              if (event.currentTarget.getAttribute("src") !== fallback) {
                event.currentTarget.src = fallback;
              } else setImageFailed(true);
            }}
          />
        )}
      </div>
    </div>
  );
};

const WisRankingPanel: React.FC<WisRankingPanelProps> = ({
  config,
  hallOfFamePath,
}) => {
  const navigate = useNavigate();
  const { currentUser, authGeneration, configReady } = useAuth();
  const { year, semester } = getYearSemester(config);
  const scopeReady = Boolean(
    currentUser && configReady && config?.year && config?.semester,
  );
  const studentAudience = Boolean(hallOfFamePath?.startsWith("/student"));
  const [entries, setEntries] = useState<WisHallOfFameEntry[]>([]);
  const [rankPolicy, setRankPolicy] = useState<
    PointPolicy["rankPolicy"] | null
  >(null);
  const [defaultProfileIcon, setDefaultProfileIcon] = useState("😀");
  const [loading, setLoading] = useState(true);
  const [loadDurationMs, setLoadDurationMs] = useState<number | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [selectedUid, setSelectedUid] = useState("");
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const panel = useRef<HTMLDivElement>(null);
  const needsRefresh = useRef(false);
  const available = useRef(false);
  const savedScope = useRef("");
  const scopeKey = `${currentUser?.uid || ""}:${authGeneration}:${year}:${semester}:${studentAudience}`;
  const scopeLoading = loading || loadedScope !== scopeKey;
  const selectedEntry =
    loadedScope === scopeKey
      ? entries.find((entry) => entry.uid === selectedUid) || entries[0]
      : undefined;
  const selectedKey = selectedEntry
    ? `${scopeKey}:${selectedEntry.uid}:${selectedEntry.avatar?.lookHash || selectedEntry.avatar?.revision || "default"}`
    : "";
  available.current = visible && inView;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setReducedMotion(media.matches);
    const onVisibility = () => setVisible(!document.hidden);
    media.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onVisibility);
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.1 },
    );
    if (panel.current) observer.observe(panel.current);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    let queued = false;
    let cancelled = false;
    const refresh = () => {
      if (!available.current) {
        needsRefresh.current = true;
        return;
      }
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!cancelled) setRefreshRevision((value) => value + 1);
      });
    };
    const unsubscribePoints = subscribePointsUpdated(refresh);
    const unsubscribeAvatar = subscribeAvatarUpdated(refresh);
    return () => {
      cancelled = true;
      unsubscribePoints();
      unsubscribeAvatar();
    };
  }, []);

  useEffect(() => {
    if (visible && inView && needsRefresh.current) {
      needsRefresh.current = false;
      setRefreshRevision((value) => value + 1);
    }
  }, [visible, inView]);

  useEffect(() => {
    let cancelled = false;
    const changedScope = savedScope.current !== scopeKey;
    savedScope.current = scopeKey;
    if (changedScope || entries.length === 0) setLoading(true);
    if (changedScope) {
      setEntries([]);
      setRankPolicy(null);
      setDefaultProfileIcon("😀");
      setSelectedUid("");
    }
    setLoadError(false);
    setLoadDurationMs(null);
    if (!scopeReady) return;
    const startedAt = performance.now();
    const scope = { year, semester };
    void (async () => {
      try {
        const { snapshot, rankPolicy: policy } = await getWisRankingPreview(
          scope,
          studentAudience ? "student" : "teacher",
        );
        if (cancelled) return;
        setLoadedScope(scopeKey);
        setEntries(getWisHallOfFameGradeLeaderboard(snapshot).slice(0, 5));
        setRankPolicy(policy);
        setDefaultProfileIcon(getPointRankDefaultEmojiValue(policy));
        setLoadDurationMs(Math.round(performance.now() - startedAt));
      } catch (error) {
        console.warn("Failed to load wis ranking:", error);
        if (!cancelled) {
          setLoadedScope(scopeKey);
          setLoadError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    scopeReady,
    year,
    semester,
    studentAudience,
    currentUser,
    authGeneration,
    scopeKey,
    refreshRevision,
  ]);

  useEffect(() => {
    if (paused || reducedMotion || !visible || !inView || entries.length < 2)
      return;
    const timer = setTimeout(() => {
      const index = entries.findIndex(
        (entry) => entry.uid === selectedEntry?.uid,
      );
      setSelectedUid(entries[(index + 1) % entries.length].uid);
    }, 5000);
    return () => clearTimeout(timer);
  }, [paused, reducedMotion, visible, inView, entries, selectedEntry?.uid]);

  return (
    <div
      ref={panel}
      className="wis-ranking-panel wis-ranking-with-avatar flex h-full min-h-[260px] flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:min-h-0"
      data-ranking-load-ms={loadDurationMs ?? undefined}
    >
      <div className="wis-ranking-heading flex items-center justify-between gap-2">
        {hallOfFamePath ? (
          <button
            type="button"
            onClick={() => navigate(hallOfFamePath)}
            className="wis-ranking-title wis-ranking-title-link flex items-center rounded-md bg-transparent p-0 text-left text-lg font-extrabold text-gray-900 transition hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            aria-label="명예의 전당으로 이동"
          >
            <i className="fas fa-trophy mr-2 text-blue-600"></i>
            위스 순위
          </button>
        ) : (
          <h3 className="wis-ranking-title flex items-center text-lg font-extrabold text-gray-900">
            <i className="fas fa-trophy mr-2 text-blue-600"></i>
            위스 순위
          </h3>
        )}
        {hallOfFamePath && (
          <button
            type="button"
            onClick={() => navigate(hallOfFamePath)}
            className="wis-ranking-more-button inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 text-xs font-black text-blue-700 transition hover:border-blue-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            aria-label="명예의 전당 더보기"
          >
            더보기
            <i
              className="fas fa-chevron-right text-[10px]"
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      <div className="wis-ranking-avatar-layout">
        <div
          className="wis-ranking-list-scroll"
          role="region"
          aria-label="위스 순위 학생 선택"
          tabIndex={0}
        >
          <div className="wis-ranking-list min-h-0 flex-1 space-y-2">
            {scopeLoading && (
              <InlineLoading
                className="flex h-full min-h-[160px] items-center"
                message="순위를 불러오는 중입니다."
                showWarning
              />
            )}

            {!scopeLoading && loadError && (
              <div className="wis-ranking-load-error" role="status">
                <span>순위를 불러오지 못했습니다.</span>
                <button
                  type="button"
                  onClick={() => setRefreshRevision((value) => value + 1)}
                >
                  다시 시도
                </button>
              </div>
            )}

            {!scopeLoading && !loadError && entries.length === 0 && (
              <div className="flex h-full min-h-[160px] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm font-bold text-gray-400">
                표시할 위스 순위가 없습니다.
              </div>
            )}

            {!scopeLoading &&
              entries.map((entry, index) => {
                const rank = index + 1;
                const scoreRank =
                  Number(entry.cumulativeEarned || 0) > 0
                    ? Number(entry.rank || rank)
                    : 4;
                const iconClassName = rankIcon(scoreRank);
                const entryRank = rankPolicy
                  ? getPointRankDisplay({
                      rankPolicy,
                      wallet: buildRankWallet(entry),
                    })
                  : null;
                const rankAccent = rankAccentClassName(scoreRank);
                return (
                  <button
                    key={entry.uid}
                    type="button"
                    className={`wis-ranking-row ${rankAccent} rounded-lg border ${rankTone(scoreRank)}${selectedEntry?.uid === entry.uid ? " is-selected" : ""}`}
                    aria-pressed={selectedEntry?.uid === entry.uid}
                    aria-label={`${rank}위 ${entry.displayName || entry.studentName}, ${entry.grade}학년 ${entry.class}반, ${formatWis(entry.cumulativeEarned)} 위스, 아바타 선택`}
                    onClick={() => {
                      setSelectedUid(entry.uid);
                      setPaused(true);
                    }}
                  >
                    <span className="wis-ranking-place">
                      <span
                        className="wis-ranking-rank-medal"
                        aria-label={`${rank}위`}
                      >
                        {rank}
                      </span>
                      {iconClassName && (
                        <i
                          className={`wis-ranking-crown ${iconClassName}`}
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="wis-ranking-person">
                      <span className="wis-ranking-identity">
                        <span
                          className="wis-ranking-profile"
                          aria-hidden="true"
                        >
                          {entry.profileIcon || defaultProfileIcon}
                        </span>
                        <span
                          className="wis-ranking-name"
                          title={entry.displayName || entry.studentName}
                        >
                          {entry.displayName || entry.studentName}
                        </span>
                      </span>
                      <PointRankBadge
                        rank={entryRank}
                        size="sm"
                        className="wis-ranking-rank-badge"
                      />
                    </span>
                    <span className="wis-ranking-classroom">
                      {entry.grade}학년 {entry.class}반
                    </span>
                    <span
                      className="wis-ranking-score"
                      aria-label={`${formatWis(entry.cumulativeEarned)} 위스`}
                      title={`${formatWis(entry.cumulativeEarned)} 위스`}
                    >
                      <span>{formatWis(entry.cumulativeEarned)}</span>
                      <WisIcon />
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
        {!scopeLoading && selectedEntry && (
          <div className="wis-ranking-avatar-aside">
            <RankingAvatar key={selectedKey} entry={selectedEntry} />
          </div>
        )}
      </div>
    </div>
  );
};

export default WisRankingPanel;
