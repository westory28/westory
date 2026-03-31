import type {
  PointOrderStatus,
  PointPolicy,
  PointRankBadgeStyleToken,
  PointRankThemeId,
  PointTransactionType,
} from "../types";

export const TEACHER_POINT_TAB_LABELS = {
  overview: "위스 현황",
  grant: "지급 및 환수",
  policy: "운영 정책",
  ranks: "등급 관리",
  products: "상품 관리",
  requests: "구매 요청 관리",
} as const;

export const POINT_RANK_THEME_LABELS: Record<PointRankThemeId, string> = {
  korean_golpum: "한국사",
  world_nobility: "세계사",
};

export const POINT_RANK_THEME_DETAIL_LABELS: Record<PointRankThemeId, string> =
  {
    korean_golpum: "한국사 골품제",
    world_nobility: "세계사 귀족제",
  };

export const POINT_RANK_BADGE_STYLE_OPTIONS: Array<{
  value: PointRankBadgeStyleToken | string;
  label: string;
  swatchClassName: string;
  toneClassName: string;
}> = [
  {
    value: "stone",
    label: "회색",
    swatchClassName: "bg-stone-500",
    toneClassName: "border-stone-200 bg-stone-50 text-stone-700",
  },
  {
    value: "blue",
    label: "파랑",
    swatchClassName: "bg-blue-500",
    toneClassName: "border-blue-200 bg-blue-50 text-blue-700",
  },
  {
    value: "sky",
    label: "하늘",
    swatchClassName: "bg-sky-400",
    toneClassName: "border-sky-200 bg-sky-50 text-sky-700",
  },
  {
    value: "emerald",
    label: "초록",
    swatchClassName: "bg-emerald-500",
    toneClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  {
    value: "mint",
    label: "민트",
    swatchClassName: "bg-teal-400",
    toneClassName: "border-teal-200 bg-teal-50 text-teal-700",
  },
  {
    value: "yellow",
    label: "노랑",
    swatchClassName: "bg-yellow-400",
    toneClassName: "border-yellow-200 bg-yellow-50 text-yellow-700",
  },
  {
    value: "amber",
    label: "앰버",
    swatchClassName: "bg-amber-500",
    toneClassName: "border-amber-200 bg-amber-50 text-amber-700",
  },
  {
    value: "orange",
    label: "주황",
    swatchClassName: "bg-orange-500",
    toneClassName: "border-orange-200 bg-orange-50 text-orange-700",
  },
  {
    value: "red",
    label: "빨강",
    swatchClassName: "bg-red-500",
    toneClassName: "border-red-200 bg-red-50 text-red-700",
  },
  {
    value: "pink",
    label: "분홍",
    swatchClassName: "bg-pink-500",
    toneClassName: "border-pink-200 bg-pink-50 text-pink-700",
  },
  {
    value: "rose",
    label: "로즈",
    swatchClassName: "bg-rose-500",
    toneClassName: "border-rose-200 bg-rose-50 text-rose-700",
  },
  {
    value: "violet",
    label: "보라",
    swatchClassName: "bg-violet-500",
    toneClassName: "border-violet-200 bg-violet-50 text-violet-700",
  },
];

export const POINT_RANK_CELEBRATION_EFFECT_LABELS = {
  subtle: "절제형",
  standard: "표준",
} as const;

export const POINT_RANK_FIELD_LABELS = {
  activeThemeId: "활성 테마",
  tierThreshold: "등급 기준 위스",
  tierLabel: "등급 이름",
  tierShortLabel: "약칭",
  tierDescription: "설명",
  badgeStyleToken: "배지 색상",
  allowedEmojiIds: "허용 이모지",
  addTier: "등급 추가",
  deleteTier: "삭제",
  registryId: "이모지 ID",
  registryEmoji: "이모지",
  registryLabel: "표시명",
  registryCategory: "분류",
  registrySortOrder: "정렬값",
  registryUnlockTierCode: "해제 등급",
  registryEnabled: "활성",
  addRegistryItem: "이모지 추가",
  celebrationEnabled: "등급 축하 효과 사용",
  celebrationEffectLevel: "축하 강도",
} as const;

export const POINT_RANK_FIELD_HELPERS = {
  activeThemeId:
    "현재 저장되는 테마입니다. 나머지 테마는 미리보기에서 비교합니다.",
  tierThreshold:
    "편집 중 카드 순서는 유지되고, 저장 시 기준 위스 순서로 자동 정리됩니다.",
  tierLabel: "화면에 보이는 정식 등급 이름입니다.",
  tierShortLabel: "리스트, 배지, 짧은 표시에서 쓰기 좋은 약칭입니다.",
  tierDescription: "현재 등급이 어떤 의미인지 설명합니다.",
  badgeStyleToken: "실제 배지 색을 보고 바로 선택할 수 있습니다.",
  allowedEmojiIds: "이 등급에서 처음 열리는 이모지를 선택합니다.",
  addTier:
    "등급을 추가하면 가장 하위 단계에 초안으로 들어가며, 저장 전 기준 위스를 자유롭게 조정할 수 있습니다.",
  deleteTier: "등급을 삭제하면 관련 테마와 이모지 연결도 함께 정리됩니다.",
  registryId: "이모지 동기화를 위해 고유 ID를 사용합니다.",
  registryEmoji: "해당 등급을 대표하는 실제 이모지입니다.",
  registryLabel: "관리 화면에 보일 이름입니다.",
  registryCategory: "비슷한 이모지를 그룹으로 관리할 때 사용합니다.",
  registrySortOrder: "이모지 표시 순서를 결정합니다.",
  registryUnlockTierCode: "해당 이모지가 언제 열리는지 지정합니다.",
  registryEnabled: "비활성화하면 편집만 남고 다른 화면에서는 숨깁니다.",
  addRegistryItem: "새 이모지를 추가합니다.",
  celebrationEnabled: "등급 상승 시 학생 화면 축하 효과를 사용합니다.",
  celebrationEffectLevel: "축하 화면의 연출 강도를 조절합니다.",
} as const;

export const STUDENT_POINT_TAB_LABELS = {
  overview: "내 위스",
  "hall-of-fame": "화랑의 전당",
  history: "위스 내역",
  shop: "위스 상점",
  orders: "구매 내역",
} as const;

export const POINT_ORDER_STATUS_LABELS: Record<PointOrderStatus, string> = {
  requested: "요청 접수",
  approved: "승인 완료",
  rejected: "반려",
  fulfilled: "지급 완료",
  cancelled: "취소",
};

export const POINT_TRANSACTION_TYPE_LABELS: Record<
  PointTransactionType,
  string
> = {
  attendance: "출석 체크",
  attendance_monthly_bonus: "월간 개근 보너스",
  attendance_milestone_bonus: "출석 누적 보너스",
  quiz: "문제 풀이",
  quiz_bonus: "문제 풀이 만점 보너스",
  lesson: "수업 자료 확인",
  think_cloud: "생각모아 참여",
  map_tag: "지도 태그 탐색",
  history_classroom: "역사교실 참여",
  history_classroom_bonus: "역사교실 성과 보너스",
  manual_adjust: "교사 직접 지급",
  manual_reclaim: "교사 직접 환수",
  purchase_hold: "구매 요청",
  purchase_confirm: "구매 확정",
  purchase_cancel: "구매 취소",
};

export const POINT_POLICY_FIELD_LABELS: Record<
  keyof Pick<
    PointPolicy,
    | "attendanceDaily"
    | "attendanceMonthlyBonus"
    | "quizSolve"
    | "lessonView"
    | "thinkCloudEnabled"
    | "thinkCloudAmount"
    | "thinkCloudMaxClaims"
    | "mapTagEnabled"
    | "mapTagAmount"
    | "mapTagMaxClaims"
    | "historyClassroomEnabled"
    | "historyClassroomAmount"
    | "historyClassroomBonusEnabled"
    | "historyClassroomBonusThreshold"
    | "historyClassroomBonusAmount"
    | "attendanceMilestoneBonusEnabled"
    | "attendanceMilestone50"
    | "attendanceMilestone100"
    | "attendanceMilestone200"
    | "attendanceMilestone300"
    | "autoRewardEnabled"
    | "quizBonusEnabled"
    | "quizBonusThreshold"
    | "quizBonusAmount"
    | "manualAdjustEnabled"
    | "allowNegativeBalance"
  >,
  string
> = {
  attendanceDaily: "출석 체크 기본 위스",
  attendanceMonthlyBonus: "월간 개근 보너스",
  quizSolve: "문제 풀이 기본 위스",
  lessonView: "수업 자료 확인 위스",
  thinkCloudEnabled: "생각모아 자동 지급 사용",
  thinkCloudAmount: "생각모아 1회 지급 위스",
  thinkCloudMaxClaims: "생각모아 누적 최대 인정 횟수",
  mapTagEnabled: "지도 태그 자동 지급 사용",
  mapTagAmount: "지도 태그 1회 지급 위스",
  mapTagMaxClaims: "지도 태그 누적 최대 인정 횟수",
  historyClassroomEnabled: "역사교실 기본 자동 지급 사용",
  historyClassroomAmount: "역사교실 기본 지급 위스",
  historyClassroomBonusEnabled: "역사교실 성과 보너스 사용",
  historyClassroomBonusThreshold: "역사교실 보너스 기준 정답률",
  historyClassroomBonusAmount: "역사교실 보너스 위스",
  attendanceMilestoneBonusEnabled: "출석 누적 보너스 사용",
  attendanceMilestone50: "출석 50회 보너스",
  attendanceMilestone100: "출석 100회 보너스",
  attendanceMilestone200: "출석 200회 보너스",
  attendanceMilestone300: "출석 300회 보너스",
  autoRewardEnabled: "자동 지급 정책 활성화",
  quizBonusEnabled: "문제 풀이 보너스 사용",
  quizBonusThreshold: "보너스 기준 점수",
  quizBonusAmount: "보너스 추가 위스",
  manualAdjustEnabled: "교사 직접 지급 및 환수 허용",
  allowNegativeBalance: "잔액 부족 상태에서도 차감 허용",
};

export const POINT_POLICY_FIELD_HELPERS: Record<
  keyof Pick<
    PointPolicy,
    | "attendanceDaily"
    | "attendanceMonthlyBonus"
    | "quizSolve"
    | "lessonView"
    | "thinkCloudEnabled"
    | "thinkCloudAmount"
    | "thinkCloudMaxClaims"
    | "mapTagEnabled"
    | "mapTagAmount"
    | "mapTagMaxClaims"
    | "historyClassroomEnabled"
    | "historyClassroomAmount"
    | "historyClassroomBonusEnabled"
    | "historyClassroomBonusThreshold"
    | "historyClassroomBonusAmount"
    | "attendanceMilestoneBonusEnabled"
    | "attendanceMilestone50"
    | "attendanceMilestone100"
    | "attendanceMilestone200"
    | "attendanceMilestone300"
    | "autoRewardEnabled"
    | "quizBonusEnabled"
    | "quizBonusThreshold"
    | "quizBonusAmount"
    | "manualAdjustEnabled"
    | "allowNegativeBalance"
  >,
  string
> = {
  attendanceDaily:
    "학생이 하루 한 번 출석 체크를 완료했을 때 지급되는 기본 위스입니다.",
  attendanceMonthlyBonus:
    "해당 월의 모든 날짜에 출석한 학생에게 마지막 출석 시점에 한 번만 추가 지급됩니다.",
  quizSolve: "문제 풀이를 정상 제출했을 때 자동으로 적립되는 기본 위스입니다.",
  lessonView: "수업 자료를 충분히 확인하고 저장까지 마쳤을 때 지급됩니다.",
  thinkCloudEnabled:
    "생각모아 제출 위스를 별도로 운영합니다. 실제 중복 제한은 최근 지급 시점 기준 24시간마다 1회입니다.",
  thinkCloudAmount:
    "생각모아 응답 제출이 완료되면 적립되는 기본 위스입니다.",
  thinkCloudMaxClaims:
    "학생당 누적 최대 인정 횟수입니다. 24시간 제한과 함께 서버에서 강제됩니다.",
  mapTagEnabled:
    "지도 팝업 모달 안에서 태그를 눌렀을 때만 별도 위스를 적립합니다. 최근 지급 시점 기준 24시간마다 1회입니다.",
  mapTagAmount:
    "지도 팝업 모달 태그 클릭 1회에 적립할 위스입니다.",
  mapTagMaxClaims:
    "학생당 지도 태그 활동으로 인정할 최대 횟수입니다.",
  historyClassroomEnabled:
    "역사교실 제출 완료 시 기본 위스를 적립합니다. 최근 지급 시점 기준 24시간마다 1회만 기본 지급됩니다.",
  historyClassroomAmount:
    "역사교실 제출 완료 시 기본으로 적립할 위스입니다.",
  historyClassroomBonusEnabled:
    "기본 지급과 별도로 정답률 기준을 넘긴 시도에 성과 보너스를 지급합니다.",
  historyClassroomBonusThreshold:
    "해당 정답률(%) 이상일 때만 성과 보너스를 지급합니다.",
  historyClassroomBonusAmount:
    "역사교실 기본 지급과 별도로 추가할 보너스 위스입니다.",
  attendanceMilestoneBonusEnabled:
    "출석 누적 50/100/200/300회 달성 시점에 각 구간 보너스를 1회만 지급합니다.",
  attendanceMilestone50:
    "현재 학기 누적 출석 50회에 도달했을 때 지급할 위스입니다.",
  attendanceMilestone100:
    "현재 학기 누적 출석 100회에 도달했을 때 지급할 위스입니다.",
  attendanceMilestone200:
    "현재 학기 누적 출석 200회에 도달했을 때 지급할 위스입니다.",
  attendanceMilestone300:
    "현재 학기 누적 출석 300회에 도달했을 때 지급할 위스입니다.",
  autoRewardEnabled:
    "끄면 출석, 문제 풀이, 수업 자료 확인, 생각모아, 지도 태그, 역사교실 자동 지급이 모두 멈춥니다.",
  quizBonusEnabled:
    "기본 지급과 별도로 기준 점수 이상일 때 추가 위스를 지급합니다.",
  quizBonusThreshold:
    "기본값은 100점이며, 기준 점수 이상부터 보너스를 지급합니다.",
  quizBonusAmount: "문제 풀이 기본 위스와 별도로 추가 지급할 위스입니다.",
  manualAdjustEnabled: "끄면 교사의 직접 지급/환수 기능이 서버에서 차단됩니다.",
  allowNegativeBalance: "켜면 보유 위스보다 많이 환수하는 운영도 허용합니다.",
};

export const POINT_HISTORY_FILTER_LABELS = {
  all: "전체",
  earned: "적립",
  spent: "사용",
  attendance: "출석",
  attendance_monthly_bonus: "월간 개근 보너스",
  attendance_milestone_bonus: "출석 누적 보너스",
  quiz: "문제 풀이",
  quiz_bonus: "문제 풀이 보너스",
  lesson: "수업 자료",
  think_cloud: "생각모아",
  map_tag: "지도 태그",
  history_classroom: "역사교실",
  history_classroom_bonus: "역사교실 성과 보너스",
  manual_adjust: "교사 지급",
  manual_reclaim: "교사 환수",
  purchase: "구매 관련",
} as const;

export const getPointDeltaToneClass = (delta: number) =>
  delta >= 0 ? "text-emerald-600" : "text-rose-500";

export const getPointFeedbackToneClass = (message: string) =>
  message.includes("실패") ||
  message.includes("오류") ||
  message.includes("부족") ||
  message.includes("없습니다") ||
  message.includes("입력")
    ? "border border-red-200 bg-red-50 text-red-700"
    : "border border-emerald-200 bg-emerald-50 text-emerald-700";
