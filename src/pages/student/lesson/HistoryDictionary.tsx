import StudentHistoryDictionaryWorkspace from "../../../components/common/StudentHistoryDictionaryWorkspace";

export default function HistoryDictionary() {
  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50 px-4 py-6 lg:px-6 xl:px-8">
      <main className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">
          위스토리 사전
        </h1>
        <StudentHistoryDictionaryWorkspace />
      </main>
    </div>
  );
}
