import React, { useEffect, useRef, useState } from "react";
import {
  AuthError,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import {
  auth,
  authPersistenceReady,
  configuredAuthDomain,
  db,
  getFirebaseFunctions,
} from "../lib/firebase";
import { InlineLoading, PageLoading } from "../components/common/LoadingState";
import { markLoginPerf, measureLoginPerf } from "../lib/loginPerf";
import { isSemesterArchive } from "../lib/semesterArchive";
import AuthRecoveryState from "../components/common/AuthRecoveryState";
import { isStudentRegistrationPending } from "../lib/studentRegistrationStatus";
import { readSiteSettingDoc } from "../lib/siteSettings";
import {
  readLocalOnly,
  readStorage,
  removeStorage,
  writeLocalOnly,
  writeStorage,
} from "../lib/safeStorage";
import { useAuth } from "../contexts/AuthContext";
import type { UserData } from "../types";
import {
  canAccessTeacherPortal,
  getDefaultTeacherRoute,
  isAdminUser,
  normalizeStaffPermissions,
} from "../lib/permissions";

import PublicEntry from "../components/public-entry/PublicEntry";

const TEACHER_EMAIL = "westoria28@gmail.com";
const ALLOWED_SCHOOL_EMAIL_DOMAIN = "yongshin-ms.ms.kr";
const ROLE_SESSION_KEY = "westoryPortalRole";
const PENDING_LOGIN_MODE_KEY = "westoryPendingLoginMode";
const REDIRECT_ATTEMPT_KEY = "westoryRedirectAttempt";
const REDIRECT_ATTEMPT_MAX_AGE_MS = 10 * 60 * 1000;
type LoginMode = "student" | "teacher";
const staleLoginError = () =>
  Object.assign(new Error("로그인 상태가 변경되었습니다."), {
    code: "auth/stale-attempt",
  });
const awaitLoginNetwork = async <T,>(promise: Promise<T>): Promise<T> => {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () =>
            reject(
              Object.assign(new Error("로그인 응답이 지연되고 있습니다."), {
                code: "auth/startup-timeout",
              }),
            ),
          15000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
};

interface SchoolOption {
  value: string;
  label: string;
}

interface StudentProfileForm {
  email: string;
  grade: string;
  className: string;
  number: string;
  name: string;
}

interface ConsentItem {
  id: string;
  title: string;
  text: string;
  required: boolean;
  order: number;
}

interface StudentOnboardingResult {
  name: string;
  grade: string;
  classValue: string;
  number: string;
  privacyAgreed: boolean;
  consentAgreedItems: string[];
  newlyAgreedPrivacy: boolean;
  shouldPersistProfile: boolean;
  profileIncomplete: boolean;
}

const defaultGradeOptions: SchoolOption[] = [
  { value: "1", label: "1학년" },
  { value: "2", label: "2학년" },
  { value: "3", label: "3학년" },
];

const defaultClassOptions: SchoolOption[] = Array.from(
  { length: 12 },
  (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}반`,
  }),
);
const defaultNumberOptions: SchoolOption[] = Array.from(
  { length: 40 },
  (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}번`,
  }),
);

const getSavedRole = (): LoginMode | null => {
  const saved = readStorage(ROLE_SESSION_KEY);
  return saved === "teacher" || saved === "student" ? saved : null;
};

const readPendingLoginMode = (): LoginMode | null => {
  const saved = readStorage(PENDING_LOGIN_MODE_KEY);
  return saved === "teacher" || saved === "student" ? saved : null;
};
const normalizeEmail = (value: unknown): string =>
  String(value || "")
    .trim()
    .toLowerCase();
const hasOwnField = (value: object | null | undefined, key: string): boolean =>
  !!value && Object.prototype.hasOwnProperty.call(value, key);
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const getDdayCount = (dateKey: string): number | null => {
  const match = String(dateKey || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const targetDate = new Date(year, month - 1, day);
  if (
    targetDate.getFullYear() !== year ||
    targetDate.getMonth() !== month - 1 ||
    targetDate.getDate() !== day
  ) {
    return null;
  }

  const today = new Date();
  const targetUtc = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  return Math.round((targetUtc - todayUtc) / DAY_IN_MS);
};

const formatDdayCount = (count: number): string => {
  if (count > 0) return `D-${count}`;
  if (count < 0) return `D+${Math.abs(count)}`;
  return "D-Day";
};

const formatDdayDate = (dateKey: string): string =>
  String(dateKey || "").replace(/-/g, ".");

const isAllowedLoginEmail = (email: unknown): boolean => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;
  return (
    normalizedEmail === TEACHER_EMAIL ||
    normalizedEmail.endsWith(`@${ALLOWED_SCHOOL_EMAIL_DOMAIN}`)
  );
};

const normalizeSchoolField = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.match(/\d+/)?.[0] || "";
  if (!digits) return raw;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return String(parsed);
};

const sanitizeStudentNameInput = (value: unknown): string => {
  return String(value ?? "")
    .replace(/[^\u1100-\u11FF\u3130-\u318F가-힣]/g, "")
    .slice(0, 4);
};

const hasEnglishStudentNameInput = (value: unknown): boolean => {
  return /[A-Za-z]/.test(String(value ?? ""));
};

const normalizeStudentName = (value: unknown): string => {
  return String(value ?? "")
    .replace(/[^\u1100-\u11FF\u3130-\u318F가-힣]/g, "")
    .replace(/[\u1100-\u11FF\u3130-\u318F]/g, "")
    .slice(0, 4);
};

const isValidStudentName = (value: string): boolean => {
  return /^[가-힣]{2,4}$/.test(value);
};

const isValidStudentNumber = (value: string): boolean => {
  const parsed = Number(value);
  return (
    Number.isInteger(parsed) &&
    parsed >= 1 &&
    parsed <= defaultNumberOptions.length
  );
};

const hasCompleteStudentProfile = (value?: Partial<UserData> | null) => {
  const name = normalizeStudentName(value?.name);
  const grade = normalizeSchoolField(value?.grade);
  const classValue = normalizeSchoolField(value?.class);
  const number = normalizeSchoolField(value?.number);

  return (
    !!name &&
    !!grade &&
    !!classValue &&
    !!number &&
    isValidStudentName(name) &&
    isValidStudentNumber(number)
  );
};

const isReturningConfirmedStudent = (value?: Partial<UserData> | null) => {
  return (
    value?.role === "student" &&
    value?.privacyAgreed === true &&
    hasCompleteStudentProfile(value)
  );
};

const isStudentBootstrapReadyForRoute = (value?: Partial<UserData> | null) => {
  return isReturningConfirmedStudent(value);
};

const shouldLookupStudentRosterProfile = (value?: Partial<UserData> | null) => {
  return !hasCompleteStudentProfile(value);
};

const getExistingConsentItems = (
  value?: Partial<UserData> | null,
): string[] => {
  if (!Array.isArray(value?.consentAgreedItems)) return [];
  return value.consentAgreedItems
    .filter((item): item is string => typeof item === "string")
    .sort();
};

const areSameStringLists = (left: string[] = [], right: string[] = []) => {
  if (left.length !== right.length) return false;

  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.every((item, index) => item === normalizedRight[index]);
};

const resolveTeacherPortalEnabled = (
  role: UserData["role"],
  existing: Partial<UserData> | null,
) =>
  role === "teacher"
    ? true
    : role === "staff"
      ? existing?.teacherPortalEnabled === true
      : false;

const shouldBlockUserProfileWrite = ({
  existing,
  nextRole,
  nextStaffPermissions,
  nextTeacherPortalEnabled,
  onboardingResult,
}: {
  existing: Partial<UserData> | null;
  nextRole: UserData["role"];
  nextStaffPermissions: UserData["staffPermissions"];
  nextTeacherPortalEnabled: boolean;
  onboardingResult?: StudentOnboardingResult | null;
}) => {
  if (!existing) return true;
  if (existing.role !== nextRole) return true;
  if ((existing.teacherPortalEnabled === true) !== nextTeacherPortalEnabled)
    return true;
  if (
    !areSameStringLists(
      normalizeStaffPermissions(existing.staffPermissions),
      normalizeStaffPermissions(nextStaffPermissions),
    )
  ) {
    return true;
  }

  if (nextRole !== "student" || !onboardingResult) return false;
  if (
    onboardingResult.shouldPersistProfile ||
    onboardingResult.newlyAgreedPrivacy
  )
    return true;
  if ((existing.privacyAgreed === true) !== onboardingResult.privacyAgreed)
    return true;

  return !areSameStringLists(
    getExistingConsentItems(existing),
    onboardingResult.consentAgreedItems,
  );
};

const scheduleDeferredUserMerge = (
  userRef: ReturnType<typeof doc>,
  payload: Record<string, unknown>,
  label: string,
  stillCurrent: () => boolean,
) => {
  const run = () => {
    if (!stillCurrent()) return;
    void setDoc(userRef, payload, { merge: true }).catch(() => {
      console.warn(`[Auth] Deferred ${label} merge failed`);
    });
  };

  if (typeof window === "undefined") {
    run();
    return;
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    idleWindow.requestIdleCallback(run, { timeout: 1500 });
    return;
  }

  window.setTimeout(run, 0);
};

