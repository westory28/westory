import StudentHistoryDictionaryWorkspace from "../../../components/common/StudentHistoryDictionaryWorkspace";

export default function HistoryDictionary() {
  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50">
      <main className="ws-page ws-page--reading">
        <header className="ws-page-header mb-4">
          <h1>위스토리 사전</h1>
        </header>
        <StudentHistoryDictionaryWorkspace />
      </main>
    </div>
  );
}
