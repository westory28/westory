import { useEffect, useState, type ReactNode } from "react";
import { DRAFT_SOURCES, type DraftSourceId } from "./gongsinmoongoDraftData";
import {
  GONGSIN_RESTRICTION_DURATIONS,
  formatGongsinRestrictionTime,
  normalizeGongsinmoongoSettings,
  sameGongsinmoongoSettings,
  type GongsinmoongoSettings,
} from "./gongsinmoongoSettings";
import "./gongsinAdminSettings.css";

export type GongsinSettingsTab =
  | "general"
  | "notifications"
  | "warning"
  | "sources"
  | "students";

export interface GongsinRestrictionStudent {
  studentId: string;
  label: string;
  restriction?: { until: number; reason: string };
}

interface GongsinAdminSettingsProps {
  settings: GongsinmoongoSettings;
  onSave: (settings: GongsinmoongoSettings) => void;
  students: GongsinRestrictionStudent[];
  onApplyRestriction: (
    studentId: string,
    until: number,
    reason: string,
  ) => void;
  onReleaseRestriction: (studentId: string) => void;
  initialTab?: GongsinSettingsTab;
  initialStudentId?: string;
  navigationRequestId?: number;
}

const TABS: Array<[GongsinSettingsTab, string]> = [
  ["general", "기본"],
  ["notifications", "알림"],
  ["warning", "이용안내"],
  ["sources", "학습연결"],
  ["students", "학생제한"],
];
const SOURCE_ORDER: DraftSourceId[] = [
  "lesson",
  "dictionary",
  "formative",
  "diagnostic",
  "mock",
];

