import PortalWorkspace from "../../../components/common/PortalWorkspace";
import React, { useEffect, useMemo, useState } from "react";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { InlineLoading } from "../../../components/common/LoadingState";
import PortalSubNavigation from "../../../components/common/PortalSubNavigation";
import MapViewer from "../../../components/common/MapViewer";
import { useAuth } from "../../../contexts/AuthContext";
import { notifyPointsUpdated } from "../../../lib/appEvents";
import { claimMapTagReward } from "../../../lib/learningCommands";
import {
  groupMapResourcesForDisplay,
  getGoogleMapsExternalUrl,
  mergeMapResources,
  type MapResource,
} from "../../../lib/mapResources";
import { readStudentMapResources } from "../../../lib/studentLessonReadCache";

const getPreferredMapGroup = <
  T extends { key: string; title: string; items: Array<{ id: string }> },
>(
  groups: T[],
) =>
  groups.find((group) => group.title.includes("한국사")) || groups[0] || null;

const StudentMaps: React.FC = () => {
  const { config } = useAuth();
  const { showToast } = useAppToast();
  const [items, setItems] = useState<MapResource[]>([]);
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [googleSearchQuery, setGoogleSearchQuery] = useState("");
  const [mapRewardPending, setMapRewardPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);

  const displayGroups = useMemo(
    () => groupMapResourcesForDisplay(items),
    [items],
  );
  const groupMap = useMemo(
    () => new Map(displayGroups.map((group) => [group.key, group])),
    [displayGroups],
  );

  useEffect(() => {
    const loadMaps = async () => {
      setLoading(true);
      try {
        const merged = await readStudentMapResources(config);
        const firstGroup = getPreferredMapGroup(
          groupMapResourcesForDisplay(merged),
        );

        setItems(merged);
        setSelectedGroupKey((prev) => prev || firstGroup?.key || "");
        setSelectedId((prev) => prev || firstGroup?.items[0]?.id || "");
      } catch (error) {
        console.error("Failed to load map resources:", error);
        const fallback = mergeMapResources([]);
        const firstGroup = getPreferredMapGroup(
          groupMapResourcesForDisplay(fallback),
        );
        setItems(fallback);
        setSelectedGroupKey((prev) => prev || firstGroup?.key || "");
        setSelectedId((prev) => prev || firstGroup?.items[0]?.id || "");
      } finally {
        setLoading(false);
      }
    };

    void loadMaps();
  }, [config]);

  const currentGroup =
    groupMap.get(selectedGroupKey) || displayGroups[0] || null;
  const currentTabItems = currentGroup?.items || [];
  const selectedItem =
    currentTabItems.find((item) => item.id === selectedId) ||
    currentTabItems[0] ||
    items[0] ||
    null;

  useEffect(() => {
    if (!displayGroups.length) return;
    if (!currentGroup) {
      const nextGroup = displayGroups[0];
      setSelectedGroupKey(nextGroup.key);
      setSelectedId(nextGroup.items[0]?.id || "");
    }
  }, [currentGroup, displayGroups]);

  useEffect(() => {
    if (!currentTabItems.length) return;
    if (!currentTabItems.some((item) => item.id === selectedId)) {
      setSelectedId(currentTabItems[0].id);
    }
  }, [currentTabItems, selectedId]);

  useEffect(() => {
    if (selectedItem?.type === "google") {
      setGoogleSearchQuery(selectedItem.googleQuery || "");
    } else {
      setGoogleSearchQuery("");
    }
  }, [selectedItem?.googleQuery, selectedItem?.id, selectedItem?.type]);

  const externalUrl =
    selectedItem?.type === "google"
      ? selectedItem.externalUrl ||
        getGoogleMapsExternalUrl(
          googleSearchQuery || selectedItem.googleQuery || "",
        )
      : selectedItem?.externalUrl || selectedItem?.fileUrl || "";

  const handleModalTagClick = async (tag: string) => {
    if (!selectedItem || mapRewardPending) return;
    setMapRewardPending(true);
    try {
      const pointResult = await claimMapTagReward(config, selectedItem.id, tag);
      if (
        pointResult.awarded &&
        (pointResult.totalAwarded || pointResult.amount)
      ) {
        notifyPointsUpdated();
      }
      if ((pointResult.totalAwarded || pointResult.amount) > 0) {
        const totalAwarded = Number(
          pointResult.totalAwarded || pointResult.amount || 0,
        );
        showToast({
          tone: "success",
          title: "지도 태그 탐색 완료",
          message: `+${totalAwarded}위스가 반영되었습니다.`,
        });
      } else if (pointResult.duplicate) {
        const duplicateMessage =
          pointResult.blockedMessage ||
          "이번 지도 태그 위스는 이미 반영되었습니다.";
        showToast({
          tone: "info",
          title: duplicateMessage,
        });
      }
    } catch (error) {
      console.error("Failed to claim map tag reward:", error);
      showToast({
        tone: "warning",
        title: "지도 탐색은 완료되었습니다.",
        message: "위스 반영 상태를 바로 확인하지 못했습니다.",
      });
    } finally {
      setMapRewardPending(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <PortalWorkspace
        as="main"
        className="teacher-sub-workspace teacher-sub-workspace--page flex-1"
      >
        <PortalSubNavigation
          title="지도"
          activeLabel={
            selectedItem?.title || currentGroup?.title || "지도 선택"
          }
          open={menuOpen}
          onOpenChange={setMenuOpen}
        >
          {displayGroups.map((group) => (
            <div key={group.key}>
              <button
                type="button"
                onClick={() => {
                  const expanded =
                    (expandedGroupKey ?? currentGroup?.key) === group.key;
                  setExpandedGroupKey(expanded ? "" : group.key);
                  if (currentGroup?.key !== group.key) {
                    setSelectedGroupKey(group.key);
                    setSelectedId(group.items[0]?.id || "");
                  }
                }}
                className={`teacher-settings-section${currentGroup?.key === group.key ? " is-active" : ""}`}
                aria-expanded={
                  (expandedGroupKey ?? currentGroup?.key) === group.key
                }
              >
                <i className="fas fa-map shrink-0" aria-hidden="true" />
                <span title={group.title} className="teacher-navigation-label">
                  {group.title}
                </span>
                <i
                  className={`fas fa-chevron-${(expandedGroupKey ?? currentGroup?.key) === group.key ? "down" : "right"} ml-auto text-xs`}
                  aria-hidden="true"
                />
              </button>
              {(expandedGroupKey ?? currentGroup?.key) === group.key && (
                <div
                  className="ml-4 border-l border-gray-200 pl-2"
                  role="group"
                  aria-label={`${group.title} 세부 지도`}
                >
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      title={item.title}
                      className={`teacher-settings-section${selectedItem?.id === item.id ? " is-active" : ""}`}
                      aria-current={
                        selectedItem?.id === item.id ? "page" : undefined
                      }
                      onClick={() => {
                        setSelectedGroupKey(group.key);
                        setSelectedId(item.id);
                        setMenuOpen(false);
                      }}
                    >
                      <span className="teacher-navigation-label">
                        {item.title}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </PortalSubNavigation>

        <section className="teacher-sub-content">
          {loading ? (
            <InlineLoading message="지도를 불러오는 중입니다." showWarning />
          ) : selectedItem ? (
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h1 className="text-xl font-extrabold text-gray-900 sm:text-2xl">
                      {selectedItem.title}
                    </h1>
                  </div>
                  {externalUrl && (
                    <a
                      href={externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 sm:w-auto"
                    >
                      <i className="fas fa-up-right-from-square"></i>새 창에서
                      열기
                    </a>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 p-2">
                <MapViewer
                  item={selectedItem}
                  googleSearchQuery={
                    selectedItem.type === "google"
                      ? googleSearchQuery
                      : undefined
                  }
                  onGoogleSearchQueryChange={
                    selectedItem.type === "google"
                      ? setGoogleSearchQuery
                      : undefined
                  }
                  onModalTagClick={
                    selectedItem.type === "pdf"
                      ? handleModalTagClick
                      : undefined
                  }
                  showShell={false}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-500 shadow-sm">
              지도를 선택해 주세요.
            </div>
          )}
        </section>
      </PortalWorkspace>
    </div>
  );
};

export default StudentMaps;
