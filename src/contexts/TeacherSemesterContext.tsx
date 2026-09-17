import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { AuthContext, useAuth } from "./AuthContext";
import { getHttpsCallable } from "../lib/firebase";
import { isTeacherUser } from "../lib/permissions";
import { sessionQueryCache } from "../lib/sessionQueryCache";
import {
  readTeacherSemester,
  sameSemester,
  setTeacherSemesterWriteScope,
  storeTeacherSemester,
  validTeacherSemester,
  type TeacherSemesterOption,
  type TeacherSemesterScope,
} from "../lib/teacherSemesterView";
import type { SystemConfig } from "../types";

interface TeacherSemesterContextValue {
  activeConfig: SystemConfig | null;
  viewConfig: SystemConfig | null;
  isViewingPast: boolean;
  semesters: TeacherSemesterOption[];
  loading: boolean;
  error: string;
  selectSemester: (scope: TeacherSemesterScope | null) => void;
  refreshSemesters: () => Promise<void>;
}
const TeacherSemesterContext =
  createContext<TeacherSemesterContextValue | null>(null);

export const TeacherSemesterProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const auth = useAuth();
  const location = useLocation();
  const uid = auth.currentUser?.uid || "";
  const teacherRoute = location.pathname.startsWith("/teacher/");
  const allowed = Boolean(
    uid && isTeacherUser(auth.userData, auth.currentUser?.email),
  );
  const [selection, setSelection] = useState<{
    uid: string;
    scope: TeacherSemesterScope | null;
  }>({ uid: "", scope: null });
  const [catalog, setCatalog] = useState<{
    uid: string;
    semesters: TeacherSemesterOption[];
  }>({ uid: "", semesters: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const ownerRef = useRef(uid);
  const activeConfig = auth.config;
  const semesters = useMemo(() => {
    const items = catalog.uid === uid ? [...catalog.semesters] : [];
    if (
      activeConfig &&
      !items.some((item) => sameSemester(item, activeConfig))
    ) {
      items.push({
        year: activeConfig.year,
        semester: activeConfig.semester,
        label: `${activeConfig.year}학년도 ${activeConfig.semester}학기`,
      });
    }
    return items.sort(
      (a, b) =>
        b.year.localeCompare(a.year) || a.semester.localeCompare(b.semester),
    );
  }, [catalog, uid, activeConfig?.year, activeConfig?.semester]);

  const refreshSemesters = useCallback(async () => {
    if (!allowed || !teacherRoute || !activeConfig) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const callable = await getHttpsCallable<
        Record<string, never>,
        { semesters: TeacherSemesterOption[] }
      >("getTeacherSemesterOptions", { expectedUid: uid });
      const result = await callable({});
      if (request !== requestRef.current) return;
      const items = result.data.semesters
        .filter(validTeacherSemester)
        .map((item) => ({
          year: item.year,
          semester: item.semester,
          label: `${item.year}학년도 ${item.semester}학기`,
        }));
      setCatalog({ uid, semesters: items });
      const stored = readTeacherSemester(uid);
      const next =
        stored &&
        items.some((item) => sameSemester(item, stored)) &&
        !sameSemester(stored, activeConfig)
          ? stored
          : null;
      setSelection({ uid, scope: next });
      storeTeacherSemester(uid, next);
    } catch (caught) {
      if (request !== requestRef.current) return;
      setError("기존 학기 목록을 불러오지 못했습니다. 다시 불러와 주세요.");
      console.error("Failed to load teacher semester options", caught);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [allowed, teacherRoute, uid, activeConfig?.year, activeConfig?.semester]);

  useEffect(() => {
    if (ownerRef.current && ownerRef.current !== uid)
      storeTeacherSemester(ownerRef.current, null);
    ownerRef.current = uid;
    void refreshSemesters();
    return () => {
      requestRef.current += 1;
    };
  }, [uid, refreshSemesters]);

  const scope =
    allowed && teacherRoute && selection.uid === uid ? selection.scope : null;
  const isViewingPast = Boolean(
    scope && activeConfig && !sameSemester(scope, activeConfig),
  );
  const viewConfig = useMemo(
    () =>
      activeConfig && isViewingPast && scope
        ? {
            ...activeConfig,
            year: scope.year,
            semester: scope.semester,
            teacherViewOnly: true,
          }
        : activeConfig,
    [activeConfig, isViewingPast, scope],
  );

  useLayoutEffect(() => {
    setTeacherSemesterWriteScope(
      allowed && teacherRoute ? { uid, readOnly: isViewingPast } : null,
    );
    return () => setTeacherSemesterWriteScope(null);
  }, [allowed, teacherRoute, uid, isViewingPast]);

  const selectSemester = useCallback(
    (requested: TeacherSemesterScope | null) => {
      if (!allowed || !teacherRoute) return;
      if (requested && !semesters.some((item) => sameSemester(item, requested)))
        return;
      const next =
        requested && !sameSemester(requested, activeConfig) ? requested : null;
      // Fence writes immediately, before the next render or an awaiting handler resumes.
      setTeacherSemesterWriteScope({ uid, readOnly: Boolean(next) });
      storeTeacherSemester(uid, next);
      sessionQueryCache.clear();
      setSelection({ uid, scope: next });
    },
    [allowed, teacherRoute, semesters, activeConfig, uid],
  );

  return (
    <TeacherSemesterContext.Provider
      value={{
        activeConfig,
        viewConfig,
        isViewingPast,
        semesters,
        loading,
        error,
        selectSemester,
        refreshSemesters,
      }}
    >
      <AuthContext.Provider
        value={{ ...auth, config: viewConfig, userConfig: viewConfig }}
      >
        {children}
      </AuthContext.Provider>
    </TeacherSemesterContext.Provider>
  );
};

export const useTeacherSemester = () => {
  const context = useContext(TeacherSemesterContext);
  if (!context) throw new Error("TeacherSemesterProvider is required");
  return context;
};