const pickStudentRosterProfile = async (
  email: string,
): Promise<Partial<UserData> | null> => {
  if (!email) return null;

  try {
    const snap = await getDocs(
      query(collection(db, "users"), where("email", "==", email), limit(20)),
    );
    let best: Partial<UserData> | null = null;
    let bestScore = -1;

    snap.forEach((docSnap) => {
      const data = docSnap.data() as Partial<UserData>;
      if (data.role !== "student") return;

      const grade = normalizeSchoolField(data.grade);
      const className = normalizeSchoolField(data.class);
      const number = normalizeSchoolField(data.number);
      const name = (data.name || "").trim();
      const score =
        (grade && className ? 100 : 0) + (name ? 10 : 0) + (number ? 1 : 0);

      if (score > bestScore) {
        bestScore = score;
        best = {
          name,
          grade,
          class: className,
          number,
          customNameConfirmed: data.customNameConfirmed === true,
          privacyAgreed: data.privacyAgreed === true,
          consentAgreedItems: Array.isArray(data.consentAgreedItems)
            ? data.consentAgreedItems
            : [],
        };
      }
    });

    return best;
  } catch (error) {
    console.warn("Failed to read student roster profile");
    return null;
  }
};

const isLikelyInAppBrowser = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /(KAKAOTALK|FBAN|FBAV|Instagram|Line|NAVER|DaumApps|; wv\)|WebView|Electron|Codex|ChatGPT|CEF|HeadlessChrome)/i.test(
    ua,
  );
};

const isIOSDevice = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  );
};

const isAndroidDevice = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android/i.test(ua);
};

const isSafariBrowser = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isSafariEngine = /Safari/i.test(ua);
  const isNonSafariBrowser =
    /(Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|OPT\/|OPiOS|SamsungBrowser|DuckDuckGo|YaBrowser|Whale|Firefox|FxiOS)/i.test(
      ua,
    );
  return isSafariEngine && !isNonSafariBrowser;
};

const isRestrictedInAppBrowser = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /(NAVER|KAKAOTALK)/i.test(ua);
};

const isLocalAuthHost = (): boolean => {
  if (typeof window === "undefined") return false;
  return /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
};

const shouldPreferRedirectLogin = (): boolean => {
  if (isLocalAuthHost()) return false;
  if (
    isSafariBrowser() ||
    isIOSDevice() ||
    isAndroidDevice() ||
    isLikelyInAppBrowser()
  )
    return true;
  if (typeof navigator === "undefined" || typeof window === "undefined")
    return true;
  const ua = navigator.userAgent || "";
  // Android tablets in desktop mode report Linux, including with a mouse.
  // Only positively identified non-touch Windows/macOS desktops use popups.
  if (!/(Windows NT|Macintosh)/i.test(ua) || navigator.maxTouchPoints !== 0)
    return true;
  try {
    if (
      typeof window.matchMedia !== "function" ||
      window.matchMedia("(any-pointer: coarse)").matches ||
      !window.matchMedia("(pointer: fine)").matches ||
      !window.matchMedia("(hover: hover)").matches
    )
      return true;
  } catch {
    return true;
  }
  // Embedded/unknown browsers keep the redirect workaround for lost openers.
  // Regular desktop browsers retain the loaded app across the Google chooser.
  const webViewBridge = (window as Window & { chrome?: { webview?: unknown } })
    .chrome?.webview;
  if (webViewBridge || window.self !== window.top || /Mobile/i.test(ua))
    return true;
  return !/(Chrome|Chromium|Edg|Firefox)\//i.test(ua);
};

const markRedirectAttempt = (mode: LoginMode) => {
  writeLocalOnly(
    REDIRECT_ATTEMPT_KEY,
    JSON.stringify({ mode, startedAt: Date.now() }),
  );
};

const readRedirectAttemptMode = (): LoginMode | null => {
  const raw = readLocalOnly(REDIRECT_ATTEMPT_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { mode?: LoginMode; startedAt?: number };
    const mode =
      parsed.mode === "teacher" || parsed.mode === "student"
        ? parsed.mode
        : null;
    const startedAt =
      typeof parsed.startedAt === "number" ? parsed.startedAt : 0;
    if (
      !mode ||
      !startedAt ||
      Date.now() - startedAt > REDIRECT_ATTEMPT_MAX_AGE_MS
    ) {
      removeStorage(REDIRECT_ATTEMPT_KEY);
      return null;
    }
    return mode;
  } catch {
    removeStorage(REDIRECT_ATTEMPT_KEY);
    return null;
  }
};

const clearRedirectAttempt = () => {
  removeStorage(REDIRECT_ATTEMPT_KEY);
};

const shouldReuseCurrentUserForRedirect = (
  savedMode: LoginMode | null,
  redirectMode: LoginMode | null,
): boolean => {
  if (redirectMode) return true;
  return !!savedMode && (isIOSDevice() || isSafariBrowser());
};

const shouldResolveRedirectOnBoot = (): boolean => {
  const redirectMode = readRedirectAttemptMode();
  if (redirectMode) return true;
  if (isIOSDevice()) return true;
  return !!readPendingLoginMode() && isSafariBrowser();
};

const getRedirectStartMessage = (mode: LoginMode): string => {
  if (mode === "teacher") {
    return "Google 계정 선택 화면으로 이동합니다. 관리자 계정을 선택한 뒤 잠시만 기다려주세요.";
  }

  if (isAndroidDevice()) {
    return `Google 계정 선택 화면으로 이동합니다. 갤럭시탭에서는 기기에 등록된 학교 계정(@${ALLOWED_SCHOOL_EMAIL_DOMAIN})이 보이면 바로 선택해주세요.`;
  }

  if (isIOSDevice()) {
    return "Google 계정 선택 화면으로 이동합니다. iPhone/iPad에서는 화면이 바뀐 뒤 뒤로가기를 누르지 말고 잠시만 기다려주세요.";
  }

  return `Google 계정 선택 화면으로 이동합니다. 학교 계정(@${ALLOWED_SCHOOL_EMAIL_DOMAIN})을 선택한 뒤 잠시만 기다려주세요.`;
};

const getUnauthorizedEmailNotice = (email?: string | null): string => {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    return `${normalizedEmail}은 사용할 수 없습니다. 학교 계정(@${ALLOWED_SCHOOL_EMAIL_DOMAIN})으로 다시 로그인해주세요.`;
  }
  return `학교 계정(@${ALLOWED_SCHOOL_EMAIL_DOMAIN})으로만 로그인할 수 있습니다.`;
};

const getStudentBootstrapFailureMessage = (error?: unknown): string => {
  const code = (error as Partial<AuthError>)?.code || "";

  if (code === "permission-denied") {
    return "로그인은 되었지만 학생 정보 자동 확인에 실패했습니다. 현재 계정이 맞으면 선생님에게 학년/반/번호 확인을 요청하세요. 계정이 다르면 다른 계정으로 다시 로그인하세요.";
  }

  return "학생 정보 확인 중 오류가 발생했습니다. 다시 시도해주세요.";
};

const buildGoogleProvider = () => {
  const provider = new GoogleAuthProvider();
  // Keep chooser-first behavior even when Chrome/Android already has Google
  // accounts cached on the device. Domain/role checks still run after sign-in.
  provider.setCustomParameters({
    prompt: "select_account",
  });
  return provider;
};

const getLoginFailureMessage = (error?: unknown): string => {
  const code = (error as Partial<AuthError>)?.code || "";

  if (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request"
  ) {
    return "로그인이 취소되었습니다. 다시 로그인할 수 있습니다.";
  }

  if (isIOSDevice() && hasCrossOriginAuthDomain()) {
    return "현재 서비스 도메인과 Firebase 인증 도메인이 달라 iPhone에서 로그인 세션이 복구되지 않고 있습니다. Firebase Authentication의 authDomain을 현재 도메인으로 맞추거나 동일 사이트 프록시 설정을 확인해주세요.";
  }

  if (code === "auth/unauthorized-domain") {
    return "현재 접속한 도메인이 로그인 허용 목록에 아직 반영되지 않았습니다. 잠시 후 다시 시도해주세요.";
  }

  if (code === "auth/popup-blocked") {
    return "브라우저가 로그인 팝업을 차단했습니다. 다시 시도하거나 리다이렉트 로그인을 사용해주세요.";
  }

  if (code === "permission-denied") {
    return getStudentBootstrapFailureMessage(error);
  }

  if (isIOSDevice() && isLikelyInAppBrowser()) {
    return "iPhone 앱 내부 브라우저에서는 구글 로그인이 정상 유지되지 않을 수 있습니다. Safari에서 위스토리를 연 뒤 다시 로그인해주세요.";
  }

  if (isSafariBrowser()) {
    return "Safari에서 로그인 팝업이 열리지 않으면 다시 시도하거나 Safari 설정을 확인해주세요.";
  }

  if (isIOSDevice()) {
    return "iPhone 또는 iPad에서는 Chrome에서 직접 로그인해보시고, 계속 실패하면 Safari에서 다시 시도해주세요.";
  }

  if (code) {
    return `로그인에 실패했습니다. (${code})`;
  }

  return "로그인에 실패했습니다. 브라우저를 새로고침한 뒤 다시 시도해주세요.";
};

