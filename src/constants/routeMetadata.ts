import type { UserData } from "../types";
import {
  canAccessTeacherPath,
  canManageW8Domains,
  canReadLessonManagement,
} from "../lib/permissions";

export type PortalKind = "student" | "teacher" | "admin";
export type ProvenanceKind =
  | "CURRENT"
  | "PREPARING"
  | "ARCHIVE"
  | "LEGACY"
  | "EXPLICIT";

export interface RouteMetadata {
  id: string;
  path: string;
  title: string;
  shortTitle: string;
  description: string;
  portal: "student" | "teacher";
  navigationId: string;
  provenance?: ProvenanceKind;
  readOnly?: boolean;
}

export type NavigationPermission = (
  userData: Partial<UserData> | null | undefined,
  email?: string | null,
) => boolean;

export interface ShellNavigationChild {
  label: string;
  to: string;
  description?: string;
  allowed?: NavigationPermission;
}

export interface ShellNavigationItem {
  id: string;
  label: string;
  shortLabel?: string;
  to: string;
  menuConfigUrl?: string;
  iconPath: string;
  matchPrefixes: string[];
  query?: Record<string, string>;
  children?: ShellNavigationChild[];
  allowed?: NavigationPermission;
}

const ICONS = {
  home: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-8.5Z",
  learning:
    "M4 5.5A2.5 2.5 0 0 1 6.5 3H11a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H6.5A2.5 2.5 0 0 0 4 19.5v-14Zm16 0A2.5 2.5 0 0 0 17.5 3H14v14h3.5a2.5 2.5 0 0 1 2.5 2.5v-14Z",
  assessment: "M7 3h10a2 2 0 0 1 2 2v16H5V5a2 2 0 0 1 2-2Zm2 5h6M9 12h6M9 16h4",
  grade: "M5 20V10h3v10H5Zm6 0V4h3v16h-3Zm6 0v-7h3v7h-3Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  students:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87m0-7.26a4 4 0 0 1 0 7.75",
  schedule: "M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z",
  points: "M12 3v18m5-14.5H9.5a3.5 3.5 0 0 0 0 7H15a3 3 0 0 1 0 6H7",
  settings:
    "M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Zm7.4-3.5a7.8 7.8 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L15 3.5h-4L10.6 6a8 8 0 0 0-1.7 1L6.5 6 4.5 9.5 6.6 11a7.8 7.8 0 0 0 0 2L4.5 14.5l2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 2.6h4l.4-2.6a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2.1-1.5a7.8 7.8 0 0 0 .1-1Z",
} as const;

const allowTeacherPath =
  (pathname: string): NavigationPermission =>
  (userData, email) =>
    canAccessTeacherPath(pathname, userData, email);

export const STUDENT_GLOBAL_NAVIGATION: ShellNavigationItem[] = [
  {
    id: "student-learning",
    label: "학습",
    to: "/student/learning",
    iconPath: ICONS.learning,
    matchPrefixes: ["/student/learning", "/student/lesson"],
    children: [
      { label: "나의 학습", to: "/student/learning" },
      { label: "역사 사전", to: "/student/lesson/history-dictionary" },
      { label: "지도", to: "/student/lesson/maps" },
      { label: "싱크 클라우드", to: "/student/lesson/think-cloud" },
    ],
  },
  {
    id: "student-assessment",
    label: "평가",
    to: "/student/quiz",
    iconPath: ICONS.assessment,
    matchPrefixes: ["/student/quiz", "/student/history-classroom"],
    children: [
      { label: "문제 풀이", to: "/student/quiz" },
      { label: "역사교실", to: "/student/history-classroom" },
    ],
  },
  {
    id: "student-grade",
    label: "점수",
    to: "/student/score",
    iconPath: ICONS.grade,
    matchPrefixes: ["/student/score", "/student/history"],
    children: [
      { label: "성적 계산기", to: "/student/score" },
      { label: "나의 성적 리포트", to: "/student/score/report" },
      { label: "내 수행평가 점수", to: "/student/score/performance" },
      {
        label: "내 정기시험 점수",
        to: "/student/score/written-exam",
      },
      { label: "정기 시험 답안", to: "/student/history" },
    ],
  },
  {
    id: "student-points",
    label: "위스",
    to: "/student/points",
    iconPath: ICONS.points,
    matchPrefixes: ["/student/points"],
    children: [
      { label: "내 위스", to: "/student/points" },
      { label: "화랑의 전당", to: "/student/points?tab=hall-of-fame" },
      { label: "위스 상점", to: "/student/points?tab=shop" },
      { label: "구매 내역", to: "/student/points?tab=orders" },
    ],
  },
  {
    id: "student-mypage",
    label: "마이페이지",
    to: "/student/mypage",
    iconPath: ICONS.more,
    matchPrefixes: ["/student/mypage"],
    children: [
      { label: "마이페이지", to: "/student/mypage" },
      {
        label: "지난 학기",
        to: "/student/mypage/archive",
        description: "지난 학기 기록을 읽기 전용으로 확인합니다.",
      },
    ],
  },
  {
    id: "student-schedule",
    label: "일정·출석·공지",
    to: "/student/schedule",
    iconPath: ICONS.schedule,
    matchPrefixes: [
      "/student/calendar",
      "/student/schedule",
      "/student/attendance",
      "/student/communication",
    ],
    children: [
      { label: "전체 일정", to: "/student/calendar" },
      { label: "일정", to: "/student/schedule" },
      { label: "출석", to: "/student/attendance" },
      { label: "공지", to: "/student/communication" },
    ],
  },
  {
    id: "student-today",
    label: "오늘",
    to: "/student/dashboard",
    iconPath: ICONS.home,
    matchPrefixes: ["/student/dashboard"],
  },
];