function SettingToggle({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <label className="gongsin-settings-toggle">
      <span>
        <strong>{label}</strong>
        {children && <small>{children}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export default function GongsinAdminSettings({
  settings,
  onSave,
  students,
  onApplyRestriction,
  onReleaseRestriction,
  initialTab = "general",
  initialStudentId,
  navigationRequestId,
}: GongsinAdminSettingsProps) {
  const [tab, setTab] = useState<GongsinSettingsTab>(initialTab);
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, navigationRequestId]);
  const dirty = !sameGongsinmoongoSettings(draft, settings);
  const canReset = JSON.stringify(draft) !== JSON.stringify(settings);
  const missingWarning =
    draft.warning.enabled &&
    (!draft.warning.title.trim() || !draft.warning.body.trim());
  const update = (next: Partial<GongsinmoongoSettings>) =>
    setDraft((value) => ({ ...value, ...next }));
  const save = () => {
    if (!dirty || missingWarning) return;
    const next = normalizeGongsinmoongoSettings(draft);
    const warningChanged =
      next.warning.enabled !== settings.warning.enabled ||
      next.warning.title !== settings.warning.title ||
      next.warning.body !== settings.warning.body;
    next.warning.revision =
      settings.warning.revision + (warningChanged ? 1 : 0);
    onSave(next);
  };
  return (
    <section className="gongsin-admin-settings" aria-label="초안 설정">
      <div className="gongsin-settings-heading">
        <h2>초안 설정</h2>
        <span role="status">
          {dirty ? "적용하지 않은 변경사항" : "변경사항 없음"}
        </span>
      </div>
      <nav className="ws-page-tabs" aria-label="공신문고 설정 항목">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="gongsin-settings-content">
        {tab === "general" && (
          <div className="gongsin-settings-fields">
            <SettingToggle
              label="질문 접수"
              checked={draft.acceptingQuestions}
              onChange={(acceptingQuestions) => update({ acceptingQuestions })}
            />
            <SettingToggle
              label="선정 스토리"
              checked={draft.storiesVisible}
              onChange={(storiesVisible) => update({ storiesVisible })}
            />
            <label className="gongsin-settings-field gongsin-settings-inline">
              기본 제한 기간
              <select
                value={draft.defaultRestrictionMs}
                onChange={(event) =>
                  update({ defaultRestrictionMs: Number(event.target.value) })
                }
              >
                {GONGSIN_RESTRICTION_DURATIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {tab === "notifications" && (
          <div className="gongsin-settings-fields">
            <SettingToggle
              label="교사 새 질문 알림"
              checked={draft.teacherQuestionNotifications}
              onChange={(teacherQuestionNotifications) =>
                update({ teacherQuestionNotifications })
              }
            />
            <SettingToggle
              label="학생 답변 알림"
              checked={draft.studentReplyNotifications}
              onChange={(studentReplyNotifications) =>
                update({ studentReplyNotifications })
              }
            />
          </div>
        )}
        {tab === "warning" && (
          <div className="gongsin-settings-fields">
            <SettingToggle
              label="첫 사용 안내"
              checked={draft.warning.enabled}
              onChange={(enabled) =>
                update({ warning: { ...draft.warning, enabled } })
              }
            />
            {draft.warning.enabled && (
              <div className="gongsin-settings-warning-fields">
                <label className="gongsin-settings-field">
                  안내 제목
                  <input
                    type="text"
                    maxLength={60}
                    value={draft.warning.title}
                    onChange={(event) =>
                      update({
                        warning: {
                          ...draft.warning,
                          title: event.target.value,
                        },
                      })
                    }
                    required
                  />
                </label>
                <label className="gongsin-settings-field">
                  안내 내용
                  <textarea
                    rows={3}
                    maxLength={600}
                    value={draft.warning.body}
                    onChange={(event) =>
                      update({
                        warning: { ...draft.warning, body: event.target.value },
                      })
                    }
                    required
                  />
                </label>
                {missingWarning && (
                  <p className="gongsin-settings-error" role="status">
                    안내 제목과 내용을 입력해 주세요.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {tab === "sources" && (
          <div className="gongsin-settings-sources">
            {SOURCE_ORDER.map((id) => (
              <SettingToggle
                key={id}
                label={DRAFT_SOURCES.find((source) => source.id === id)!.label}
                checked={draft.allowedSources.includes(id)}
                onChange={(enabled) =>
                  update({
                    allowedSources: enabled
                      ? [...draft.allowedSources, id]
                      : draft.allowedSources.filter((source) => source !== id),
                  })
                }
              >
                {id === "mock" ? "오답 노트에서만 질문" : undefined}
              </SettingToggle>
            ))}
          </div>
        )}
        <div
          hidden={tab !== "students"}
          className="gongsin-settings-student-panel"
        >
          <StudentRestrictions
            students={students}
            defaultDuration={settings.defaultRestrictionMs}
            onApply={onApplyRestriction}
            onRelease={onReleaseRestriction}
            initialStudentId={initialStudentId}
            navigationRequestId={navigationRequestId}
          />
        </div>
      </div>
      {(tab !== "students" || canReset) && (
        <div className="gongsin-settings-actions">
          <button
            type="button"
            className="gongsin-button gongsin-primary"
            disabled={!dirty || missingWarning}
            onClick={save}
          >
            설정 적용 (미리보기)
          </button>
          <button
            type="button"
            className="gongsin-button"
            disabled={!canReset}
            onClick={() => setDraft(settings)}
          >
            되돌리기
          </button>
        </div>
      )}
    </section>
  );
}

function StudentRestrictions({
  students,
  defaultDuration,
  onApply,
  onRelease,
  initialStudentId,
  navigationRequestId,
}: {
  students: GongsinRestrictionStudent[];
  defaultDuration: number;
  onApply: (studentId: string, until: number, reason: string) => void;
  onRelease: (studentId: string) => void;
  initialStudentId?: string;
  navigationRequestId?: number;
}) {
  const [selectedId, setSelectedId] = useState(
    initialStudentId ?? students[0]?.studentId ?? "",
  );
  const [duration, setDuration] = useState(String(defaultDuration));
  const [reason, setReason] = useState("학습과 무관한 대화");
  const [page, setPage] = useState(0);
  const student =
    students.find((item) => item.studentId === selectedId) ?? students[0];
  const restriction =
    student?.restriction && student.restriction.until > Date.now()
      ? student.restriction
      : undefined;
  useEffect(() => {
    if (initialStudentId) setSelectedId(initialStudentId);
  }, [initialStudentId, navigationRequestId]);
  useEffect(() => {
    setDuration(restriction ? "" : String(defaultDuration));
    setReason(restriction?.reason ?? "학습과 무관한 대화");
  }, [
    student?.studentId,
    restriction?.until,
    restriction?.reason,
    defaultDuration,
  ]);
  const restricted = students.filter(
    (item) => item.restriction && item.restriction.until > Date.now(),
  );
  const pageCount = Math.max(1, Math.ceil(restricted.length / 3));
  const currentPage = Math.min(page, pageCount - 1);
  const unchanged =
    Boolean(restriction) && !duration && reason.trim() === restriction?.reason;
  if (!student)
    return <p className="gongsin-settings-empty">학생이 없습니다.</p>;
  return (
    <div className="gongsin-settings-restrictions">
      <div className="gongsin-settings-restriction-form">
        <div className="gongsin-settings-restriction-fields">
          <label className="gongsin-settings-field">
            학생 선택
            <select
              value={student.studentId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {students.map((item) => (
                <option key={item.studentId} value={item.studentId}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="gongsin-settings-field">
            제한 기간
            <select
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            >
              {restriction && <option value="">현재 종료 시각 유지</option>}
              {GONGSIN_RESTRICTION_DURATIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="gongsin-settings-field">
          제한 사유
          <input
            type="text"
            maxLength={80}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </label>
        <p className="gongsin-settings-restriction-state" role="status">
          {restriction ? (
            <>
              <time dateTime={new Date(restriction.until).toISOString()}>
                {formatGongsinRestrictionTime(restriction.until)}
              </time>
              까지 (한국 시간)
            </>
          ) : (
            "제한 없음"
          )}
        </p>
        <div className="gongsin-settings-restriction-actions">
          <button
            type="button"
            className="gongsin-button gongsin-settings-restrict"
            disabled={!reason.trim() || unchanged}
            onClick={() => {
              const until = duration
                ? Date.now() + Number(duration)
                : restriction?.until;
              if (until) onApply(student.studentId, until, reason.trim());
            }}
          >
            제한 적용 (미리보기)
          </button>
          {restriction && (
            <button
              type="button"
              className="gongsin-button"
              onClick={() => onRelease(student.studentId)}
            >
              제한 해제
            </button>
          )}
        </div>
      </div>
      <section
        className="gongsin-settings-restriction-list"
        aria-label="제한 중인 학생"
      >
        <h3>
          제한 중 <span>{restricted.length}명</span>
        </h3>
        {restricted.length === 0 ? (
          <p className="gongsin-settings-empty">제한 중인 학생이 없습니다.</p>
        ) : (
          restricted.slice(currentPage * 3, currentPage * 3 + 3).map((item) => (
            <button
              type="button"
              key={item.studentId}
              aria-pressed={student.studentId === item.studentId}
              onClick={() => setSelectedId(item.studentId)}
            >
              <strong>{item.label}</strong>
              <time dateTime={new Date(item.restriction!.until).toISOString()}>
                {formatGongsinRestrictionTime(item.restriction!.until)}까지
              </time>
            </button>
          ))
        )}
        {pageCount > 1 && (
          <nav
            className="gongsin-settings-pages"
            aria-label="제한 학생 목록 페이지"
          >
            <button
              type="button"
              className="gongsin-button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              이전
            </button>
            <span>
              {currentPage + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="gongsin-button"
              disabled={currentPage === pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              다음
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}
