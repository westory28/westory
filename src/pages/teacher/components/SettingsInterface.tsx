import React, { useEffect, useRef, useState } from "react";
import {
  doc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { InlineLoading } from "../../../components/common/LoadingState";
import { db } from "../../../lib/firebase";
import {
  cloneDefaultMenus,
  sanitizeMenuConfig,
  type MenuConfig,
  type PortalType,
} from "../../../constants/menus";
import { useAuth } from "../../../contexts/AuthContext";
import {
  notifyMenuConfigUpdated,
  notifySystemConfigUpdated,
} from "../../../lib/appEvents";
import { buildStudentMenuVisibility } from "../../../lib/studentMenuAccess";
import { invalidateSiteSettingDocCache } from "../../../lib/siteSettings";
import { normalizeInstagramUrl } from "../../../lib/socialLinks";
import { WEPLAY_STUDENT_URL } from "../../../lib/weplayTitle";
import "../settingsPanels.css";
import "../../../components/common/portalPage.css";

type InterfaceTab = "landing" | "sitemap";

const createDefaultInterfaceConfig = () => ({
  dashboard: { notice: true, calendar: true, ranking: true },
  footerText: "",
  instagramUrl: "",
});

const DEFAULT_PARENT_ICON =
  "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253";
const SITEMAP_HEADER_COLORS = [
  "bg-blue-700",
  "bg-amber-600",
  "bg-lime-700",
  "bg-sky-700",
  "bg-indigo-700",
  "bg-cyan-700",
  "bg-rose-700",
];

const normalizeMenuUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const moveInArray = <T,>(items: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

const SettingsInterface: React.FC = () => {
  const { refreshInterfaceConfig } = useAuth();
  const { showToast } = useAppToast();
  const [activeTab, setActiveTab] = useState<InterfaceTab>("landing");
  const [activePortal, setActivePortal] = useState<PortalType>("student");
  const [config, setConfig] = useState(() => createDefaultInterfaceConfig());
  const [menuConfig, setMenuConfig] = useState<MenuConfig>(() =>
    cloneDefaultMenus(),
  );
  const loadedMenus = useRef<MenuConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [savingInterface, setSavingInterface] = useState(false);
  const [savingMenu, setSavingMenu] = useState(false);
  const [parentDraft, setParentDraft] = useState<
    Record<PortalType, { name: string; url: string }>
  >({
    student: { name: "", url: "" },
    teacher: { name: "", url: "" },
  });
  const [childDrafts, setChildDrafts] = useState<
    Record<string, { name: string; url: string }>
  >({});

  const getSitemapHeaderClass = (index: number) =>
    SITEMAP_HEADER_COLORS[index % SITEMAP_HEADER_COLORS.length];

  const getPortalLabel = (portal: PortalType) =>
    portal === "student" ? "학생 포털" : "교사 포털";

  const getPortalMenuStats = (portal: PortalType) => {
    const children = menuConfig[portal].flatMap((item) => item.children || []);
    return {
      parentCount: menuConfig[portal].length,
      childCount: children.length,
      hiddenCount:
        menuConfig[portal].filter((item) => item.hidden).length +
        children.filter((child) => child.hidden).length,
    };
  };

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const [interfaceSnap, menuSnap] = await Promise.all([
          getDocFromServer(doc(db, "site_settings", "interface_config")),
          getDocFromServer(doc(db, "site_settings", "menu_config")),
        ]);

        if (interfaceSnap.exists()) {
          const data = interfaceSnap.data();
          setConfig({
            dashboard: {
              notice: data.dashboard?.notice !== false,
              calendar: data.dashboard?.calendar !== false,
              ranking: data.dashboard?.ranking !== false,
            },
            footerText: data.footerText || "",
            instagramUrl: data.instagramUrl || "",
          });
        } else {
          setConfig(createDefaultInterfaceConfig());
        }

        const loaded = sanitizeMenuConfig(menuSnap.data());
        loadedMenus.current = loaded;
        setMenuConfig(loaded);
      } catch (error) {
        console.error("Failed to load interface settings:", error);
        loadedMenus.current = null;
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };

    void loadSettings();
  }, [loadAttempt]);

  const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const updatePortalMenus = (
    portal: PortalType,
    updater: (menus: MenuConfig[PortalType]) => MenuConfig[PortalType],
  ) => {
    setMenuConfig((prev) => ({
      ...prev,
      [portal]: updater(prev[portal]),
    }));
  };

  const updateParentName = (
    portal: PortalType,
    index: number,
    name: string,
  ) => {
    updatePortalMenus(portal, (menus) =>
      menus.map((item, idx) =>
        idx === index ? { ...item, name, nameCustomized: true } : item,
      ),
    );
  };

  const moveParent = (portal: PortalType, index: number, direction: -1 | 1) => {
    updatePortalMenus(portal, (menus) =>
      moveInArray(menus, index, index + direction),
    );
  };

  const deleteParent = (portal: PortalType, index: number) => {
    updatePortalMenus(portal, (menus) =>
      menus.filter((_, idx) => idx !== index),
    );
  };

  const toggleParentHidden = (portal: PortalType, index: number) => {
    updatePortalMenus(portal, (menus) =>
      menus.map((item, itemIndex) =>
        itemIndex === index ? { ...item, hidden: !item.hidden } : item,
      ),
    );
  };

  const updateChildName = (
    portal: PortalType,
    parentIndex: number,
    childIndex: number,
    name: string,
  ) => {
    updatePortalMenus(portal, (menus) =>
      menus.map((item, idx) => {
        if (idx !== parentIndex || !item.children) return item;
        return {
          ...item,
          children: item.children.map((child, cIdx) =>
            cIdx === childIndex
              ? {
                  ...child,
                  name,
                  nameCustomized: true,
                  ...(child.url === WEPLAY_STUDENT_URL
                    ? { gameTitleCustomized: true }
                    : {}),
                }
              : child,
          ),
        };
      }),
    );
  };

  const moveChild = (
    portal: PortalType,
    parentIndex: number,
    childIndex: number,
    direction: -1 | 1,
  ) => {
    updatePortalMenus(portal, (menus) =>
      menus.map((item, idx) => {
        if (idx !== parentIndex || !item.children) return item;
        return {
          ...item,
          children: moveInArray(
            item.children,
            childIndex,
            childIndex + direction,
          ),
        };
      }),
    );
  };

  const deleteChild = (
    portal: PortalType,
    parentIndex: number,
    childIndex: number,
  ) => {
    updatePortalMenus(portal, (menus) =>
      menus.map((item, idx) => {
        if (idx !== parentIndex || !item.children) return item;
        return {
          ...item,
          children: item.children.filter((_, cIdx) => cIdx !== childIndex),
        };
      }),
    );
  };

  const toggleChildHidden = (
    portal: PortalType,
    parentIndex: number,
    childIndex: number,
  ) => {
    updatePortalMenus(portal, (menus) =>
      menus.map((item, idx) => {
        if (idx !== parentIndex || !item.children) return item;
        return {
          ...item,
          children: item.children.map((child, cIdx) =>
            cIdx === childIndex ? { ...child, hidden: !child.hidden } : child,
          ),
        };
      }),
    );
  };

  const updateParentDraft = (
    portal: PortalType,
    field: "name" | "url",
    value: string,
  ) => {
    setParentDraft((prev) => ({
      ...prev,
      [portal]: {
        ...prev[portal],
        [field]: value,
      },
    }));
  };

  const addParent = (portal: PortalType) => {
    const name = parentDraft[portal].name.trim();
    const url = normalizeMenuUrl(parentDraft[portal].url);

    if (!name || !url) {
      showToast({
        tone: "warning",
        title: "상위 메뉴 입력을 확인해 주세요.",
        message: "상위 메뉴 이름과 URL을 모두 입력해야 합니다.",
      });
      return;
    }

    updatePortalMenus(portal, (menus) => [
      ...menus,
      {
        name,
        nameCustomized: true,
        url,
        icon: DEFAULT_PARENT_ICON,
        children: [],
      },
    ]);

    setParentDraft((prev) => ({
      ...prev,
      [portal]: { name: "", url: "" },
    }));
  };

  const getChildDraftKey = (portal: PortalType, parentIndex: number) =>
    `${portal}-${parentIndex}`;

  const updateChildDraft = (
    portal: PortalType,
    parentIndex: number,
    field: "name" | "url",
    value: string,
  ) => {
    const key = getChildDraftKey(portal, parentIndex);
    setChildDrafts((prev) => ({
      ...prev,
      [key]: {
        name: field === "name" ? value : prev[key]?.name || "",
        url: field === "url" ? value : prev[key]?.url || "",
      },
    }));
  };

  const addChild = (portal: PortalType, parentIndex: number) => {
    const key = getChildDraftKey(portal, parentIndex);
    const name = (childDrafts[key]?.name || "").trim();
    const url = normalizeMenuUrl(childDrafts[key]?.url || "");

    if (!name || !url) {
      showToast({
        tone: "warning",
        title: "하위 메뉴 입력을 확인해 주세요.",
        message: "하위 메뉴 이름과 URL을 모두 입력해야 합니다.",
      });
      return;
    }

    updatePortalMenus(portal, (menus) =>
      menus.map((item, idx) => {
        if (idx !== parentIndex) return item;
        return {
          ...item,
          children: [
            ...(item.children || []),
            {
              name,
              nameCustomized: true,
              url,
              hidden: false,
              ...(url === WEPLAY_STUDENT_URL
                ? { gameTitleCustomized: true }
                : {}),
            },
          ],
        };
      }),
    );

    setChildDrafts((prev) => ({
      ...prev,
      [key]: { name: "", url: "" },
    }));
  };

  const saveInterfaceConfig = async () => {
    if (loadError || loading || savingInterface) return;

    const instagramUrl = normalizeInstagramUrl(config.instagramUrl);
    if (config.instagramUrl.trim() && !instagramUrl) {
      showToast({
        tone: "warning",
        title: "공식 인스타그램 링크를 확인해주세요.",
        message:
          "인스타그램 계정명 또는 instagram.com 링크만 입력할 수 있습니다.",
      });
      return;
    }

    setSavingInterface(true);
    try {
      await setDoc(
        doc(db, "site_settings", "interface_config"),
        {
          dashboard: config.dashboard,
          footerText: config.footerText.trim(),
          instagramUrl,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setConfig((prev) => ({ ...prev, instagramUrl }));
      invalidateSiteSettingDocCache("interface_config");
      await refreshInterfaceConfig();
      showToast({
        tone: "success",
        title: "인터페이스 설정이 저장되었습니다.",
      });
    } catch (error: any) {
      console.error("Failed to save interface config:", error);
      showToast({
        tone: "error",
        title: "인터페이스 설정 저장에 실패했습니다.",
        message: error.message,
      });
    } finally {
      setSavingInterface(false);
    }
  };

  const saveMenuConfig = async () => {
    if (savingMenu || loading || loadError) return;
    setSavingMenu(true);
    try {
      const normalized = sanitizeMenuConfig(menuConfig);
      const baseline = loadedMenus.current;
      await runTransaction(db, async (transaction) => {
        const reference = doc(db, "site_settings", "menu_config");
        const snapshot = await transaction.get(reference);
        if (
          !baseline ||
          JSON.stringify(sanitizeMenuConfig(snapshot.data())) !==
            JSON.stringify(baseline)
        ) {
          throw new Error(
            "다른 곳에서 메뉴 설정이 바뀌었습니다. 새로고침 후 다시 수정해 주세요.",
          );
        }
        transaction.set(
          reference,
          { ...normalized, updatedAt: serverTimestamp() },
          { merge: true },
        );
        transaction.set(
          doc(db, "site_settings", "config"),
          {
            studentMenuVisibility: buildStudentMenuVisibility(normalized),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      });
      loadedMenus.current = normalized;
      setMenuConfig(normalized);
      invalidateSiteSettingDocCache("menu_config");
      invalidateSiteSettingDocCache("config");
      notifySystemConfigUpdated();
      notifyMenuConfigUpdated();
      showToast({
        tone: "success",
        title: "사이트맵 메뉴 설정이 저장되었습니다.",
        message: "학생과 교사 헤더에서 최신 메뉴를 사용할 수 있습니다.",
      });
    } catch (error: any) {
      console.error("Failed to save menu config:", error);
      showToast({
        tone: "error",
        title: "사이트맵 메뉴 저장에 실패했습니다.",
        message: error.message,
      });
    } finally {
      setSavingMenu(false);
    }
  };

  if (loading)
    return (
      <InlineLoading message="화면 설정을 불러오는 중입니다." showWarning />
    );

  if (loadError)
    return (
      <div role="alert" className="space-y-3">
        <p>화면 설정을 불러오지 못했습니다.</p>
        <button
          type="button"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          className="rounded-lg border border-gray-300 px-4 py-3 font-bold"
        >
          다시 시도
        </button>
      </div>
    );

  return (
    <div className="teacher-settings-interface">
      <div className="ws-page-tabs" role="tablist" aria-label="인터페이스 설정">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "landing"}
          onClick={() => setActiveTab("landing")}
        >
          대시보드
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "sitemap"}
          onClick={() => setActiveTab("sitemap")}
        >
          사이트맵 메뉴
        </button>
      </div>
      <div className="teacher-settings-interface-body">
        {activeTab === "landing" && (
          <div className="teacher-settings-panel-grid">
            <section className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">
                학생 대시보드
              </h3>
              <div className="divide-y divide-gray-100">
                {(
                  [
                    ["notice", "알림장"],
                    ["calendar", "주간 일정·출석 체크"],
                    ["ranking", "위스 순위"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex min-h-14 items-center justify-between gap-4 py-3 cursor-pointer"
                  >
                    <span className="font-medium text-gray-800">{label}</span>
                    <span className="flex items-center gap-2 shrink-0 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={config.dashboard[key]}
                        onChange={(event) =>
                          setConfig((previous) => ({
                            ...previous,
                            dashboard: {
                              ...previous.dashboard,
                              [key]: event.target.checked,
                            },
                          }))
                        }
                        className="h-5 w-5 accent-blue-600"
                      />
                      표시
                    </span>
                  </label>
                ))}
              </div>
            </section>
            <section className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">푸터</h3>
              <div className="space-y-5">
                <label className="block text-sm font-bold text-gray-700">
                  저작권 문구
                  <input
                    lang="ko"
                    inputMode="text"
                    type="text"
                    name="footerText"
                    value={config.footerText}
                    onChange={handleConfigChange}
                    placeholder="Copyright © 2026 ..."
                    className="mt-2 w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none font-normal"
                  />
                </label>
                <label className="block text-sm font-bold text-gray-700">
                  공식 인스타그램 링크
                  <input
                    type="text"
                    name="instagramUrl"
                    value={config.instagramUrl}
                    onChange={handleConfigChange}
                    placeholder="@westory"
                    className="mt-2 w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none font-normal"
                  />
                </label>
              </div>
            </section>
            <div className="teacher-settings-panel-save text-right pb-2">
              <button
                type="button"
                onClick={() => void saveInterfaceConfig()}
                disabled={savingInterface}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-3 px-6 rounded-lg"
              >
                {savingInterface ? "저장 중..." : "대시보드·푸터 저장"}
              </button>
            </div>
          </div>
        )}

        {activeTab === "sitemap" && (
          <div className="teacher-floating-action-space space-y-5 pb-24">
            <section>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-extrabold text-gray-900">
                    <i className="fas fa-sitemap text-blue-500"></i>
                    사이트맵 메뉴 관리
                  </h3>
                </div>
                <div
                  role="tablist"
                  aria-label="사이트맵 미리보기 대상"
                  className="teacher-settings-sitemap-tabs ws-page-tabs"
                >
                  {(["student", "teacher"] as PortalType[]).map((portal) => {
                    const stats = getPortalMenuStats(portal);
                    return (
                      <button
                        key={`sitemap-portal-tab-${portal}`}
                        type="button"
                        role="tab"
                        aria-selected={activePortal === portal}
                        onClick={() => setActivePortal(portal)}
                        className={`min-w-0 flex-1 rounded-lg px-4 py-2 text-sm font-bold transition ${
                          activePortal === portal
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-gray-600 hover:bg-white hover:text-gray-900"
                        }`}
                      >
                        {getPortalLabel(portal)}
                        <span
                          className={`ml-2 text-xs font-semibold ${
                            activePortal === portal
                              ? "text-blue-100"
                              : "text-gray-400"
                          }`}
                        >
                          {stats.parentCount}개
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <span className="text-gray-500">상위 메뉴</span>
                  <strong className="ml-2 text-gray-900">
                    {getPortalMenuStats(activePortal).parentCount}개
                  </strong>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <span className="text-gray-500">하위 메뉴</span>
                  <strong className="ml-2 text-gray-900">
                    {getPortalMenuStats(activePortal).childCount}개
                  </strong>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <span className="text-gray-500">숨김 메뉴</span>
                  <strong className="ml-2 text-gray-900">
                    {getPortalMenuStats(activePortal).hiddenCount}개
                  </strong>
                </div>
              </div>
            </section>

            <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-extrabold text-gray-900">
                    {getPortalLabel(activePortal)} 미리보기
                  </h4>
                </div>
                <span className="inline-flex w-fit items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-600">
                  상위 {getPortalMenuStats(activePortal).parentCount}개
                </span>
              </div>

              <div
                className="teacher-settings-sitemap-preview"
                style={
                  {
                    "--sitemap-columns": Math.max(
                      1,
                      menuConfig[activePortal].length,
                    ),
                  } as React.CSSProperties
                }
              >
                {menuConfig[activePortal].map((item, idx) => (
                  <div
                    key={`preview-${activePortal}-${item.url}-${idx}`}
                    className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
                  >
                    <div
                      className={`px-3 py-2.5 text-sm font-bold text-white ${getSitemapHeaderClass(idx)}`}
                    >
                      <span className={item.hidden ? "line-through" : ""}>
                        {item.name}
                      </span>
                    </div>
                    <div className="bg-white p-3">
                      {activePortal === "student" && (
                        <button
                          type="button"
                          aria-label={`${item.name} 전체 ${item.hidden ? "숨김 해제" : "숨기기"}`}
                          aria-pressed={item.hidden === true}
                          onClick={() => toggleParentHidden(activePortal, idx)}
                          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700"
                        >
                          {item.hidden ? "전체 숨김 해제" : "전체 숨기기"}
                        </button>
                      )}
                      {item.children && item.children.length > 0 ? (
                        <ul className="space-y-1.5">
                          {item.children.map((child, childIdx) => (
                            <li
                              key={`preview-child-${child.url}-${childIdx}`}
                              className="teacher-settings-sitemap-child flex items-center justify-between gap-2 border-b border-dashed border-gray-200 pb-1 text-sm"
                            >
                              <span
                                className={`min-w-0 flex-1 ${child.hidden || item.hidden ? "text-gray-400 line-through" : "text-gray-700"}`}
                              >
                                • {child.name}
                              </span>
                              {activePortal === "student" && (
                                <button
                                  type="button"
                                  aria-label={`${child.name} ${child.hidden ? "숨김 해제" : "숨기기"}`}
                                  aria-pressed={child.hidden}
                                  onClick={() =>
                                    toggleChildHidden(
                                      activePortal,
                                      idx,
                                      childIdx,
                                    )
                                  }
                                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${child.hidden ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"}`}
                                >
                                  {child.hidden ? "숨김 해제" : "숨기기"}
                                </button>
                              )}
                              {activePortal !== "student" && child.hidden && (
                                <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                                  숨김
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-gray-400">하위 메뉴 없음</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-extrabold text-gray-900">
                    상위 메뉴 추가
                  </h4>
                </div>
                <span className="inline-flex w-fit items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-600">
                  {getPortalLabel(activePortal)}
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-2">
                <input
                  lang="ko"
                  inputMode="text"
                  type="text"
                  value={parentDraft[activePortal].name}
                  onChange={(e) =>
                    updateParentDraft(activePortal, "name", e.target.value)
                  }
                  placeholder="상위 메뉴 이름"
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <input
                  type="text"
                  value={parentDraft[activePortal].url}
                  onChange={(e) =>
                    updateParentDraft(activePortal, "url", e.target.value)
                  }
                  placeholder="/teacher/custom-page"
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => addParent(activePortal)}
                  className="px-4 py-2.5 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white"
                >
                  상위 추가
                </button>
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-extrabold text-gray-900">
                    {getPortalLabel(activePortal)} 메뉴 편집
                  </h4>
                </div>
                <span className="inline-flex w-fit items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-600">
                  상위 {getPortalMenuStats(activePortal).parentCount}개
                </span>
              </div>
              {menuConfig[activePortal].map((item, parentIndex) => (
                <div
                  key={`${activePortal}-${item.url}-${parentIndex}`}
                  className="border border-gray-200 rounded-xl overflow-hidden"
                >
                  <div className="p-4 bg-gray-50 border-b border-gray-200">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-700 text-white text-xs font-bold">
                        {parentIndex + 1}
                      </span>
                      <span className="text-xs font-semibold text-gray-500">
                        상위 메뉴
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          moveParent(activePortal, parentIndex, -1)
                        }
                        disabled={parentIndex === 0}
                        className="ml-auto px-2.5 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600 disabled:opacity-40"
                      >
                        위로
                      </button>
                      <button
                        type="button"
                        onClick={() => moveParent(activePortal, parentIndex, 1)}
                        disabled={
                          parentIndex === menuConfig[activePortal].length - 1
                        }
                        className="px-2.5 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600 disabled:opacity-40"
                      >
                        아래로
                      </button>
                      {activePortal === "student" && (
                        <button
                          type="button"
                          aria-pressed={item.hidden === true}
                          onClick={() =>
                            toggleParentHidden(activePortal, parentIndex)
                          }
                          className="px-3 py-2 text-xs rounded-md border border-gray-300 text-gray-700"
                        >
                          {item.hidden ? "전체 숨김 해제" : "전체 숨기기"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteParent(activePortal, parentIndex)}
                        className="px-2.5 py-1.5 text-xs rounded-md border border-red-200 text-red-500"
                      >
                        삭제
                      </button>
                    </div>
                    <input
                      lang="ko"
                      inputMode="text"
                      type="text"
                      value={item.name}
                      onChange={(e) =>
                        updateParentName(
                          activePortal,
                          parentIndex,
                          e.target.value,
                        )
                      }
                      className="w-full border border-gray-300 rounded-lg p-2.5 font-bold text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <p className="text-xs text-gray-500 mt-2 break-all">
                      URL: {item.url}
                    </p>
                  </div>

                  <div className="p-4 space-y-3 bg-white">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-2">
                      <input
                        lang="ko"
                        inputMode="text"
                        type="text"
                        value={
                          childDrafts[
                            getChildDraftKey(activePortal, parentIndex)
                          ]?.name || ""
                        }
                        onChange={(e) =>
                          updateChildDraft(
                            activePortal,
                            parentIndex,
                            "name",
                            e.target.value,
                          )
                        }
                        placeholder="하위 메뉴 이름"
                        className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <input
                        type="text"
                        value={
                          childDrafts[
                            getChildDraftKey(activePortal, parentIndex)
                          ]?.url || ""
                        }
                        onChange={(e) =>
                          updateChildDraft(
                            activePortal,
                            parentIndex,
                            "url",
                            e.target.value,
                          )
                        }
                        placeholder="/teacher/custom-page?tab=1"
                        className="w-full border border-gray-300 rounded-lg p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => addChild(activePortal, parentIndex)}
                        className="px-3 py-2 rounded-lg text-sm font-bold bg-sky-600 hover:bg-sky-700 text-white"
                      >
                        하위 추가
                      </button>
                    </div>

                    {item.children && item.children.length > 0 ? (
                      item.children.map((child, childIndex) => (
                        <div
                          key={`${child.url}-${childIndex}`}
                          className="rounded-lg border border-gray-200 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                              하위 {childIndex + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                moveChild(
                                  activePortal,
                                  parentIndex,
                                  childIndex,
                                  -1,
                                )
                              }
                              disabled={childIndex === 0}
                              className="ml-auto px-2 py-1 text-[11px] rounded border border-gray-300 text-gray-600 disabled:opacity-40"
                            >
                              위로
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                moveChild(
                                  activePortal,
                                  parentIndex,
                                  childIndex,
                                  1,
                                )
                              }
                              disabled={
                                childIndex === item.children!.length - 1
                              }
                              className="px-2 py-1 text-[11px] rounded border border-gray-300 text-gray-600 disabled:opacity-40"
                            >
                              아래로
                            </button>
                            {activePortal === "student" && (
                              <button
                                type="button"
                                onClick={() =>
                                  toggleChildHidden(
                                    activePortal,
                                    parentIndex,
                                    childIndex,
                                  )
                                }
                                className={`px-2 py-1 text-[11px] rounded border ${child.hidden ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-amber-300 text-amber-700 bg-amber-50"}`}
                              >
                                {child.hidden ? "숨김 해제" : "숨기기"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                deleteChild(
                                  activePortal,
                                  parentIndex,
                                  childIndex,
                                )
                              }
                              className="px-2 py-1 text-[11px] rounded border border-red-200 text-red-500"
                            >
                              삭제
                            </button>
                          </div>
                          <input
                            lang="ko"
                            inputMode="text"
                            type="text"
                            value={child.name}
                            onChange={(e) =>
                              updateChildName(
                                activePortal,
                                parentIndex,
                                childIndex,
                                e.target.value,
                              )
                            }
                            className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                          <p className="text-[11px] text-gray-500 mt-2 break-all">
                            URL: {child.url}
                          </p>
                          {activePortal === "student" && child.hidden && (
                            <p className="text-[11px] text-amber-700 mt-1">
                              학생 대시보드에서 숨김 처리됨
                            </p>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-gray-400 py-2">
                        하위 메뉴가 없습니다.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="teacher-floating-action-above-patch fixed bottom-4 left-4 right-4 z-40 flex justify-end sm:bottom-6 sm:left-auto sm:right-6">
              <button
                type="button"
                onClick={() => void saveMenuConfig()}
                disabled={savingMenu}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-3 px-8 rounded-xl shadow-xl transition sm:w-auto"
              >
                <i className="fas fa-save mr-2"></i>
                {savingMenu ? "저장 중..." : "사이트맵 저장"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsInterface;