const TEACHER_NAVIGATION_ORDER = [
  "teacher-learning",
  "teacher-assessment",
  "teacher-grade",
  "teacher-points",
  "teacher-students",
  "teacher-home",
  "teacher-schedule",
  "teacher-admin",
] as const;

export const TEACHER_GLOBAL_NAVIGATION: ShellNavigationItem[] = [
  {
    id: "teacher-home",
    label: "업무 홈",
    shortLabel: "홈",
    to: "/teacher/dashboard",
    iconPath: ICONS.home,
    matchPrefixes: ["/teacher/dashboard"],
    allowed: allowTeacherPath("/teacher/dashboard"),
  },
  {
    id: "teacher-students",
    label: "학생 관리",
    shortLabel: "학생",
    to: "/teacher/students",
    iconPath: ICONS.students,
    matchPrefixes: ["/teacher/students"],
    allowed: allowTeacherPath("/teacher/students"),
  },
  {
    id: "teacher-learning",
    label: "학습 자료 관리",
    shortLabel: "수업",
    to: "/teacher/learning",
    menuConfigUrl: "/teacher/learning",
    iconPath: ICONS.learning,
    matchPrefixes: ["/teacher/learning", "/teacher/lesson"],
    allowed: canManageW8Domains,
    children: [
      {
        label: "학습 운영",
        to: "/teacher/learning",
        allowed: canManageW8Domains,
      },
      {
        label: "역사 사전 관리",
        to: "/teacher/lesson/history-dictionary",
        allowed: canReadLessonManagement,
      },
      {
        label: "지도",
        to: "/teacher/lesson/maps",
        allowed: canReadLessonManagement,
      },
      {
        label: "사료 창고",
        to: "/teacher/lesson/source-archive",
        allowed: canReadLessonManagement,
      },
      {
        label: "싱크 클라우드 관리",
        to: "/teacher/lesson/think-cloud",
        allowed: canManageW8Domains,
      },
    ],
  },
  {
    id: "teacher-assessment",
    label: "평가 관리",
    shortLabel: "평가",
    to: "/teacher/quiz",
    iconPath: ICONS.assessment,
    matchPrefixes: ["/teacher/quiz"],
    allowed: allowTeacherPath("/teacher/quiz"),
    children: [
      {
        label: "문제 등록",
        to: "/teacher/quiz",
        allowed: allowTeacherPath("/teacher/quiz"),
      },
      {
        label: "응시 현황",
        to: "/teacher/quiz?tab=log",
        allowed: allowTeacherPath("/teacher/quiz"),
      },
      {
        label: "문제 은행",
        to: "/teacher/quiz?tab=bank",
        allowed: allowTeacherPath("/teacher/quiz"),
      },
      {
        label: "역사교실",
        to: "/teacher/quiz/history-classroom",
        allowed: allowTeacherPath("/teacher/quiz/history-classroom"),
      },
    ],
  },
  {
    id: "teacher-grade",
    label: "점수 관리",
    shortLabel: "성적",
    to: "/teacher/exam",
    iconPath: ICONS.grade,
    matchPrefixes: ["/teacher/exam"],
    allowed: allowTeacherPath("/teacher/exam"),
    children: [
      {
        label: "평가 반영 비율",
        to: "/teacher/exam",
        allowed: allowTeacherPath("/teacher/exam"),
      },
      {
        label: "정기시험 답안",
        to: "/teacher/exam?tab=omr",
        allowed: allowTeacherPath("/teacher/exam"),
      },
      {
        label: "수행평가 점수 관리",
        to: "/teacher/exam?tab=performance",
        allowed: allowTeacherPath("/teacher/exam"),
      },
      {
        label: "정기시험 점수 관리",
        to: "/teacher/exam?tab=written-essay",
        allowed: allowTeacherPath("/teacher/exam"),
      },
    ],
  },
  {
    id: "teacher-points",
    label: "위스 관리",
    shortLabel: "위스",
    to: "/teacher/points",
    iconPath: ICONS.points,
    matchPrefixes: ["/teacher/points"],
    allowed: allowTeacherPath("/teacher/points"),
    children: [
      {
        label: "위스 현황",
        to: "/teacher/points",
        allowed: allowTeacherPath("/teacher/points"),
      },
      {
        label: "지급 및 환수",
        to: "/teacher/points?tab=grant",
        allowed: allowTeacherPath("/teacher/points"),
      },
      {
        label: "운영 정책",
        to: "/teacher/points?tab=policy",
        allowed: allowTeacherPath("/teacher/points"),
      },
      {
        label: "화랑의 전당 관리",
        to: "/teacher/points?tab=hall-of-fame",
        allowed: allowTeacherPath("/teacher/points"),
      },
      {
        label: "상품 관리",
        to: "/teacher/points?tab=products",
        allowed: allowTeacherPath("/teacher/points"),
      },
      {
        label: "구매 요청 관리",
        to: "/teacher/points?tab=requests",
        allowed: allowTeacherPath("/teacher/points"),
      },
    ],
  },
  {
    id: "teacher-schedule",
    label: "일정과 소통",
    shortLabel: "일정",
    to: "/teacher/schedule",
    iconPath: ICONS.schedule,
    matchPrefixes: [
      "/teacher/schedule",
      "/teacher/attendance",
      "/teacher/communication",
    ],
    allowed: allowTeacherPath("/teacher/schedule"),
    children: [
      {
        label: "일정",
        to: "/teacher/schedule",
        allowed: allowTeacherPath("/teacher/schedule"),
      },
      {
        label: "출석",
        to: "/teacher/attendance",
        allowed: allowTeacherPath("/teacher/attendance"),
      },
      {
        label: "공지 운영",
        to: "/teacher/communication",
        allowed: allowTeacherPath("/teacher/communication"),
      },
    ],
  },
  {
    id: "teacher-admin",
    label: "관리자",
    shortLabel: "관리",
    to: "/teacher/settings",
    iconPath: ICONS.settings,
    matchPrefixes: ["/teacher/settings"],
    allowed: allowTeacherPath("/teacher/settings"),
    children: [
      {
        label: "관리자 설정",
        to: "/teacher/settings",
        description: "권한과 사이트 운영 설정을 확인합니다.",
        allowed: allowTeacherPath("/teacher/settings"),
      },
      {
        label: "학기 전환 준비",
        to: "/teacher/settings/cutover",
        description:
          "Dedicated Staging의 합성 리허설과 검증 근거를 확인합니다.",
        allowed: allowTeacherPath("/teacher/settings/cutover"),
      },
    ],
  },
].sort(
  (left, right) =>
    TEACHER_NAVIGATION_ORDER.indexOf(
      left.id as (typeof TEACHER_NAVIGATION_ORDER)[number],
    ) -
    TEACHER_NAVIGATION_ORDER.indexOf(
      right.id as (typeof TEACHER_NAVIGATION_ORDER)[number],
    ),
);

