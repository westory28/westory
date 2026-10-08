import React from "react";
import type { SemesterReadinessResult } from "../../../lib/semesterReadiness";

type ReadinessItem = SemesterReadinessResult["requiredItems"][number];

const ReadinessGroup: React.FC<{
  title: string;
  items: ReadinessItem[];
  advisory?: boolean;
}> = ({ title, items, advisory = false }) => {
  const missing = items.filter((item) => !item.ready);
  const ordered = [...missing, ...items.filter((item) => item.ready)];

  return (
    <details className="group border-t border-gray-200">
      <summary className="cursor-pointer px-4 py-4 text-sm text-gray-800 focus-visible:outline-blue-600">
        <span className="ml-2 font-bold">{title}</span>
        <span
          className={`ml-3 text-xs font-bold ${missing.length && !advisory ? "text-amber-800" : "text-gray-500"}`}
        >
          {missing.length
            ? `${advisory ? "참고" : "확인 필요"} ${missing.length}건`
            : "기본 항목 모두 확인됨"}
        </span>
        <span className="mt-2 block pl-6 text-xs leading-5 text-gray-500">
          {missing.length
            ? missing.map((item) => item.label).join(" · ")
            : `${items.length}개 항목의 세부 내용을 확인할 수 있습니다.`}
        </span>
      </summary>
      <div className="px-4 pb-4">
        <ul className="divide-y divide-gray-200 border-y border-gray-200">
          {ordered.map((item) => (
            <li
              key={item.key}
              className={`py-3 ${item.ready || advisory ? "" : "bg-amber-50 px-3"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-gray-800">
                  {item.label}
                </span>
                <span
                  className={`text-xs font-bold ${item.ready || advisory ? "text-gray-500" : "text-amber-800"}`}
                >
                  {item.ready ? "검증 완료" : advisory ? "참고" : "확인 필요"}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-gray-600">
                {item.detail}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
};

const SettingsSemesterReadiness: React.FC<{
  readiness: SemesterReadinessResult | null;
  loading: boolean;
  error: string;
  semesterLabel: string;
  showTransitionImpact?: boolean;
}> = ({
  readiness,
  loading,
  error,
  semesterLabel,
  showTransitionImpact = true,
}) => {
  const missingRequired =
    readiness?.requiredItems.filter((item) => !item.ready) || [];

  return (
    <div>
      <div className="px-4 pb-4" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold text-gray-800">
            {semesterLabel}
          </span>
          {!loading && readiness && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${readiness.status === "danger" ? "bg-red-50 text-red-700" : readiness.status === "partial" ? "bg-amber-50 text-amber-800" : readiness.status === "reference" ? "bg-gray-100 text-gray-700" : "bg-blue-50 text-blue-900"}`}
            >
              {readiness.status === "danger"
                ? "전환 비권장"
                : readiness.status === "partial"
                  ? "일부 확인 필요"
                  : readiness.status === "reference"
                    ? "참고"
                    : "기본 전환 기준 충족"}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          {loading
            ? "준비 현황을 확인하고 있습니다."
            : error
              ? error
              : readiness
                ? readiness.status === "reference"
                  ? "개시 전 검증 기록 이후 운영 자료가 변경되었습니다."
                  : missingRequired.length
                    ? `필수 확인 ${missingRequired.length}건 · ${missingRequired.map((item) => item.label).join(", ")}`
                    : "필수 운영 항목 검증이 완료되었습니다."
                : "학기를 선택하면 준비 현황을 확인할 수 있습니다."}
        </p>
      </div>
      {!loading && readiness && !error && (
        <>
          {readiness.requiredItems.length > 0 && (
            <ReadinessGroup
              title="필수 운영 항목"
              items={readiness.requiredItems}
            />
          )}
          {readiness.advisoryItems.length > 0 && (
            <ReadinessGroup
              title={
                readiness.status === "reference"
                  ? "검증 기록"
                  : "선택 운영 자료"
              }
              items={readiness.advisoryItems}
              advisory
            />
          )}
        </>
      )}
      {showTransitionImpact && (
        <details className="border-t border-gray-200">
          <summary className="cursor-pointer px-4 py-4 text-sm font-bold text-gray-800 focus-visible:outline-blue-600">
            <span className="ml-2">전환 시 달라지는 점</span>
            <span className="mt-2 block pl-6 text-xs font-normal text-gray-500">
              적용 대상 · 데이터 보존 · 새 학기 준비 범위
            </span>
          </summary>
          <dl className="space-y-4 px-4 pb-4 text-sm">
            <div>
              <dt className="font-bold text-gray-800">
                학생·교사에게 함께 적용
              </dt>
              <dd className="mt-1 leading-6 text-gray-600">
                운영 학기를 전환하면 학생과 교사 화면이 선택한 학기의 데이터를
                기준으로 표시됩니다.
              </dd>
            </div>
            <div>
              <dt className="font-bold text-gray-800">이전 데이터 보존</dt>
              <dd className="mt-1 leading-6 text-gray-600">
                전환만으로 이전 학기 데이터를 삭제하거나 새 학기로 복사하지
                않습니다. 이전 학기 현황 조회는 운영 학기와 별도로 선택합니다.
              </dd>
            </div>
            <div>
              <dt className="font-bold text-gray-800">
                학기 생성 후 내용 준비
              </dt>
              <dd className="mt-1 leading-6 text-gray-600">
                학기 생성은 기본 설정만 준비합니다. 교육과정, 수업자료, 실제
                평가 내용은 별도로 확인해야 합니다.
              </dd>
            </div>
          </dl>
        </details>
      )}
    </div>
  );
};

export default SettingsSemesterReadiness;
