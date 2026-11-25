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
const SITEMAP_ICONS = {
  previous: "m14 6-6 6 6 6",
  next: "m10 6 6 6-6 6",
  up: "m6 14 6-6 6 6",
  down: "m6 10 6 6 6-6",
  edit: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4",
  shown:
    "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm6.5 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z",
  hidden:
    "M4 4l16 16M9.9 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.7M6.2 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9M9.9 9.9a3 3 0 0 0 4.2 4.2",
  remove: "M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
};

const SitemapIconButton: React.FC<{
  icon: keyof typeof SITEMAP_ICONS;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  expanded?: boolean;
  tone?: "danger" | "hidden";
}> = ({ icon, label, onClick, disabled, expanded, tone }) => (
  <button
    type="button"
    className={`teacher-sitemap-icon${tone ? ` teacher-sitemap-icon--${tone}` : ""}`}
    aria-label={label}
    title={label}
    aria-expanded={expanded}
    disabled={disabled}
    onClick={onClick}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={SITEMAP_ICONS[icon]} />
    </svg>
  </button>
);

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
  const [editingMenu, setEditingMenu] = useState<string | null>(null);

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
    `${portal}-${menuConfig[portal][parentIndex]?.url || parentIndex}`;

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
    const normalized = sanitizeMenuConfig(menuConfig);
    if (
      loadedMenus.current &&
      JSON.stringify(normalized) ===
        JSON.stringify(sanitizeMenuConfig(loadedMenus.current))
    )
      return;
    setSavingMenu(true);
    try {
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

  const menuStats = getPortalMenuStats(activePortal);

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
          <div className="teacher-floating-action-space teacher-sitemap">
            <div
              role="tablist"
              aria-label="사이트맵 대상"
              className="ws-page-tabs"
            >
              {(["student", "teacher"] as PortalType[]).map((portal) => (
                <button
                  key={`sitemap-portal-tab-${portal}`}
                  type="button"
                  role="tab"
                  aria-selected={activePortal === portal}
                  onClick={() => setActivePortal(portal)}
                >
                  {getPortalLabel(portal)}
                </button>
              ))}
            </div>
            <p className="teacher-sitemap-summary">
              <span>상위 메뉴 {menuStats.parentCount}개</span>
              <span>하위 메뉴 {menuStats.childCount}개</span>
              {activePortal === "student" && (
                <span>숨김 {menuStats.hiddenCount}개</span>
              )}
            </p>

            <ul className="teacher-sitemap-grid">
              {menuConfig[activePortal].map((item, parentIndex) => {
                const editKey = getChildDraftKey(activePortal, parentIndex);
                const editing = editingMenu === editKey;
                const children = item.children || [];
                return (
                  <li
                    key={`${activePortal}-${item.url}`}
                    className="teacher-sitemap-menu"
                    data-hidden={item.hidden || undefined}
                  >
                    <div className="teacher-sitemap-row teacher-sitemap-row--head">
                      <h4 className="teacher-sitemap-name">
                        {item.name}
                        {item.hidden && (
                          <span className="teacher-sitemap-badge">숨김</span>
                        )}
                      </h4>
                      <div className="teacher-sitemap-actions">
                        <SitemapIconButton
                          icon="edit"
                          label={`${item.name} 편집`}
                          expanded={editing}
                          onClick={() =>
                            setEditingMenu(editing ? null : editKey)
                          }
                        />
                        {activePortal === "student" && (
                          <SitemapIconButton
                            icon={item.hidden ? "hidden" : "shown"}
                            tone={item.hidden ? "hidden" : undefined}
                            label={`${item.name} 전체 ${item.hidden ? "숨김 해제" : "숨기기"}`}
                            onClick={() =>
                              toggleParentHidden(activePortal, parentIndex)
                            }
                          />
                        )}
                        <SitemapIconButton
                          icon="previous"
                          label={`${item.name} 상위 메뉴 앞으로`}
                          disabled={parentIndex === 0}
                          onClick={() =>
                            moveParent(activePortal, parentIndex, -1)
                          }
                        />
                        <SitemapIconButton
                          icon="next"
                          label={`${item.name} 상위 메뉴 뒤로`}
                          disabled={
                            parentIndex === menuConfig[activePortal].length - 1
                          }
                          onClick={() =>
                            moveParent(activePortal, parentIndex, 1)
                          }
                        />
                      </div>
                    </div>

                    {editing && (
                      <div className="teacher-sitemap-edit">
                        <label className="teacher-sitemap-field">
                          상위 메뉴 이름
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
                          />
                        </label>
                        <p className="teacher-sitemap-url">{item.url}</p>
                      </div>
                    )}

                    {children.length > 0 ? (
                      <ul>
                        {children.map((child, childIndex) => (
                          <li
                            key={child.url}
                            className="teacher-sitemap-row"
                            data-hidden={
                              child.hidden || item.hidden || undefined
                            }
                          >
                            {editing ? (
                              <div className="teacher-sitemap-child-edit">
                                <input
                                  lang="ko"
                                  inputMode="text"
                                  type="text"
                                  aria-label={`하위 메뉴 이름 ${childIndex + 1}`}
                                  value={child.name}
                                  onChange={(e) =>
                                    updateChildName(
                                      activePortal,
                                      parentIndex,
                                      childIndex,
                                      e.target.value,
                                    )
                                  }
                                />
                                <p className="teacher-sitemap-url">
                                  {child.url}
                                </p>
                              </div>
                            ) : (
                              <span className="teacher-sitemap-name">
                                {child.name}
                                {child.hidden && (
                                  <span className="teacher-sitemap-badge">
                                    숨김
                                  </span>
                                )}
                              </span>
                            )}
                            <div className="teacher-sitemap-actions">
                              {editing && (
                                <SitemapIconButton
                                  icon="remove"
                                  tone="danger"
                                  label={`${child.name} 하위 메뉴 삭제`}
                                  onClick={() =>
                                    deleteChild(
                                      activePortal,
                                      parentIndex,
                                      childIndex,
                                    )
                                  }
                                />
                              )}
                              {activePortal === "student" && (
                                <SitemapIconButton
                                  icon={child.hidden ? "hidden" : "shown"}
                                  tone={child.hidden ? "hidden" : undefined}
                                  label={`${child.name} ${child.hidden ? "숨김 해제" : "숨기기"}`}
                                  onClick={() =>
                                    toggleChildHidden(
                                      activePortal,
                                      parentIndex,
                                      childIndex,
                                    )
                                  }
                                />
                              )}
                              <SitemapIconButton
                                icon="up"
                                label={`${child.name} 하위 메뉴 위로`}
                                disabled={childIndex === 0}
                                onClick={() =>
                                  moveChild(
                                    activePortal,
                                    parentIndex,
                                    childIndex,
                                    -1,
                                  )
                                }
                              />
                              <SitemapIconButton
                                icon="down"
                                label={`${child.name} 하위 메뉴 아래로`}
                                disabled={childIndex === children.length - 1}
                                onClick={() =>
                                  moveChild(
                                    activePortal,
                                    parentIndex,
                                    childIndex,
                                    1,
                                  )
                                }
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="teacher-sitemap-empty">하위 메뉴 없음</p>
                    )}

                    {editing && (
                      <div className="teacher-sitemap-edit">
                        <label className="teacher-sitemap-field">
                          추가할 하위 메뉴 이름
                          <input
                            lang="ko"
                            inputMode="text"
                            type="text"
                            value={childDrafts[editKey]?.name || ""}
                            onChange={(e) =>
                              updateChildDraft(
                                activePortal,
                                parentIndex,
                                "name",
                                e.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="teacher-sitemap-field">
                          주소
                          <input
                            type="text"
                            value={childDrafts[editKey]?.url || ""}
                            onChange={(e) =>
                              updateChildDraft(
                                activePortal,
                                parentIndex,
                                "url",
                                e.target.value,
                              )
                            }
                            placeholder={`/${activePortal}/custom-page?tab=1`}
                          />
                        </label>
                        <div className="teacher-sitemap-edit-actions">
                          <button
                            type="button"
                            className="teacher-sitemap-button teacher-sitemap-button--danger"
                            onClick={() => {
                              setEditingMenu(null);
                              deleteParent(activePortal, parentIndex);
                            }}
                          >
                            상위 메뉴 삭제
                          </button>
                          <button
                            type="button"
                            className="teacher-sitemap-button"
                            onClick={() => addChild(activePortal, parentIndex)}
                          >
                            하위 추가
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <section className="teacher-sitemap-add">
              <h4>상위 메뉴 추가</h4>
              <div>
                <label className="teacher-sitemap-field">
                  이름
                  <input
                    lang="ko"
                    inputMode="text"
                    type="text"
                    value={parentDraft[activePortal].name}
                    onChange={(e) =>
                      updateParentDraft(activePortal, "name", e.target.value)
                    }
                  />
                </label>
                <label className="teacher-sitemap-field">
                  주소
                  <input
                    type="text"
                    value={parentDraft[activePortal].url}
                    onChange={(e) =>
                      updateParentDraft(activePortal, "url", e.target.value)
                    }
                    placeholder={`/${activePortal}/custom-page`}
                  />
                </label>
                <button
                  type="button"
                  className="teacher-sitemap-button"
                  onClick={() => addParent(activePortal)}
                >
                  상위 추가
                </button>
              </div>
            </section>

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