export const NAVIGATION_REGISTRY = {
  student: STUDENT_GLOBAL_NAVIGATION,
  teacher: TEACHER_GLOBAL_NAVIGATION,
} satisfies Record<"student" | "teacher", ShellNavigationItem[]>;

export const ROUTE_METADATA: RouteMetadata[] = [
  {
    id: "student-dashboard",
    path: "/student/dashboard",
    title: "오늘",
    shortTitle: "오늘",
    description: "이어 할 학습과 오늘 일정, 공지를 확인하세요.",
    portal: "student",
    navigationId: "student-today",
  },
  {
    id: "student-learning-hub",
    path: "/student/learning",
    title: "나의 학습",
    shortTitle: "학습",
    description: "배운 내용을 확인하고 완료한 학습을 정리하세요.",
    portal: "student",
    navigationId: "student-learning",
  },
  {
    id: "student-schedule-hub",
    path: "/student/schedule",
    title: "일정",
    shortTitle: "일정",
    description: "수업과 학교 일정, 학습 마감을 확인하세요.",
    portal: "student",
    navigationId: "student-schedule",
  },
  {
    id: "student-attendance-hub",
    path: "/student/attendance",
    title: "나의 출석",
    shortTitle: "출석",
    description: "교사가 기록한 이번 학기 출석을 확인하세요.",
    portal: "student",
    navigationId: "student-schedule",
  },
  {
    id: "student-communication-hub",
    path: "/student/communication",
    title: "공지와 알림",
    shortTitle: "공지",
    description: "받은 공지를 확인하고 읽음 상태를 관리하세요.",
    portal: "student",
    navigationId: "student-schedule",
  },
  {
    id: "student-note",
    path: "/student/lesson/note",
    title: "수업 자료",
    shortTitle: "수업 자료",
    description: "수업 내용을 읽고 학습 기록을 이어가세요.",
    portal: "student",
    navigationId: "student-learning",
  },
  {
    id: "student-dictionary",
    path: "/student/lesson/history-dictionary",
    title: "역사 사전",
    shortTitle: "역사 사전",
    description: "역사 용어와 내가 정리한 뜻을 찾아보세요.",
    portal: "student",
    navigationId: "student-learning",
  },
  {
    id: "student-maps",
    path: "/student/lesson/maps",
    title: "역사 지도",
    shortTitle: "지도",
    description: "장소와 사건의 흐름을 지도에서 확인하세요.",
    portal: "student",
    navigationId: "student-learning",
  },
  {
    id: "student-think-cloud",
    path: "/student/lesson/think-cloud",
    title: "생각모아",
    shortTitle: "생각모아",
    description: "수업 주제에 내 생각을 보태 보세요.",
    portal: "student",
    navigationId: "student-learning",
  },
  {
    id: "student-quiz-run",
    path: "/student/quiz/run",
    title: "평가 응시",
    shortTitle: "평가 응시",
    description: "저장 상태를 확인하며 평가를 진행하세요.",
    portal: "student",
    navigationId: "student-assessment",
  },
  {
    id: "student-quiz",
    path: "/student/quiz",
    title: "평가",
    shortTitle: "평가",
    description: "응시할 평가와 지난 결과를 확인하세요.",
    portal: "student",
    navigationId: "student-assessment",
  },
  {
    id: "student-history-run",
    path: "/student/history-classroom/run",
    title: "역사교실 응시",
    shortTitle: "역사교실",
    description: "과제 상태와 남은 시간을 확인하며 진행하세요.",
    portal: "student",
    navigationId: "student-assessment",
  },
  {
    id: "student-history-classroom",
    path: "/student/history-classroom",
    title: "역사교실",
    shortTitle: "역사교실",
    description: "배정된 과제와 진행 상태를 확인하세요.",
    portal: "student",
    navigationId: "student-assessment",
  },
  {
    id: "student-score-report",
    path: "/student/score/report",
    title: "성적 리포트",
    shortTitle: "성적 리포트",
    description: "나의 성적 흐름과 학습 전략을 살펴보세요.",
    portal: "student",
    navigationId: "student-grade",
  },
  {
    id: "student-performance",
    path: "/student/score/performance",
    title: "수행평가 성적",
    shortTitle: "수행평가",
    description: "점수 근거와 피드백을 확인하세요.",
    portal: "student",
    navigationId: "student-grade",
  },
  {
    id: "student-written-exam",
    path: "/student/score/written-exam",
    title: "정기시험 성적",
    shortTitle: "정기시험",
    description: "문항별 점수와 피드백을 확인하세요.",
    portal: "student",
    navigationId: "student-grade",
  },
  {
    id: "student-score",
    path: "/student/score",
    title: "내 성적",
    shortTitle: "성적",
    description: "예상 성적과 공식 성적을 구분해 확인하세요.",
    portal: "student",
    navigationId: "student-grade",
  },
  {
    id: "student-history",
    path: "/student/history",
    title: "정기시험 답안",
    shortTitle: "답안",
    description: "시험 답안과 다시 볼 내용을 확인하세요.",
    portal: "student",
    navigationId: "student-grade",
  },
  {
    id: "student-points",
    path: "/student/points",
    title: "내 위스",
    shortTitle: "위스",
    description: "이번 학기 위스와 거래, 주문을 확인하세요.",
    portal: "student",
    navigationId: "student-points",
  },
  {
    id: "student-calendar",
    path: "/student/calendar",
    title: "전체 일정",
    shortTitle: "일정",
    description: "수업과 학교 일정을 확인하세요.",
    portal: "student",
    navigationId: "student-schedule",
  },
  {
    id: "student-mypage",
    path: "/student/mypage",
    title: "마이페이지",
    shortTitle: "마이페이지",
    description: "내 정보와 현재 학적을 확인하세요.",
    portal: "student",
    navigationId: "student-mypage",
  },
  {
    id: "teacher-learning-hub",
    path: "/teacher/learning",
    title: "학습 운영",
    shortTitle: "학습 운영",
    description: "학습 자료와 공개 상태, 진행 현황을 관리합니다.",
    portal: "teacher",
    navigationId: "teacher-learning",
  },
  {
    id: "teacher-attendance-hub",
    path: "/teacher/attendance",
    title: "출석 운영",
    shortTitle: "출석",
    description: "학급별 출석을 입력하고 정정 이력을 확인합니다.",
    portal: "teacher",
    navigationId: "teacher-schedule",
  },
  {
    id: "teacher-communication-hub",
    path: "/teacher/communication",
    title: "공지 운영",
    shortTitle: "공지",
    description: "대상을 지정해 공지를 공개하고 전달 상태를 확인합니다.",
    portal: "teacher",
    navigationId: "teacher-schedule",
  },
  {
    id: "teacher-dashboard",
    path: "/teacher/dashboard",
    title: "업무 홈",
    shortTitle: "업무 홈",
    description: "오늘 확인할 일정과 운영 상태를 살펴보세요.",
    portal: "teacher",
    navigationId: "teacher-home",
  },
  {
    id: "teacher-students",
    path: "/teacher/students",
    title: "학생과 학급",
    shortTitle: "학생과 학급",
    description: "학생을 찾고 현재 학적과 학급을 확인합니다.",
    portal: "teacher",
    navigationId: "teacher-students",
  },
  {
    id: "teacher-history-classroom",
    path: "/teacher/quiz/history-classroom",
    title: "역사교실 운영",
    shortTitle: "역사교실",
    description: "배정, 응시, 면제 요청을 한 흐름에서 관리합니다.",
    portal: "teacher",
    navigationId: "teacher-assessment",
  },
  {
    id: "teacher-quiz",
    path: "/teacher/quiz",
    title: "평가 운영",
    shortTitle: "평가 운영",
    description: "평가를 준비하고 응시 현황을 확인합니다.",
    portal: "teacher",
    navigationId: "teacher-assessment",
  },
  {
    id: "teacher-exam",
    path: "/teacher/exam",
    title: "성적 운영",
    shortTitle: "성적 운영",
    description: "평가 기준, 점수, 요청과 확인 상태를 관리합니다.",
    portal: "teacher",
    navigationId: "teacher-grade",
  },
  {
    id: "teacher-semester-cutover",
    path: "/teacher/settings/cutover",
    title: "학기 전환 준비",
    shortTitle: "전환 준비",
    description: "Dedicated Staging의 합성 리허설과 검증 상태를 확인합니다.",
    portal: "teacher",
    navigationId: "teacher-admin",
    provenance: "PREPARING",
    readOnly: true,
  },
  {
    id: "teacher-settings",
    path: "/teacher/settings",
    title: "관리자",
    shortTitle: "관리자",
    description: "학기, 권한, 사이트 운영 설정을 관리합니다.",
    portal: "teacher",
    navigationId: "teacher-admin",
  },
  {
    id: "teacher-points",
    path: "/teacher/points",
    title: "위스 운영",
    shortTitle: "위스 운영",
    description: "학생별 위스와 정책, 상품, 요청을 관리합니다.",
    portal: "teacher",
    navigationId: "teacher-points",
  },
  {
    id: "teacher-schedule",
    path: "/teacher/schedule",
    title: "일정과 소통",
    shortTitle: "일정",
    description: "학교 일정과 공지를 안전하게 관리합니다.",
    portal: "teacher",
    navigationId: "teacher-schedule",
  },
  {
    id: "teacher-source-archive",
    path: "/teacher/lesson/source-archive",
    title: "사료 보관함",
    shortTitle: "사료 보관함",
    description: "수업 사료의 상태와 출처를 확인합니다.",
    portal: "teacher",
    navigationId: "teacher-learning",
  },
  {
    id: "teacher-dictionary",
    path: "/teacher/lesson/history-dictionary",
    title: "역사 사전 관리",
    shortTitle: "역사 사전",
    description: "용어와 학생 요청을 검토합니다.",
    portal: "teacher",
    navigationId: "teacher-learning",
  },
  {
    id: "teacher-maps",
    path: "/teacher/lesson/maps",
    title: "역사 지도 관리",
    shortTitle: "지도",
    description: "지도 자료와 영역 정보를 관리합니다.",
    portal: "teacher",
    navigationId: "teacher-learning",
  },
  {
    id: "teacher-think-cloud",
    path: "/teacher/lesson/think-cloud",
    title: "생각모아 운영",
    shortTitle: "생각모아",
    description: "수업 참여 주제와 응답 상태를 관리합니다.",
    portal: "teacher",
    navigationId: "teacher-learning",
  },
  {
    id: "teacher-lesson",
    path: "/teacher/lesson",
    title: "수업 운영",
    shortTitle: "수업 운영",
    description: "수업 자료를 만들고 학생 화면을 확인합니다.",
    portal: "teacher",
    navigationId: "teacher-learning",
  },
];

