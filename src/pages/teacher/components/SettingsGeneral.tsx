import React, { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { InlineLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { notifySystemConfigUpdated } from "../../../lib/appEvents";
import { executeWestoryCommand } from "../../../lib/commandGateway";
import { db } from "../../../lib/firebase";
import { invalidateSiteSettingDocCache } from "../../../lib/siteSettings";
import SemesterCorePanel from "./SemesterCorePanel";

type OperationalSettings = {
  showQuiz: boolean;
  showScore: boolean;
  showLesson: boolean;
};

const DEFAULT_SETTINGS: OperationalSettings = {
  showQuiz: true,
  showScore: true,
  showLesson: true,
};

const MENU_OPTIONS: Array<{
  key: keyof OperationalSettings;
  label: string;
  icon: string;
  iconClass: string;
}> = [
  {
    key: "showQuiz",
    label: "평가(Quiz)",
    icon: "fas fa-gamepad",
    iconClass: "bg-blue-100 text-blue-700",
  },
  {
    key: "showScore",
    label: "점수(Score)",
    icon: "fas fa-chart-bar",
    iconClass: "bg-emerald-100 text-emerald-700",
  },
  {
    key: "showLesson",
    label: "수업자료(Lesson)",
    icon: "fas fa-book-reader",
    iconClass: "bg-amber-100 text-amber-800",
  },
];

const SettingsGeneral: React.FC = () => {
  const { refreshConfig } = useAuth();
  const { showToast } = useAppToast();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    void getDoc(doc(db, "site_settings", "config"))
      .then((snapshot) => {
        if (!mounted || !snapshot.exists()) return;
        const data = snapshot.data();
        setSettings({
          showQuiz: data.showQuiz !== false,
          showScore: data.showScore !== false,
          showLesson: data.showLesson !== false,
        });
      })
      .catch((error) => {
        console.error("Failed to load operational settings:", error);
        showToast({
          tone: "error",
          title: "운영 설정을 불러오지 못했습니다.",
          message: "잠시 후 다시 시도해 주세요.",
        });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [showToast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await executeWestoryCommand("updateOperationalSettings", settings);
      invalidateSiteSettingDocCache("config");
      await refreshConfig();
      notifySystemConfigUpdated();
      showToast({
        tone: "success",
        title: "운영 설정을 저장했습니다.",
        message: "학생 메뉴 표시 기준에 최신 설정을 반영했습니다.",
      });
    } catch (error) {
      console.error("Failed to save operational settings:", error);
      showToast({
        tone: "error",
        title: "운영 설정 저장에 실패했습니다.",
        message: String(
          (error as { message?: unknown })?.message ||
            "서버가 요청을 처리하지 못했습니다.",
        ),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <InlineLoading message="기본 설정을 불러오는 중입니다." showWarning />
    );
  }

  return (
    <div className="max-w-6xl space-y-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
      <div className="border-b border-gray-100 pb-4">
        <h3 className="text-lg font-bold text-gray-900">시스템 기본 설정</h3>
        <p className="mt-1 text-sm leading-6 text-gray-500">
          활성 학기와 준비 상태를 확인하고 학생 메뉴 표시 여부를 제어합니다.
        </p>
      </div>

      <SemesterCorePanel />

      <section
        className="border-t border-gray-100 pt-6"
        aria-labelledby="student-menu-settings-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h4
              id="student-menu-settings-title"
              className="text-base font-extrabold text-gray-900"
            >
              학생 메뉴 표시 제어
            </h4>
            <p className="mt-1 text-sm text-gray-500">
              이 설정은 학기 활성화와 별도로 저장되며 활성 pointer를 바꾸지
              않습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="self-start rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
          >
            {saving ? "저장 중..." : "운영 설정 저장"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {MENU_OPTIONS.map((option) => (
            <label
              key={option.key}
              className="flex cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4 transition hover:bg-gray-100"
            >
              <span className="flex items-center gap-3">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${option.iconClass}`}
                >
                  <i className={option.icon} aria-hidden="true" />
                </span>
                <span className="font-bold text-gray-700">{option.label}</span>
              </span>
              <input
                type="checkbox"
                checked={settings[option.key]}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    [option.key]: event.target.checked,
                  }))
                }
                className="h-5 w-5 rounded text-blue-600 focus:ring-blue-500"
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
};

export default SettingsGeneral;
