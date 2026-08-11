import type { UserData } from "../types";
import {
  canAccessTeacherDashboard,
  canManageSettings,
  canReadLessonManagement,
  canReadPoints,
  canReadQuizManagement,
  canReadStudentList,
  isTeacherUser,
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

export interface ShellNavigationItem {
  id: string;
  label: string;
  shortLabel?: string;
  to: string;
  iconPath: string;
  matchPrefixes: string[];
  query?: Record<string, string>;
  children?: Array<{
    label: string;
    to: string;
    description?: string;
  }>;
  allowed?: (
    userData: Partial<UserData> | null | undefined,
    email?: string | null,
  ) => boolean;
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

export const STUDENT_GLOBAL_NAVIGATION: ShellNavigationItem[] = [
  {
    id: "student-today",
    label: "오늘",
    to: "/student/dashboard",
    iconPath: ICONS.home,
    matchPrefixes: ["/student/dashboard"],
  },
  {
    id: "student-learning",
    label: "학습",
    to: "/student/lesson/note",
    iconPath: ICONS.learning,
    matchPrefixes: ["/student/lesson"],
    children: [
      { label: "수업 자료", to: "/student/lesson/note" },
      { label: "역사 사전", to: "/student/lesson/history-dictionary" },
      { label: "지도", to: "/student/lesson/maps" },
      { label: "생각모아", to: "/student/lesson/think-cloud" },
    ],
  },
  {
    id: "student-assessment",
    label: "평가",
    to: "/student/quiz",
    iconPath: ICONS.assessment,
    matchPrefixes: [
      "/student/quiz",
      "/student/history-classroom",
      "/student/history",
    ],
    children: [
      { label: "문제 풀이", to: "/student/quiz" },
      { label: "역사교실", to: "/student/history-classroom" },
      { label: "정기시험 답안", to: "/student/history" },
    ],
  },
  {
    id: "student-grade",
    label: "성적",
    to: "/student/score",
    iconPath: ICONS.grade,
    matchPrefixes: ["/student/score"],
    children: [
      { label: "예상 성적", to: "/student/score" },
      { label: "성적 리포트", to: "/student/score/report" },
      { label: "수행평가", to: "/student/score/performance" },
      { label: "정기시험", to: "/student/score/written-exam" },
    ],
  },
  {
    id: "student-more",
    label: "더보기",
    to: "/student/mypage",
    iconPath: ICONS.more,
    matchPrefixes: ["/student/points", "/student/calendar", "/student/mypage"],
    children: [
      {
        label: "내 위스",
        to: "/student/points",
        description: "잔액, 거래, 상점, 주문을 확인합니다.",
      },
      {
        label: "전체 일정",
        to: "/student/calendar",
        description: "이번 학기 일정을 한눈에 봅니다.",
      },
      {
        label: "역사 사전",
        to: "/student/lesson/history-dictionary",
        description: "역사 용어와 내가 정리한 뜻을 찾습니다.",
      },
      {
        label: "지난 학기",
        to: "/student/mypage/archive",
        description: "읽기 전용으로 제공되는 지난 기록의 상태를 확인합니다.",
      },
      {
        label: "마이페이지",
        to: "/student/mypage",
        description: "내 정보와 현재 학적을 확인합니다.",
      },
    ],
  },
];

export const TEACHER_GLOBAL_NAVIGATION: ShellNavigationItem[] = [
  {
    id: "teacher-home",
    label: "업무 홈",
    shortLabel: "홈",
    to: "/teacher/dashboard",
    iconPath: ICONS.home,
    matchPrefixes: ["/teacher/dashboard"],
    allowed: canAccessTeacherDashboard,
  },
  {
    id: "teacher-students",
    label: "학생과 학급",
    shortLabel: "학생",
    to: "/teacher/students",
    iconPath: ICONS.students,
    matchPrefixes: ["/teacher/students"],
    allowed: canReadStudentList,
  },
  {
    id: "teacher-learning",
    label: "수업 운영",
    shortLabel: "수업",
    to: "/teacher/lesson",
    iconPath: ICONS.learning,
    matchPrefixes: ["/teacher/lesson"],
    allowed: canReadLessonManagement,
  },
  {
    id: "teacher-assessment",
    label: "평가 운영",
    shortLabel: "평가",
    to: "/teacher/quiz",
    iconPath: ICONS.assessment,
    matchPrefixes: ["/teacher/quiz"],
    allowed: canReadQuizManagement,
  },
  {
    id: "teacher-grade",
    label: "성적 운영",
    shortLabel: "성적",
    to: "/teacher/exam",
    iconPath: ICONS.grade,
    matchPrefixes: ["/teacher/exam"],
    allowed: isTeacherUser,
  },
  {
    id: "teacher-points",
    label: "위스 운영",
    shortLabel: "위스",
    to: "/teacher/points",
    iconPath: ICONS.points,
    matchPrefixes: ["/teacher/points"],
    allowed: canReadPoints,
  },
  {
    id: "teacher-schedule",
    label: "일정과 소통",
    shortLabel: "일정",
    to: "/teacher/schedule",
    iconPath: ICONS.schedule,
    matchPrefixes: ["/teacher/schedule"],
    allowed: canManageSettings,
  },
  {
    id: "teacher-admin",
    label: "관리자",
    shortLabel: "관리",
    to: "/teacher/settings",
    iconPath: ICONS.settings,
    matchPrefixes: ["/teacher/settings"],
    allowed: canManageSettings,
  },
];

export const ROUTE_METADATA: RouteMetadata[] = [
  {
    id: "student-dashboard",
    path: "/student/dashboard",
    title: "오늘",
    shortTitle: "오늘",
    description: "지금 확인할 일정과 내 상태를 살펴보세요.",
    portal: "student",
    navigationId: "student-today",
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
    navigationId: "student-assessment",
  },
  {
    id: "student-points",
    path: "/student/points",
    title: "내 위스",
    shortTitle: "위스",
    description: "이번 학기 위스와 거래, 주문을 확인하세요.",
    portal: "student",
    navigationId: "student-more",
  },
  {
    id: "student-calendar",
    path: "/student/calendar",
    title: "전체 일정",
    shortTitle: "일정",
    description: "수업과 학교 일정을 확인하세요.",
    portal: "student",
    navigationId: "student-more",
  },
  {
    id: "student-mypage",
    path: "/student/mypage",
    title: "마이페이지",
    shortTitle: "마이페이지",
    description: "내 정보와 현재 학적을 확인하세요.",
    portal: "student",
    navigationId: "student-more",
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