export const getRouteMetadata = (pathname: string): RouteMetadata | null => {
  const candidates = ROUTE_METADATA.filter(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
  ).sort((a, b) => b.path.length - a.path.length);
  return candidates[0] || null;
};

export const isNavigationItemActive = (
  item: ShellNavigationItem,
  pathname: string,
  search: string,
) => {
  const children = item.children || [];
  if (
    children.some((child) =>
      isNavigationChildActive(child, children, pathname, search),
    )
  ) {
    return true;
  }
  if (
    !item.matchPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return false;
  }
  if (!item.query) return true;
  const params = new URLSearchParams(search);
  return Object.entries(item.query).every(
    ([key, value]) => params.get(key) === value,
  );
};

const getNavigationTargetMatch = (
  to: string,
  pathname: string,
  search: string,
) => {
  const [targetPath, targetQuery = ""] = to.split("?");
  if (pathname !== targetPath && !pathname.startsWith(`${targetPath}/`)) {
    return null;
  }

  const targetParams = new URLSearchParams(targetQuery);
  const currentParams = new URLSearchParams(search);
  for (const [key, value] of targetParams.entries()) {
    if (currentParams.get(key) !== value) return null;
  }

  return {
    pathLength: targetPath.length,
    queryCount: Array.from(targetParams.keys()).length,
  };
};

