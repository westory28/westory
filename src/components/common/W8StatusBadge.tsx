import React from "react";

const LABELS: Record<string, string> = {
  DRAFT: "작성 중",
  READY: "공개 준비",
  SCHEDULED: "공개 예정",
  PUBLISHED: "공개 중",
  CLOSED: "종료",
  EXPIRED: "공개 종료",
  ARCHIVED: "지난 학기",
  NOT_STARTED: "시작 전",
  IN_PROGRESS: "진행 중",
  COMPLETED: "완료",
  PAUSED: "잠시 멈춤",
  OPEN: "입력 중",
  PRESENT: "출석",
  LATE: "지각",
  ABSENT: "결석",
  EARLY_LEAVE: "조퇴",
  EXCUSED: "인정",
  UNRECORDED: "미입력",
  PENDING: "확인 대기",
  APPROVED: "승인",
  REJECTED: "반려",
  NORMAL: "일반",
  IMPORTANT: "중요",
  HIGH: "중요",
  URGENT: "긴급",
};

const W8StatusBadge: React.FC<{ value: string }> = ({ value }) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  const tone = ["COMPLETED", "PUBLISHED", "PRESENT", "APPROVED"].includes(
    normalized,
  )
    ? "success"
    : ["ABSENT", "URGENT", "EXPIRED", "REJECTED"].includes(normalized)
      ? "danger"
      : [
            "LATE",
            "EARLY_LEAVE",
            "IMPORTANT",
            "HIGH",
            "SCHEDULED",
            "PENDING",
          ].includes(normalized)
        ? "accent"
        : "neutral";

  return (
    <span className={`w8-status w8-status--${tone}`}>
      {LABELS[normalized] || normalized || "상태 미정"}
    </span>
  );
};

export default W8StatusBadge;
