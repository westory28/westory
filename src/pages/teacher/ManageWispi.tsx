import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { canManagePoints, canReadPoints } from "../../lib/permissions";
import { isSemesterArchive } from "../../lib/semesterArchive";
import TeacherWisStocks, {
  TEACHER_WISPI_TABS,
  type TeacherWispiTab,
} from "./components/points/TeacherWisStocks";

const isTab = (value: string | null): value is TeacherWispiTab =>
  TEACHER_WISPI_TABS.some((tab) => tab.key === value);

/** WsPI is its own top-level menu; each submenu is a `?tab=` of this page. */
export default function ManageWispi() {
  const { config, configReady, currentUser, userData } = useAuth();
  const [params, setParams] = useSearchParams();
  const canRead = canReadPoints(userData, currentUser?.email);
  const canManage =
    !isSemesterArchive && canManagePoints(userData, currentUser?.email);
  const requested = params.get("tab");
  const tab: TeacherWispiTab =
    isTab(requested) &&
    (requested !== "reports" || userData?.role === "teacher")
      ? requested
      : "stocks";
  const scopeReady = Boolean(
    currentUser && configReady && config?.year && config?.semester,
  );
  if (!canRead)
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <main className="ws-page flex-1">
          <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-5 text-sm font-bold text-red-700">
            위스피 관리 화면을 볼 권한이 없습니다.
          </div>
        </main>
      </div>
    );
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main className="ws-page flex flex-1 flex-col">
        <div className="min-w-0">
          {!canManage && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
              읽기 전용 권한으로 접속 중입니다.
            </div>
          )}
          {scopeReady && config && (
            <TeacherWisStocks
              config={config}
              canManage={canManage}
              tab={tab}
              onTabChange={(next) => {
                const search = new URLSearchParams();
                if (next !== "stocks") search.set("tab", next);
                setParams(search);
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