const hasCrossOriginAuthDomain = (): boolean => {
  if (typeof window === "undefined") return false;
  const currentHost = window.location.hostname;
  if (!currentHost) return false;
  if (/^(localhost|127\.0\.0\.1)$/.test(currentHost)) return false;
  return currentHost !== configuredAuthDomain;
};

const isPopupFallbackError = (error: unknown): boolean => {
  const code = (error as Partial<AuthError>)?.code || "";
  return [
    "auth/popup-blocked",
    "auth/operation-not-supported-in-this-environment",
    "auth/internal-error",
    "auth/network-request-failed",
  ].includes(code);
};

const shouldFallbackToRedirectLogin = (error: unknown): boolean => {
  const code = (error as Partial<AuthError>)?.code || "";
  if (!isLocalAuthHost()) return isPopupFallbackError(error);
  return (
    code === "auth/popup-blocked" ||
    code === "auth/operation-not-supported-in-this-environment"
  );
};

const isIgnorableRedirectError = (error: unknown): boolean => {
  const code = (error as Partial<AuthError>)?.code || "";
  return [
    "auth/missing-initial-state",
    "auth/no-auth-event",
    "auth/null-user",
  ].includes(code);
};

const Login: React.FC = () => {
  const {
    currentUser: verifiedUser,
    onboardingUser,
    userData,
    interfaceConfig,
    loading,
    authPhase,
    authError,
    authGeneration,
    retryAuth,
    logout,
    beginLoginFlow,
    isLoginFlowCurrent,
    failLoginFlow,
    abandonLoginFlow,
    discardStaleLoginUser,
    claimLoginBootstrap,
    isAuthAttemptCurrent,
    assertAuthAttemptCurrent,
    waitForAuthProfile,
  } = useAuth();
  const currentUser = verifiedUser || onboardingUser;
  // The classic presentation is retained for a quick, local rollback.
  const classicEntry =
    new URLSearchParams(window.location.search).get("entry") === "classic";
  const navigate = useNavigate();
  const restrictedInAppBrowser = isRestrictedInAppBrowser();
  const ddayTitle = String(interfaceConfig?.ddayTitle || "").trim();
  const ddayDate = String(interfaceConfig?.ddayDate || "").trim();
  const ddayCount =
    interfaceConfig?.ddayEnabled && ddayTitle && ddayDate
      ? getDdayCount(ddayDate)
      : null;

  const [authBusy, setAuthBusy] = useState(false);
  const [loginNotice, setLoginNotice] = useState("");
  const [redirectRecoveryPending, setRedirectRecoveryPending] = useState(() =>
    shouldResolveRedirectOnBoot(),
  );

  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyTitle, setPolicyTitle] = useState("");
  const [policyHtml, setPolicyHtml] = useState("");
  const [policyLoading, setPolicyLoading] = useState(false);

  const [gradeOptions, setGradeOptions] =
    useState<SchoolOption[]>(defaultGradeOptions);
  const [classOptions, setClassOptions] =
    useState<SchoolOption[]>(defaultClassOptions);

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileForm, setProfileForm] = useState<StudentProfileForm>({
    email: "",
    grade: defaultGradeOptions[0].value,
    className: "",
    number: "",
    name: "",
  });
  const [profileNameInputWarning, setProfileNameInputWarning] = useState(false);
  const profileNameAlertedRef = useRef(false);
  const profileResolverRef = useRef<
    ((value: StudentProfileForm | null) => void) | null
  >(null);

  const [consentModalOpen, setConsentModalOpen] = useState(false);
  const [consentItems, setConsentItems] = useState<ConsentItem[]>([]);
  const [consentChecked, setConsentChecked] = useState<Record<string, boolean>>(
    {},
  );
  const [consentExpandedId, setConsentExpandedId] = useState<string | null>(
    null,
  );
  const [consentReadReady, setConsentReadReady] = useState<
    Record<string, boolean>
  >({});
  const consentResolverRef = useRef<((value: string[] | null) => void) | null>(
    null,
  );
  const redirectResultRef = useRef<ReturnType<typeof getRedirectResult> | null>(
    null,
  );
  const modalGenerationRef = useRef<number | null>(null);
  const resumeFlowRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const actionVersionRef = useRef(0);
  const activeActionFlowRef = useRef<number | null>(null);
  const autoResumeUidRef = useRef<string | null>(null);
  const authActionLockRef = useRef(false);
  const preferredRole = getSavedRole();
  const canUseTeacherPortal = canAccessTeacherPortal(
    userData,
    currentUser?.email || "",
  );
  const isTeacherUser = canUseTeacherPortal;

  const forceRoute = (
    targetPath: string,
    user: User,
    generation: number,
    flow?: number,
  ) => {
    const current = () =>
      isAuthAttemptCurrent(generation, user) &&
      (flow === undefined || isLoginFlowCurrent(flow));
    if (!current()) return;
    navigate(targetPath, { replace: true });

    if (typeof window === "undefined") return;

    window.setTimeout(() => {
      if (!current()) return;
      const desiredHash = `#${targetPath}`;
      if (window.location.hash !== desiredHash) {
        window.location.replace(
          `${window.location.pathname}${window.location.search}${desiredHash}`,
        );
      }
    }, 80);
  };

  const clearRoleCache = () => {
    removeStorage(ROLE_SESSION_KEY);
  };

  const saveRoleCache = (role: LoginMode) => {
    writeStorage(ROLE_SESSION_KEY, role);
  };

  const setPendingLoginMode = (mode: LoginMode) => {
    writeStorage(PENDING_LOGIN_MODE_KEY, mode);
  };

  const getPendingLoginMode = (): LoginMode | null => readPendingLoginMode();

  const clearPendingLoginMode = () => {
    removeStorage(PENDING_LOGIN_MODE_KEY);
  };

  const rejectUnauthorizedEmailLogin = async (email?: string | null) => {
    clearPendingLoginMode();
    clearRoleCache();
    clearRedirectAttempt();
    autoResumeUidRef.current = null;
    setLoginNotice(getUnauthorizedEmailNotice(email));
    await logout();
  };

  useEffect(() => {
    if (isSemesterArchive) return;
    // Prepare code while the chooser is still idle; never open a server session
    // before an interactive credential has passed through the existing gates.
    void getFirebaseFunctions().catch(() => undefined);
    const connections = [
      "https://accounts.google.com",
      "https://apis.google.com",
    ].map((href) => {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = href;
      document.head.appendChild(link);
      return link;
    });
    return () => connections.forEach((link) => link.remove());
  }, []);

  useEffect(() => {
    if (
      modalGenerationRef.current === null ||
      modalGenerationRef.current === authGeneration
    )
      return;
    modalGenerationRef.current = null;
    profileResolverRef.current?.(null);
    consentResolverRef.current?.(null);
    profileResolverRef.current = null;
    consentResolverRef.current = null;
    setProfileModalOpen(false);
    setConsentModalOpen(false);
    setProfileForm({
      email: "",
      name: "",
      grade: "",
      className: "",
      number: "",
    });
    setConsentItems([]);
  }, [authGeneration]);

  useEffect(() => {
    const loadSchoolConfig = async () => {
      try {
        const data = await readSiteSettingDoc<{
          grades?: Array<{ value?: string; label?: string }>;
          classes?: Array<{ value?: string; label?: string }>;
        }>("school_config");
        if (!data) return;

        if (Array.isArray(data.grades) && data.grades.length > 0) {
          const nextGrades = data.grades
            .map((item) => ({
              value: normalizeSchoolField(item.value),
              label: (item.label || "").trim(),
            }))
            .filter((item) => item.value && item.label);
          if (nextGrades.length > 0) {
            setGradeOptions(nextGrades);
          }
        }

        if (Array.isArray(data.classes) && data.classes.length > 0) {
          const nextClasses = data.classes
            .map((item) => ({
              value: normalizeSchoolField(item.value),
              label: (item.label || "").trim(),
            }))
            .filter((item) => item.value && item.label);
          if (nextClasses.length > 0) {
            setClassOptions(nextClasses);
          }
        }
      } catch (error) {
        console.warn("Failed to load school config");
      }
    };

    void loadSchoolConfig();
  }, []);

  useEffect(() => {
    if (
      loading &&
      (resumeFlowRef.current === null ||
        !isLoginFlowCurrent(resumeFlowRef.current))
    ) {
      const flow = beginLoginFlow(true);
      if (flow >= 0) resumeFlowRef.current = flow;
    }
  }, [loading, authGeneration, beginLoginFlow, isLoginFlowCurrent]);

  useEffect(() => {
    if (
      activeActionFlowRef.current !== null &&
      !isLoginFlowCurrent(activeActionFlowRef.current)
    ) {
      actionVersionRef.current += 1;
      activeActionFlowRef.current = null;
      authActionLockRef.current = false;
      setAuthBusy(false);
      setRedirectRecoveryPending(false);
    }
  }, [authGeneration, isLoginFlowCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionVersionRef.current += 1;
      if (resumeFlowRef.current !== null)
        abandonLoginFlow(resumeFlowRef.current);
      if (profileResolverRef.current) {
        profileResolverRef.current(null);
        profileResolverRef.current = null;
      }
      if (consentResolverRef.current) {
        consentResolverRef.current(null);
        consentResolverRef.current = null;
      }
    };
  }, []);

  const openProfileModal = (
    initial: StudentProfileForm,
  ): Promise<StudentProfileForm | null> => {
    const normalizedNumber = normalizeSchoolField(initial.number);
    profileNameAlertedRef.current = false;
    setProfileNameInputWarning(false);
    setProfileForm({
      ...initial,
      name: normalizeStudentName(initial.name),
      number: isValidStudentNumber(normalizedNumber) ? normalizedNumber : "",
    });
    setProfileModalOpen(true);
    return new Promise((resolve) => {
      profileResolverRef.current = resolve;
    });
  };

  const closeProfileModal = (result: StudentProfileForm | null) => {
    setProfileModalOpen(false);
    setProfileNameInputWarning(false);
    profileNameAlertedRef.current = false;
    const resolver = profileResolverRef.current;
    profileResolverRef.current = null;
    resolver?.(result);
  };

  const handleProfileNameChange = (value: string) => {
    const sanitizedName = sanitizeStudentNameInput(value);
    const hasEnglishInput = hasEnglishStudentNameInput(value);

    setProfileForm((prev) => ({ ...prev, name: sanitizedName }));

    if (!hasEnglishInput) {
      if (sanitizedName) {
        setProfileNameInputWarning(false);
        profileNameAlertedRef.current = false;
      }
      return;
    }

    setProfileNameInputWarning(true);
    if (!profileNameAlertedRef.current) {
      profileNameAlertedRef.current = true;
      alert(
        "영어키로 되어 있어요. 한/영키를 눌러 한글로 바꾼 뒤 이름을 입력해주세요.",
      );
    }
  };

  const handleProfileSubmit = () => {
    const name = normalizeStudentName(profileForm.name);
    const grade = normalizeSchoolField(profileForm.grade);
    const classValue = normalizeSchoolField(profileForm.className);
    const number = normalizeSchoolField(profileForm.number);

    if (!name || !grade || !classValue || !number) {
      alert("이름, 학년, 반, 번호를 모두 입력해주세요.");
      return;
    }
    if (!isValidStudentName(name)) {
      alert("이름은 한글 2~4글자만 입력 가능합니다.");
      return;
    }
    if (!isValidStudentNumber(number)) {
      alert("번호는 드롭다운에서 선택해주세요.");
      return;
    }

    closeProfileModal({
      email: profileForm.email,
      name,
      grade,
      className: classValue,
      number,
    });
  };

  const handleProfileCancel = () => {
    closeProfileModal(null);
  };

  const loadConsentItems = async (): Promise<ConsentItem[]> => {
    try {
      const consentQuery = query(
        collection(db, "site_settings", "consent", "items"),
        orderBy("order", "asc"),
      );
      const snap = await getDocs(consentQuery);
      const items: ConsentItem[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as Partial<ConsentItem>;
        items.push({
          id: docSnap.id,
          title: (data.title || "").trim() || "동의 항목",
          text: data.text || "",
          required: data.required === true,
          order: Number(data.order) || 0,
        });
      });
      return items;
    } catch (error) {
      console.warn("Failed to load consent items");
      return [];
    }
  };

  const openConsentModal = (
    items: ConsentItem[],
    preChecked: string[],
  ): Promise<string[] | null> => {
    if (items.length === 0) {
      return Promise.resolve([]);
    }

    const checkedMap: Record<string, boolean> = {};
    const readMap: Record<string, boolean> = {};
    items.forEach((item) => {
      checkedMap[item.id] = preChecked.includes(item.id);
      readMap[item.id] = preChecked.includes(item.id);
    });

    setConsentItems(items);
    setConsentChecked(checkedMap);
    setConsentReadReady(readMap);
    const firstPending = items.find((item) => !checkedMap[item.id]);
    setConsentExpandedId(firstPending ? firstPending.id : items[0]?.id || null);
    setConsentModalOpen(true);

    return new Promise((resolve) => {
      consentResolverRef.current = resolve;
    });
  };

  const closeConsentModal = (result: string[] | null) => {
    setConsentModalOpen(false);
    setConsentExpandedId(null);
    setConsentReadReady({});
    const resolver = consentResolverRef.current;
    consentResolverRef.current = null;
    resolver?.(result);
  };

  useEffect(() => {
    if (!classicEntry || (!profileModalOpen && !consentModalOpen)) return;
    const dialog = document.querySelector<HTMLElement>("[data-auth-dialog]");
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const controls = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex='0']",
        ),
      ).filter((element) => element.getClientRects().length > 0);
    (
      dialog.querySelector<HTMLElement>(
        "input:not([readonly]), select, button",
      ) || dialog
    ).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (profileModalOpen) closeProfileModal(null);
        else closeConsentModal(null);
      } else if (event.key === "Tab") {
        const targets = controls();
        const first = targets[0],
          last = targets[targets.length - 1];
        if (!first) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        if (!dialog.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [classicEntry, profileModalOpen, consentModalOpen]);

  const consentReady = consentItems
    .filter((item) => item.required)
    .every((item) => consentChecked[item.id]);
  const currentConsentStepIndex = Math.max(
    0,
    consentItems.findIndex((item) => !consentChecked[item.id]),
  );

  const handleConsentConfirm = () => {
    if (!consentReady) {
      alert("필수 동의 항목에 체크해주세요.");
      return;
    }
    const agreedItems = consentItems
      .filter((item) => consentChecked[item.id])
      .map((item) => item.id);
    closeConsentModal(agreedItems);
  };

  const handleConsentCancel = () => {
    closeConsentModal(null);
  };

  const handleConsentScroll = (
    id: string,
    event: React.UIEvent<HTMLDivElement>,
  ) => {
    if (consentReadReady[id]) return;
    const el = event.currentTarget;
    const reachedBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    if (reachedBottom) {
      setConsentReadReady((prev) => ({ ...prev, [id]: true }));
    }
  };

  useEffect(() => {
    if (
      !consentModalOpen ||
      !consentExpandedId ||
      consentReadReady[consentExpandedId]
    )
      return;
    const el = document.getElementById(
      `consent-scroll-${consentExpandedId}`,
    ) as HTMLDivElement | null;
    if (!el) return;
    // If content is shorter than the viewport, treat it as fully read.
    if (el.scrollHeight <= el.clientHeight + 2) {
      setConsentReadReady((prev) => ({ ...prev, [consentExpandedId]: true }));
    }
  }, [consentModalOpen, consentExpandedId, consentReadReady]);

  const handleConsentAgreeItem = (item: ConsentItem, index: number) => {
    if (!consentReadReady[item.id]) {
      alert("약관 내용을 끝까지 읽어주세요.");
      return;
    }

    setConsentChecked((prev) => ({ ...prev, [item.id]: true }));
    const nextItem = consentItems
      .slice(index + 1)
      .find((x) => !consentChecked[x.id]);
    setConsentExpandedId(nextItem ? nextItem.id : null);
  };

  const completeStudentOnboarding = async (
    user: User,
    existing: Partial<UserData> | null,
    rosterProfile: Partial<UserData> | null,
    assertLive: () => Promise<void>,
  ): Promise<StudentOnboardingResult | null> => {
    let resolvedName =
      (existing?.name || "").trim() ||
      (rosterProfile?.name || "").trim() ||
      (user.displayName || "").trim();
    let gradeValue =
      normalizeSchoolField(existing?.grade) ||
      normalizeSchoolField(rosterProfile?.grade);
    let classValue =
      normalizeSchoolField(existing?.class) ||
      normalizeSchoolField(rosterProfile?.class);
    let numberValue =
      normalizeSchoolField(existing?.number) ||
      normalizeSchoolField(rosterProfile?.number);
    const customNameConfirmed = existing?.customNameConfirmed === true;
    const shouldPersistProfile =
      existing?.role !== "student" || !customNameConfirmed;

    const needsProfileInput =
      shouldPersistProfile &&
      (!resolvedName || !gradeValue || !classValue || !numberValue);

    if (needsProfileInput) {
      const profile = await openProfileModal({
        email: user.email || "",
        name: resolvedName,
        grade: gradeValue || gradeOptions[0]?.value || "1",
        className: classValue,
        number: numberValue,
      });

      await assertLive();
      if (!profile) return null;

      resolvedName = normalizeStudentName(profile.name);
      gradeValue = normalizeSchoolField(profile.grade);
      classValue = normalizeSchoolField(profile.className);
      numberValue = normalizeSchoolField(profile.number);
    }

    const profileIncomplete =
      !resolvedName || !gradeValue || !classValue || !numberValue;

    if (shouldPersistProfile && profileIncomplete) {
      alert("학생 정보 입력이 완료되지 않았습니다.");
      return null;
    }
    if (shouldPersistProfile && !isValidStudentName(resolvedName)) {
      alert("이름은 한글 2~4글자만 입력 가능합니다.");
      return null;
    }
    if (shouldPersistProfile && !isValidStudentNumber(numberValue)) {
      alert("번호는 드롭다운에서 선택해주세요.");
      return null;
    }

    const existingConsentItems = Array.isArray(existing?.consentAgreedItems)
      ? existing.consentAgreedItems.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    let privacyAgreed = existing?.privacyAgreed === true;
    let consentAgreedItems = existingConsentItems;

    if (!privacyAgreed) {
      const items = await awaitLoginNetwork(loadConsentItems());
      await assertLive();
      if (items.length === 0) {
        alert(
          "개인정보 동의 항목을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.",
        );
        return null;
      }
      const selected = await openConsentModal(items, existingConsentItems);
      await assertLive();
      if (selected === null) return null;
      privacyAgreed = true;
      consentAgreedItems = selected;
    }

    return {
      name: resolvedName,
      grade: gradeValue,
      classValue,
      number: numberValue,
      privacyAgreed,
      consentAgreedItems,
      newlyAgreedPrivacy: existing?.privacyAgreed !== true && privacyAgreed,
      shouldPersistProfile,
      profileIncomplete,
    };
  };

  const finishLoginForRole = async (
    user: User,
    mode: LoginMode,
    flow: number,
  ) => {
    const assertFlow = () => {
      if (
        !mountedRef.current ||
        !isLoginFlowCurrent(flow) ||
        auth.currentUser !== user
      )
        throw staleLoginError();
    };
    assertFlow();
    markLoginPerf("westory-login-bootstrap-start", {
      mode,
      source: "finish-login",
    });

    if (!isAllowedLoginEmail(user.email)) {
      await rejectUnauthorizedEmailLogin(user.email);
      return;
    }

    const bootstrap = await claimLoginBootstrap(user, flow);
    assertFlow();
    const generation = bootstrap.generation;
    const current = () =>
      isAuthAttemptCurrent(generation, user) && isLoginFlowCurrent(flow);
    const assertLive = async () => {
      assertFlow();
      await assertAuthAttemptCurrent(generation, user);
      assertFlow();
    };
    modalGenerationRef.current = generation;
    const isTeacherEmail = user.email === TEACHER_EMAIL;
    const userRef = doc(db, "users", user.uid);
    const existing = bootstrap.profile;
    if (isStudentRegistrationPending(existing)) {
      clearPendingLoginMode();
      clearRedirectAttempt();
      clearRoleCache();
      return;
    }
    markLoginPerf("westory-login-user-doc-read", {
      exists: !!existing,
      source: "shared-bootstrap",
    });
    const staffPermissions = normalizeStaffPermissions(
      existing?.staffPermissions,
    );
    const canUseTeacherMode =
      isTeacherEmail ||
      canAccessTeacherPortal(
        {
          ...existing,
          role: existing?.role,
          email: user.email || existing?.email || "",
          staffPermissions,
          teacherPortalEnabled: existing?.teacherPortalEnabled === true,
        },
        user.email || "",
      );
    if (mode === "teacher" && !canUseTeacherMode) {
      alert("관리자 로그인은 관리자 계정으로만 가능합니다.");
      clearPendingLoginMode();
      clearRoleCache();
      clearRedirectAttempt();
      await logout();
      return;
    }

    const nextRole: UserData["role"] =
      mode === "teacher"
        ? isAdminUser(existing, user.email || "")
          ? "teacher"
          : "staff"
        : "student";

    const rosterProfile =
      nextRole === "student" && shouldLookupStudentRosterProfile(existing)
        ? await awaitLoginNetwork(pickStudentRosterProfile(user.email || ""))
        : null;
    await assertLive();
    if (nextRole === "student") {
      markLoginPerf("westory-login-roster-profile-read", {
        hit: rosterProfile ? "true" : "false",
        source: "finish-login",
      });
    }

    let resolvedName =
      (existing?.name || "").trim() || (rosterProfile?.name || "").trim();
    let onboardingResult: StudentOnboardingResult | null = null;

    if (nextRole === "student") {
      onboardingResult = await completeStudentOnboarding(
        user,
        existing,
        rosterProfile,
        assertLive,
      );
      await assertLive();
      if (!onboardingResult) {
        clearPendingLoginMode();
        clearRoleCache();
        clearRedirectAttempt();
        await logout();
        return;
      }
      resolvedName = onboardingResult.name;
    } else if (!resolvedName) {
      resolvedName = (user.displayName || "교사").trim() || "교사";
    }

    const shouldPersistStudentProfile =
      nextRole === "student" && onboardingResult?.shouldPersistProfile === true;
    const nextTeacherPortalEnabled = resolveTeacherPortalEnabled(
      nextRole,
      existing,
    );
    const nextStaffPermissions = nextRole === "staff" ? staffPermissions : [];

    const basePayload: Record<string, unknown> = {
      uid: user.uid,
      email: user.email || "",
      photoURL: user.photoURL || "",
      role: nextRole,
      lastLogin: serverTimestamp(),
    };

    // Existing student docs may carry protected teacher portal flags from an
    // older state. Students cannot clear those fields themselves, so
    // rewriting them here turns a successful login into a false
    // permission-denied alert. Mirror the auto-resume path and only write
    // these fields for non-students or first-time student docs.
    if (!existing || nextRole !== "student") {
      basePayload.staffPermissions = nextStaffPermissions;
    }
    if (!existing || nextRole !== "student") {
      basePayload.teacherPortalEnabled = nextTeacherPortalEnabled;
    }
    if (!existing && nextRole === "student") {
      basePayload.registrationApprovalStatus = "PENDING";
    }

    if (
      resolvedName &&
      (nextRole !== "student" || shouldPersistStudentProfile)
    ) {
      basePayload.name = resolvedName;
    }

    if (nextRole === "student") {
      await assertLive();
      if (!onboardingResult) {
        clearPendingLoginMode();
        clearRoleCache();
        clearRedirectAttempt();
        await logout();
        return;
      }
      basePayload.privacyAgreed = onboardingResult.privacyAgreed;
      basePayload.consentAgreedItems = onboardingResult.consentAgreedItems;
      if (onboardingResult.newlyAgreedPrivacy) {
        basePayload.privacyAgreedAt = serverTimestamp();
      }
      if (shouldPersistStudentProfile) {
        basePayload.customNameConfirmed = true;
        basePayload.grade = onboardingResult.grade;
        basePayload.class = onboardingResult.classValue;
        basePayload.number = onboardingResult.number;
      } else if (onboardingResult.profileIncomplete) {
        console.warn(
          "[Auth] Existing student profile is locked for self-edit; skipping profile rewrite during login.",
        );
      }
    }

    const requiresBlockingWrite =
      !existing ||
      shouldBlockUserProfileWrite({
        existing,
        nextRole,
        nextStaffPermissions,
        nextTeacherPortalEnabled,
        onboardingResult,
      });

    await assertLive();
    if (!existing) {
      await awaitLoginNetwork(
        setDoc(
          userRef,
          {
            ...basePayload,
            grade:
              nextRole === "student" && onboardingResult
                ? onboardingResult.grade
                : "",
            class:
              nextRole === "student" && onboardingResult
                ? onboardingResult.classValue
                : "",
            number:
              nextRole === "student" && onboardingResult
                ? onboardingResult.number
                : "",
            createdAt: serverTimestamp(),
          },
          { merge: true },
        ),
      );
    } else if (requiresBlockingWrite) {
      await awaitLoginNetwork(setDoc(userRef, basePayload, { merge: true }));
    }

    await assertLive();
    if (requiresBlockingWrite) {
      await waitForAuthProfile(generation, user, (profile) =>
        Object.entries(basePayload).every(([key, value]) => {
          if (["lastLogin", "privacyAgreedAt"].includes(key)) return true;
          const actual = (profile as unknown as Record<string, unknown>)[key];
          return Array.isArray(value)
            ? Array.isArray(actual) && areSameStringLists(actual, value)
            : actual === value;
        }),
      );
      await assertLive();
    }
    if (!existing && nextRole === "student") {
      clearPendingLoginMode();
      clearRedirectAttempt();
      clearRoleCache();
      return;
    }
    const nextPortalMode: LoginMode =
      nextRole === "student" ? "student" : "teacher";
    const teacherRouteUser: Partial<UserData> = {
      ...existing,
      uid: user.uid,
      email: user.email || existing?.email || "",
      role: nextRole,
      staffPermissions: nextStaffPermissions,
      teacherPortalEnabled: nextTeacherPortalEnabled,
    };
    const targetPath =
      nextPortalMode === "teacher"
        ? getDefaultTeacherRoute(teacherRouteUser, user.email || "")
        : "/student/dashboard";

    markLoginPerf("westory-login-role-resolved", {
      role: nextRole,
      targetPath,
      source: "finish-login",
    });
    saveRoleCache(nextPortalMode);
    clearPendingLoginMode();
    markLoginPerf("westory-login-first-route-decided", {
      targetPath,
      source: "finish-login",
    });
    measureLoginPerf(
      "westory-login-bootstrap",
      "westory-login-bootstrap-start",
      "westory-login-first-route-decided",
    );
    autoResumeUidRef.current = `${generation}:${user.uid}`;
    forceRoute(targetPath, user, generation, flow);

    if (existing && !requiresBlockingWrite) {
      scheduleDeferredUserMerge(
        userRef,
        basePayload,
        `${nextRole}-login`,
        current,
      );
    }
  };

  useEffect(() => {
    if (!redirectRecoveryPending) return;
    let cancelled = false;
    let timer: number | undefined;
    const operation = ++actionVersionRef.current;
    const ownsAction = () =>
      !cancelled &&
      mountedRef.current &&
      actionVersionRef.current === operation;
    const resolveRedirect = async () => {
      setAuthBusy(true);
      markLoginPerf("westory-login-redirect-resume-start");
      try {
        // Keep the acquisition promise across StrictMode effect replay. It is
        // distinct from the server bootstrap and must only consume Firebase's
        // redirect result once.
        redirectResultRef.current ??= authPersistenceReady.then(() =>
          getRedirectResult(auth),
        );
        let result;
        try {
          result = await Promise.race([
            redirectResultRef.current,
            new Promise<never>((_, reject) => {
              timer = window.setTimeout(
                () =>
                  reject(
                    Object.assign(
                      new Error("로그인 응답이 지연되고 있습니다."),
                      { code: "auth/startup-timeout" },
                    ),
                  ),
                15000,
              );
            }),
          ]);
        } catch (error) {
          if (!ownsAction()) return;
          // Recovery is allowed only for redirect acquisition failure; a
          // rejected server handshake is never retried here automatically.
          if (!isIgnorableRedirectError(error)) throw error;
          result = null;
        }
        if (!ownsAction()) return;
        const savedMode = getPendingLoginMode();
        const redirectMode = readRedirectAttemptMode();
        const redirectedUser =
          result?.user ||
          (shouldReuseCurrentUserForRedirect(savedMode, redirectMode)
            ? auth.currentUser
            : null);
        if (!redirectedUser) {
          if (savedMode || redirectMode) {
            clearRedirectAttempt();
            clearPendingLoginMode();
            setLoginNotice(
              "로그인이 취소되었거나 중간에 돌아왔습니다. 다시 로그인해주세요.",
            );
          }
          return;
        }
        const mode: LoginMode =
          savedMode ||
          redirectMode ||
          (redirectedUser.email === TEACHER_EMAIL ? "teacher" : "student");
        const flow =
          resumeFlowRef.current !== null &&
          isLoginFlowCurrent(resumeFlowRef.current)
            ? resumeFlowRef.current
            : beginLoginFlow(true);
        resumeFlowRef.current = flow;
        activeActionFlowRef.current = flow;
        try {
          await finishLoginForRole(redirectedUser, mode, flow);
        } catch (error) {
          if (
            ownsAction() &&
            isLoginFlowCurrent(flow) &&
            (error as Partial<AuthError>)?.code !== "auth/stale-attempt"
          )
            failLoginFlow(flow, error);
          throw error;
        }
        if (!ownsAction() || !isLoginFlowCurrent(flow)) return;
        clearRedirectAttempt();
        setLoginNotice("");
        markLoginPerf("westory-login-redirect-resume-end", { recovered: true });
        measureLoginPerf(
          "westory-redirect-resume",
          "westory-login-redirect-resume-start",
          "westory-login-redirect-resume-end",
        );
      } catch (error) {
        if (
          !ownsAction() ||
          (error as Partial<AuthError>)?.code === "auth/stale-attempt"
        )
          return;
        clearRedirectAttempt();
        clearPendingLoginMode();
        setLoginNotice(getLoginFailureMessage(error));
      } finally {
        if (timer !== undefined) window.clearTimeout(timer);
        if (ownsAction()) {
          activeActionFlowRef.current = null;
          setAuthBusy(false);
          setRedirectRecoveryPending(false);
        }
      }
    };
    void resolveRedirect();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [redirectRecoveryPending]);

  useEffect(() => {
    if (!currentUser) {
      autoResumeUidRef.current = null;
      return;
    }
    if (
      loading ||
      authBusy ||
      redirectRecoveryPending ||
      authPhase === "error" ||
      authPhase === "registration-pending"
    )
      return;
    const key = `${authGeneration}:${currentUser.uid}`;
    if (autoResumeUidRef.current === key) return;
    autoResumeUidRef.current = key;
    void goToDashboard();
  }, [
    authBusy,
    currentUser,
    loading,
    redirectRecoveryPending,
    authPhase,
    authGeneration,
    userData?.role,
  ]);

  const goToDashboard = async () => {
    if (!currentUser || !isAuthAttemptCurrent(authGeneration, currentUser))
      return;
    if (!isAllowedLoginEmail(currentUser.email)) {
      await rejectUnauthorizedEmailLogin(currentUser.email);
      return;
    }
    if (verifiedUser && userData && canUseTeacherPortal) {
      saveRoleCache("teacher");
      clearPendingLoginMode();
      forceRoute(
        getDefaultTeacherRoute(userData, currentUser.email || ""),
        currentUser,
        authGeneration,
      );
      return;
    }
    if (authBusy || authActionLockRef.current) return;
    authActionLockRef.current = true;
    setAuthBusy(true);
    const flow =
      resumeFlowRef.current !== null &&
      isLoginFlowCurrent(resumeFlowRef.current)
        ? resumeFlowRef.current
        : beginLoginFlow(true);
    resumeFlowRef.current = flow;
    const operation = ++actionVersionRef.current;
    activeActionFlowRef.current = flow;
    try {
      await finishLoginForRole(
        currentUser,
        canUseTeacherPortal ? "teacher" : "student",
        flow,
      );
    } catch (error) {
      if (
        !mountedRef.current ||
        actionVersionRef.current !== operation ||
        !isLoginFlowCurrent(flow)
      )
        return;
      if ((error as Partial<AuthError>)?.code !== "auth/stale-attempt") {
        clearPendingLoginMode();
        clearRedirectAttempt();
        failLoginFlow(flow, error);
        setLoginNotice(getStudentBootstrapFailureMessage(error));
      }
    } finally {
      if (actionVersionRef.current === operation) {
        activeActionFlowRef.current = null;
        authActionLockRef.current = false;
        setAuthBusy(false);
      }
    }
  };

  const startGoogleLogin = async (mode: LoginMode) => {
    const flow = beginLoginFlow();
    resumeFlowRef.current = flow;
    const operation = ++actionVersionRef.current;
    activeActionFlowRef.current = flow;
    const assertAcquisition = () => {
      if (
        !mountedRef.current ||
        actionVersionRef.current !== operation ||
        !isLoginFlowCurrent(flow)
      )
        throw staleLoginError();
    };
    let acquired = false;
    const provider = buildGoogleProvider();
    const useRedirect = shouldPreferRedirectLogin();
    setPendingLoginMode(mode);
    setLoginNotice("");
    setAuthBusy(true);
    markLoginPerf("westory-login-requested", { mode });

    try {
      if (useRedirect) {
        await awaitLoginNetwork(authPersistenceReady);
        assertAcquisition();
        markRedirectAttempt(mode);
        console.info("[Auth] Starting Google redirect login", { mode });
        setLoginNotice(getRedirectStartMessage(mode));
        await awaitLoginNetwork(signInWithRedirect(auth, provider));
        return;
      }
      console.info("[Auth] Starting Google popup login", { mode });
      const result = await signInWithPopup(auth, provider);
      acquired = true;
      markLoginPerf("westory-login-popup-credential", { mode });
      if (!mountedRef.current || !isLoginFlowCurrent(flow)) {
        await discardStaleLoginUser(result.user, flow);
        return;
      }
      await awaitLoginNetwork(authPersistenceReady);
      assertAcquisition();
      await finishLoginForRole(result.user, mode, flow);
    } catch (error) {
      if (
        !mountedRef.current ||
        actionVersionRef.current !== operation ||
        !isLoginFlowCurrent(flow)
      )
        return;
      if (!acquired && shouldFallbackToRedirectLogin(error)) {
        try {
          await awaitLoginNetwork(authPersistenceReady);
          assertAcquisition();
          markRedirectAttempt(mode);
          console.info("[Auth] Falling back to Google redirect login", {
            mode,
            code: (error as Partial<AuthError>)?.code || "unknown",
          });
          setLoginNotice(getRedirectStartMessage(mode));
          await awaitLoginNetwork(signInWithRedirect(auth, provider));
          return;
        } catch (redirectError) {
          if (
            !mountedRef.current ||
            actionVersionRef.current !== operation ||
            !isLoginFlowCurrent(flow) ||
            (redirectError as Partial<AuthError>)?.code === "auth/stale-attempt"
          )
            return;
          console.error("Redirect fallback login failed");
        }
      }

      if ((error as Partial<AuthError>)?.code === "auth/stale-attempt") return;
      assertAcquisition();
      failLoginFlow(flow, error);
      clearPendingLoginMode();
      clearRedirectAttempt();
      setLoginNotice(getLoginFailureMessage(error));
    } finally {
      if (actionVersionRef.current === operation) {
        activeActionFlowRef.current = null;
        authActionLockRef.current = false;
        setAuthBusy(false);
      }
    }
  };

  const handleLogin = async (mode: LoginMode) => {
    if (authBusy || authActionLockRef.current) return;
    if (restrictedInAppBrowser) {
      alert(
        "네이버앱 또는 카카오톡 인앱 브라우저에서는 로그인할 수 없습니다. Chrome 또는 Safari에서 위스토리를 열어주세요.",
      );
      return;
    }

    // Re-enter chooser through the dedicated cleanup path when a cached
    // Firebase session already exists in this regular-tab browser state.
    if (auth.currentUser) {
      await handleSwitchAccount(mode);
      return;
    }

    authActionLockRef.current = true;
    await startGoogleLogin(mode);
  };

  const handleSwitchAccount = async (retryMode?: LoginMode) => {
    if (authBusy || authActionLockRef.current) return;
    if (restrictedInAppBrowser) {
      alert(
        "네이버앱 또는 카카오톡 인앱 브라우저에서는 로그인할 수 없습니다. Chrome 또는 Safari에서 위스토리를 열어주세요.",
      );
      return;
    }

    authActionLockRef.current = true;
    setAuthBusy(true);
    clearRoleCache();
    clearPendingLoginMode();
    clearRedirectAttempt();
    setLoginNotice("");
    autoResumeUidRef.current = null;

    let signOutSucceeded = false;
    try {
      await logout();
      signOutSucceeded = true;
    } catch (error) {
      console.error("Failed to sign out before switching account");
    } finally {
      if (retryMode) {
        if (!signOutSucceeded) {
          authActionLockRef.current = false;
          setAuthBusy(false);
          setLoginNotice(
            "이전 로그인 상태를 정리하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.",
          );
          return;
        }
        await startGoogleLogin(retryMode);
        return;
      }
      authActionLockRef.current = false;
      if (typeof window !== "undefined") {
        window.location.replace(
          `${window.location.pathname}${window.location.search}#/`,
        );
        return;
      }
      setAuthBusy(false);
    }
  };

  const showPolicy = async (type: "terms" | "privacy") => {
    setPolicyOpen(true);
    setPolicyTitle(type === "terms" ? "이용 약관" : "개인정보 처리 방침");
    setPolicyLoading(true);
    setPolicyHtml("");

    try {
      const snap = await getDoc(doc(db, "site_settings", type));
      if (snap.exists() && snap.data().text) {
        setPolicyHtml((snap.data() as { text?: string }).text || "");
      } else {
        setPolicyHtml(
          '<p class="text-center text-gray-400 py-8">등록된 내용이 없습니다.</p>',
        );
      }
    } catch (error) {
      console.error("Policy load error:");
      setPolicyHtml(
        '<p class="text-center text-red-400 py-8">내용을 불러오지 못했습니다.</p>',
      );
    } finally {
      setPolicyLoading(false);
    }
  };

  if (authPhase === "error" || authPhase === "registration-pending") {
    return (
      <AuthRecoveryState
        registrationPending={authPhase === "registration-pending"}
        error={authError}
        onRetry={retryAuth}
        onRestart={() => handleSwitchAccount()}
      />
    );
  }

  if (loading)
    return <PageLoading message="로그인 상태를 확인하는 중입니다." />;

  const publicTeacherLogin = !classicEntry && (
    <button
      type="button"
      onClick={() => handleLogin("teacher")}
      disabled={authBusy || restrictedInAppBrowser}
      className="entry-secondary"
    >
      관리자 로그인
    </button>
  );

  const loginControls = (
    <>
      {ddayCount !== null && (
        <div
          className="mb-6 w-full max-w-sm rounded-lg border border-blue-100 bg-white px-5 py-4 shadow-sm"
          aria-label={`${ddayTitle} ${formatDdayCount(ddayCount)}`}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 text-left">
              <p className="text-xs font-bold text-blue-600">D-Day</p>
              <p className="mt-1 truncate text-base font-extrabold text-gray-900">
                {ddayTitle}
              </p>
              <p className="mt-1 text-xs font-medium text-gray-500">
                목표일 {formatDdayDate(ddayDate)}
              </p>
            </div>
            <span className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-lg font-black text-white shadow-sm">
              {formatDdayCount(ddayCount)}
            </span>
          </div>
        </div>
      )}

      {restrictedInAppBrowser && (
        <div className="w-full max-w-sm mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-left shadow-sm">
          <p className="text-sm font-extrabold text-amber-900">
            네이버앱·카카오톡 인앱 브라우저에서는 로그인할 수 없습니다.
          </p>
          <p className="mt-2 text-sm leading-6 text-amber-800">
            하단 메뉴에서 외부 브라우저로 열기를 선택한 뒤 Chrome 또는
            Safari에서 다시 접속해주세요.
          </p>
        </div>
      )}

      {!!loginNotice && (
        <div className="w-full max-w-sm mb-5 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-left shadow-sm">
          <p className="text-sm font-semibold leading-6 text-blue-900">
            {loginNotice}
          </p>
        </div>
      )}

      {currentUser ? (
        <div className="flex flex-col items-center gap-3 w-full max-w-sm">
          <p className="text-sm text-gray-500 break-all text-center px-2">
            {currentUser.email || "로그인 계정"}
          </p>
          <div className={classicEntry ? "contents" : "entry-login-actions"}>
            <button
              onClick={goToDashboard}
              disabled={authBusy}
              className="w-full bg-blue-600 text-white border border-blue-600 px-6 py-3 rounded-full text-base font-bold shadow hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {authBusy ? "처리 중..." : "계속하기"}
            </button>
            {publicTeacherLogin}
          </div>
          <button
            onClick={() => handleLogin("student")}
            disabled={authBusy || restrictedInAppBrowser}
            className="w-full bg-white border border-gray-300 px-6 py-3 rounded-full text-sm font-bold text-gray-700 shadow hover:bg-gray-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            학생 로그인 (계정 선택)
          </button>
          <button
            onClick={() =>
              void handleSwitchAccount(isTeacherUser ? "teacher" : "student")
            }
            disabled={authBusy}
            className="w-full bg-white border border-gray-200 px-6 py-3 rounded-full text-sm font-bold text-gray-700 shadow hover:bg-gray-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            다른 계정으로 로그인
          </button>
        </div>
      ) : (
        <div className="w-full max-w-sm flex flex-col gap-3">
          <div className={classicEntry ? "contents" : "entry-login-actions"}>
            <button
              onClick={() => handleLogin("student")}
              disabled={authBusy || restrictedInAppBrowser}
              className="w-full bg-white border border-gray-200 px-8 py-4 rounded-full text-lg font-bold text-gray-700 shadow hover:bg-gray-50 transition flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <img
                src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg"
                width={24}
                height={24}
                alt="Google"
              />
              학생 로그인
            </button>
            {publicTeacherLogin}
          </div>
          <p className="text-center text-xs leading-5 text-gray-500 whitespace-nowrap">
            학교 Google 계정(@{ALLOWED_SCHOOL_EMAIL_DOMAIN})으로만 로그인할 수
            있습니다.
          </p>
          {!!loginNotice && (
            <button
              onClick={() => void handleSwitchAccount("student")}
              disabled={authBusy}
              className="w-full bg-white border border-gray-200 px-6 py-3 rounded-full text-sm font-bold text-gray-700 shadow hover:bg-gray-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              다른 계정으로 다시 시도
            </button>
          )}
        </div>
      )}
    </>
  );

  return (
    <div
      className={
        classicEntry
          ? "relative flex min-h-screen min-h-[100dvh] flex-col bg-gray-50"
          : ""
      }
    >
      {classicEntry ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-10 md:py-12">
            <div className="text-5xl mb-4 animate-bounce">
              {interfaceConfig?.mainEmoji || "\u{1F4DA}"}
            </div>
            <h1 className="text-6xl font-black tracking-tight mb-3">
              <span className="text-blue-600">We</span>
              <span className="text-amber-500">story</span>
            </h1>
            <p className="text-gray-500 text-xl font-medium mb-8">
              {interfaceConfig?.mainSubtitle || "우리가 써 내려가는 이야기"}
            </p>

            {loginControls}
          </div>

          <div className="flex shrink-0 items-center justify-center gap-2 px-4 pb-6 text-xs whitespace-nowrap md:pb-8">
            <button
              onClick={() => showPolicy("terms")}
              className="text-gray-400 hover:text-gray-600"
            >
              이용 약관
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={() => showPolicy("privacy")}
              className="text-gray-400 hover:text-gray-600"
            >
              개인정보 처리 방침
            </button>
          </div>

          <div className="fixed bottom-12 right-4 z-30 md:bottom-8 md:right-8">
            <button
              onClick={() => handleLogin("teacher")}
              disabled={authBusy || restrictedInAppBrowser}
              className="text-gray-400 hover:text-gray-700 text-xs font-semibold px-2 py-1 rounded hover:bg-gray-200/60 transition whitespace-nowrap"
            >
              <i className="fas fa-chalkboard-teacher mr-1"></i>
              관리자 로그인
            </button>
          </div>
        </>
      ) : (
        <PublicEntry
          controls={loginControls}
          onStudentLogin={() => {
            if (currentUser) void goToDashboard();
            else void handleLogin("student");
          }}
          onTeacherLogin={() => void handleLogin("teacher")}
          onPolicy={(policy) => void showPolicy(policy)}
          disabled={authBusy || (!currentUser && restrictedInAppBrowser)}
          teacherDisabled={authBusy || restrictedInAppBrowser}
          busy={authBusy}
          signedIn={!!currentUser}
          activeDialog={
            consentModalOpen
              ? "consent"
              : profileModalOpen
                ? "profile"
                : policyOpen
                  ? "policy"
                  : null
          }
          onDialogDismiss={() => {
            if (consentModalOpen) handleConsentCancel();
            else if (profileModalOpen) handleProfileCancel();
            else setPolicyOpen(false);
          }}
          schoolDomain={ALLOWED_SCHOOL_EMAIL_DOMAIN}
        />
      )}

      {policyOpen && (
        <div
          aria-labelledby="login-policy-title"
          data-login-dialog="policy"
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm"
          onClick={() => setPolicyOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2
                id="login-policy-title"
                className="text-lg font-bold text-gray-900"
              >
                {policyTitle}
              </h2>
              <button
                onClick={() => setPolicyOpen(false)}
                aria-label="닫기"
                className="entry-dialog-close text-gray-400 hover:text-gray-700 text-xl transition"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 text-sm text-gray-700 leading-relaxed">
              {policyLoading ? (
                <InlineLoading
                  message="약관을 불러오는 중입니다."
                  showWarning
                />
              ) : (
                <div
                  className="policy-rich-text"
                  dangerouslySetInnerHTML={{ __html: policyHtml }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {profileModalOpen && (
        <div
          data-login-dialog="profile"
          data-auth-dialog
          tabIndex={-1}
          aria-label="학생 정보 입력"
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 md:p-8 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-5">
              <h2
                id="student-profile-title"
                className="text-2xl font-bold text-gray-800"
              >
                {"\u{1F44B} 반가워요!"}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                최초 로그인 학생 정보를 입력해주세요.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="login-profile-email"
                  className="block text-xs font-bold text-gray-500 mb-1"
                >
                  이메일
                </label>
                <input
                  id="login-profile-email"
                  type="text"
                  aria-label="이메일"
                  value={profileForm.email}
                  readOnly
                  className="w-full bg-gray-100 border border-gray-200 rounded-lg p-3 text-gray-500 text-sm font-mono"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label
                    htmlFor="login-profile-grade"
                    className="block text-xs font-bold text-gray-500 mb-1"
                  >
                    학년
                  </label>
                  <select
                    id="login-profile-grade"
                    aria-label="학년"
                    value={profileForm.grade}
                    onChange={(e) =>
                      setProfileForm((prev) => ({
                        ...prev,
                        grade: e.target.value,
                      }))
                    }
                    className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    {gradeOptions.map((grade) => (
                      <option key={grade.value} value={grade.value}>
                        {grade.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="login-profile-class"
                    className="block text-xs font-bold text-gray-500 mb-1"
                  >
                    반
                  </label>
                  <select
                    id="login-profile-class"
                    aria-label="반"
                    value={profileForm.className}
                    onChange={(e) =>
                      setProfileForm((prev) => ({
                        ...prev,
                        className: e.target.value,
                      }))
                    }
                    className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="">선택</option>
                    {classOptions.map((cls) => (
                      <option key={cls.value} value={cls.value}>
                        {cls.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="login-profile-number"
                    className="block text-xs font-bold text-gray-500 mb-1"
                  >
                    번호
                  </label>
                  <select
                    id="login-profile-number"
                    aria-label="번호"
                    value={profileForm.number}
                    onChange={(e) =>
                      setProfileForm((prev) => ({
                        ...prev,
                        number: e.target.value,
                      }))
                    }
                    className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="">선택</option>
                    {defaultNumberOptions.map((studentNumber) => (
                      <option
                        key={studentNumber.value}
                        value={studentNumber.value}
                      >
                        {studentNumber.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-profile-name"
                  className="block text-xs font-bold text-gray-500 mb-1"
                >
                  이름
                </label>
                <input
                  id="login-profile-name"
                  lang="ko"
                  inputMode="text"
                  type="text"
                  aria-label="이름"
                  value={profileForm.name}
                  maxLength={4}
                  onChange={(e) => handleProfileNameChange(e.target.value)}
                  placeholder="한글 2~4글자"
                  aria-invalid={profileNameInputWarning}
                  className={`w-full rounded-lg border p-3 text-sm outline-none focus:ring-2 ${
                    profileNameInputWarning
                      ? "border-red-500 focus:border-red-500 focus:ring-red-200"
                      : "border-gray-300 focus:ring-blue-500"
                  }`}
                />
                <p
                  className={`mt-1 text-xs ${profileNameInputWarning ? "font-semibold text-red-600" : "text-gray-500"}`}
                >
                  {profileNameInputWarning
                    ? "영어키로 되어 있어요. 한/영키를 눌러 한글로 바꿔주세요."
                    : "숫자/영문/특수문자는 입력할 수 없습니다."}
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={handleProfileCancel}
                className="min-h-11 px-4 py-2 rounded-lg text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition"
              >
                취소
              </button>
              <button
                onClick={handleProfileSubmit}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-6 rounded-xl transition shadow-lg"
              >
                입력 완료
              </button>
            </div>
          </div>
        </div>
      )}
      {consentModalOpen && (
        <div
          data-login-dialog="consent"
          data-auth-dialog
          tabIndex={-1}
          aria-label="개인정보 수집·이용 동의"
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={handleConsentCancel}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg md:max-w-4xl p-6 md:p-8 mx-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-5 shrink-0">
              <div className="bg-blue-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl">
                {"\u{1F6E1}\uFE0F"}
              </div>
              <h2
                id="student-consent-title"
                className="text-2xl md:text-3xl font-bold text-gray-900"
              >
                개인정보 활용 동의
              </h2>
              <p className="text-gray-600 text-base mt-2 font-medium">
                서비스 이용을 위해 최초 1회 동의가 필요합니다.
              </p>
            </div>

            <div className="bg-gray-50 p-4 md:p-5 rounded-lg text-base text-gray-700 overflow-y-auto mb-5 border border-gray-200 leading-relaxed flex-1 min-h-0 space-y-4">
              {consentItems.length === 0 && (
                <p className="text-center text-gray-400 py-6">
                  등록된 동의 항목이 없습니다.
                </p>
              )}

              {consentItems.map((item, idx) => {
                const isExpanded = consentExpandedId === item.id;
                const isChecked = !!consentChecked[item.id];
                const locked = idx > currentConsentStepIndex && !isChecked;
                return (
                  <div
                    key={item.id}
                    className={idx > 0 ? "border-t border-gray-200 pt-4" : ""}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (locked) return;
                        setConsentExpandedId((prev) =>
                          prev === item.id ? null : item.id,
                        );
                      }}
                      className="w-full text-left"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="bg-purple-100 text-purple-700 font-extrabold text-sm px-2.5 py-1 rounded-full">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-gray-900 text-lg">
                          {item.title || "동의 항목"}
                        </span>
                        {item.required ? (
                          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">
                            필수
                          </span>
                        ) : (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-semibold">
                            선택
                          </span>
                        )}
                        {isChecked && (
                          <span className="ml-auto text-xs md:text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                            동의 완료
                          </span>
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <>
                        <div
                          id={`consent-scroll-${item.id}`}
                          onScroll={(e) => handleConsentScroll(item.id, e)}
                          className="bg-white p-4 md:p-5 rounded-lg text-[15px] md:text-base text-gray-700 border border-gray-200 max-h-56 md:max-h-64 overflow-y-auto mb-3 leading-7"
                        >
                          <div
                            className="policy-rich-text"
                            dangerouslySetInnerHTML={{
                              __html: item.text || "",
                            }}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span
                            className={`text-xs md:text-sm font-semibold ${consentReadReady[item.id] ? "text-emerald-700" : "text-amber-700"}`}
                          >
                            {consentReadReady[item.id]
                              ? "읽기 확인됨"
                              : "끝까지 스크롤하면 동의 버튼이 활성화됩니다."}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleConsentAgreeItem(item, idx)}
                            disabled={isChecked || !consentReadReady[item.id]}
                            className="shrink-0 px-4 md:px-5 py-2 rounded-lg text-sm md:text-base font-bold bg-blue-600 text-white disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-blue-700 transition"
                          >
                            {isChecked
                              ? "동의 완료"
                              : `${item.required ? "필수" : "선택"} 동의`}
                          </button>
                        </div>
                      </>
                    )}

                    {!isExpanded && !isChecked && locked && (
                      <p className="text-xs md:text-sm text-gray-400 mt-1">
                        이전 항목 동의 후 열 수 있습니다.
                      </p>
                    )}
                    {!isExpanded && !isChecked && !locked && (
                      <p className="text-xs md:text-sm text-gray-500 mt-1">
                        클릭하여 내용을 확인하고 동의하세요.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="shrink-0 flex items-center justify-end gap-2">
              <button
                onClick={handleConsentCancel}
                className="min-h-11 px-4 py-2 rounded-lg text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition"
              >
                취소
              </button>
              <button
                onClick={handleConsentConfirm}
                disabled={!consentReady}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-6 rounded-xl transition disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                동의하고 시작하기
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`
                .policy-rich-text {
                    color: #374151;
                    line-height: 1.8;
                }
                .policy-rich-text p {
                    margin: 0.35rem 0;
                    white-space: pre-wrap;
                }
                .policy-rich-text ul {
                    list-style: disc;
                    padding-left: 1.4rem;
                    margin: 0.45rem 0;
                }
                .policy-rich-text ol {
                    list-style: decimal;
                    padding-left: 1.4rem;
                    margin: 0.45rem 0;
                }
                .policy-rich-text li {
                    margin: 0.25rem 0;
                    white-space: pre-wrap;
                }
                .policy-rich-text li[data-list='bullet'] {
                    list-style-type: disc;
                }
                .policy-rich-text li[data-list='ordered'] {
                    list-style-type: decimal;
                }
                .policy-rich-text .ql-indent-1 { padding-left: 2em; }
                .policy-rich-text .ql-indent-2 { padding-left: 4em; }
                .policy-rich-text .ql-indent-3 { padding-left: 6em; }
            `}</style>
    </div>
  );
};

export default Login;
