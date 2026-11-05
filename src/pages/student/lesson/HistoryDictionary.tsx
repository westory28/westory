import { getStudentMenuLabel } from "../../../constants/menus";
import StudentHistoryDictionaryWorkspace from "../../../components/common/StudentHistoryDictionaryWorkspace";
import { useAuth } from "../../../contexts/AuthContext";

export default function HistoryDictionary() {
  const { menuConfig } = useAuth();
  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50">
      <main className="ws-page ws-page--reading">
        <header className="ws-page-header mb-4">
          <h1>
            {getStudentMenuLabel(
              menuConfig,
              "/student/lesson/history-dictionary",
              "역사 사전",
            )}
          </h1>
        </header>
        <StudentHistoryDictionaryWorkspace />
      </main>
    </div>
  );
}