export const isNavigationChildActive = (
  child: ShellNavigationChild,
  siblings: ShellNavigationChild[],
  pathname: string,
  search: string,
) => {
  const matches = siblings.flatMap((candidate, index) => {
    const match = getNavigationTargetMatch(candidate.to, pathname, search);
    return match ? [{ candidate, index, ...match }] : [];
  });
  if (matches.length === 0) return false;

  matches.sort(
    (left, right) =>
      right.pathLength - left.pathLength ||
      right.queryCount - left.queryCount ||
      left.index - right.index,
  );
  return matches[0].candidate === child;
};

export const getActiveNavigationItemId = (
  items: ShellNavigationItem[],
  pathname: string,
  search: string,
) => {
  const candidates = items.flatMap((item, itemIndex) => {
    const exactMatches = [
      item.to,
      ...(item.children || []).map((child) => child.to),
    ]
      .map((target) => getNavigationTargetMatch(target, pathname, search))
      .filter((match): match is NonNullable<typeof match> => Boolean(match));
    if (exactMatches.length > 0) {
      exactMatches.sort(
        (left, right) =>
          right.pathLength - left.pathLength ||
          right.queryCount - left.queryCount,
      );
      return [{ item, itemIndex, ...exactMatches[0], exact: true }];
    }
    if (!isNavigationItemActive(item, pathname, search)) return [];
    const prefixLength = Math.max(
      0,
      ...item.matchPrefixes
        .filter(
          (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
        )
        .map((prefix) => prefix.length),
    );
    return [
      {
        item,
        itemIndex,
        pathLength: prefixLength,
        queryCount: item.query ? Object.keys(item.query).length : 0,
        exact: false,
      },
    ];
  });

  candidates.sort(
    (left, right) =>
      Number(right.exact) - Number(left.exact) ||
      right.pathLength - left.pathLength ||
      right.queryCount - left.queryCount ||
      left.itemIndex - right.itemIndex,
  );
  return candidates[0]?.item.id || null;
};
