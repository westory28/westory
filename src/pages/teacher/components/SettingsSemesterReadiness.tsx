import React from "react";
import type { SemesterReadinessResult } from "../../../lib/semesterReadiness";

type ReadinessItem = SemesterReadinessResult["requiredItems"][number];

const ITEM_GUIDANCE: Record<
  ReadinessItem["key"],
  { available: string; action: string }
> = {
  curriculumTree: {
    available: "단원·차시와 수업자료 연결 기준을 확인하세요.",
    action: "수업자료에서 교육과정의 단원·차시를 먼저 등록하세요.",
  },
  assessmentSettings: {
    available: "평가 기본 설정이 학기 운영 계획과 맞는지 확인하세요.",
    action: "평가 설정에서 학기의 기본 평가 기준을 입력하세요.",
  },
  finalExam: {
    available: "기본 틀 외에 실제 문항과 배점도 확인하세요.",
    action: "시험 구성에서 객관식 또는 서술형 문항 구성을 준비하세요.",
  },
  gradingPlans: {
    available: "채점 기준과 점수 운영 계획을 확인하세요.",
    action: "채점 계획을 등록하고 평가별 기준을 확인하세요.",
  },
  calendar: {
    available: "실제 학사 일정과 평가 일정이 등록되어 있는지 확인하세요.",
    action: "학사 일정에 학기 운영에 필요한 일정을 등록하세요.",
  },
  notices: {
    available: "학생에게 전달할 첫 안내가 준비되어 있는지 확인하세요.",
    action: "공지에 학기 시작 안내를 등록하세요.",
  },
  pointProducts: {
    available: "위스 상품의 이용 조건과 운영 계획을 확인하세요.",
    action: "위스 관리에서 사용할 상품을 등록하세요.",
  },
  quizQuestions: {
    available: "수업에 사용할 문항과 교육과정 연결을 확인하세요.",
    action: "퀴즈를 운영한다면 문제은행에 필요한 문항을 등록하세요.",
  },
  historyClassrooms: {
    available: "학기에 사용할 활동 자료를 확인하세요.",
    action: "활동을 운영한다면 히스토리 클래스룸 자료를 등록하세요.",
  },
  mapResources: {
    available: "수업에 사용할 지도 자료를 확인하세요.",
    action: "지도 수업을 운영한다면 필요한 자료를 등록하세요.",
  },
};

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
          className={`ml-3 text-xs font-bold ${missing.length ? "text-amber-800" : "text-gray-500"}`}
        >
          {missing.length
            ? `${advisory ? "추가 준비" : "확인 필요"} ${missing.length}건`
            : "기본 항목 모두 확인됨"}
        </span>
        <span className="mt-2 block pl-6 text-xs leading-5 text-gray-500">
          {missing.length
            ? missing.map((item) => item.label).join(" · ")
            : `${items.length}개 항목의 세부 내용을 확인할 수 있습니다.`}
        </span>
      </summary>
      <div className="px-4 pb-4">
        <p className="mb-3 text-xs leading-5 text-gray-500">
          {advisory
            ? "운영할 활동에 해당하는 자료를 준비하세요."
            : "확인이 필요한 항목부터 표시합니다. 기본 설정이 있어도 실제 내용은 관리자가 확인해야 합니다."}
        </p>
        <ul className="divide-y divide-gray-200 border-y border-gray-200">
          {ordered.map((item) => (
            <li
              key={item.key}
              className={`py-3 ${item.ready ? "" : "bg-amber-50 px-3"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-gray-800">
                  {item.label}
                </span>
                <span
                  className={`text-xs font-bold ${item.ready ? "text-gray-500" : "text-amber-800"}`}
                >
                  {item.ready
                    ? "기본 항목 있음"
                    : advisory
                      ? "추가 준비"
                      : "확인 필요"}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-gray-600">
                {item.ready
                  ? ITEM_GUIDANCE[item.key].available
                  : ITEM_GUIDANCE[item.key].action}
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
              className={`rounded-full px-3 py-1 text-xs font-bold ${readiness.status === "danger" ? "bg-red-50 text-red-700" : readiness.status === "partial" ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-900"}`}
            >
              {readiness.status === "danger"
                ? "전환 비권장"
                : readiness.status === "partial"
                  ? "일부 확인 필요"
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
                ? missingRequired.length
                  ? `필수 확인 ${missingRequired.length}건 · ${missingRequired.map((item) => item.label).join(", ")}`
                  : "필수 항목의 기본 설정이 있습니다. 전환 전 실제 운영 내용을 확인하세요."
                : "학기를 선택하면 준비 현황을 확인할 수 있습니다."}
        </p>
      </div>
      {!loading && readiness && !error && (
        <>
          <ReadinessGroup
            title="필수 운영 항목"
            items={readiness.requiredItems}
          />
          <ReadinessGroup
            title="선택 운영 자료"
            items={readiness.advisoryItems}
            advisory
          />
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
