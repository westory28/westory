import { auth, getHttpsCallable } from "./firebase";
import { ensureSensitiveOperation } from "./sensitiveOperation";
import { callStudentDataService } from "./studentProfileCommands";

export type StudentRegistrationPolicy = {
  schemaVersion: 1;
  admissionYear: string;
  admissionGrade: string;
  revision: number;
  emailPatternLabel: string;
};

export type StudentRegistrationPolicyInput = Pick<
  StudentRegistrationPolicy,
  "admissionYear" | "admissionGrade"
> & { expectedRevision: number };

const readPolicy = (value: StudentRegistrationPolicy) => {
  if (
    value?.schemaVersion !== 1 ||
    !/^20\d{2}$/.test(value.admissionYear) ||
    !/^[123]$/.test(value.admissionGrade) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    value.emailPatternLabel !==
      `${value.admissionYear.slice(-2)}${value.admissionGrade}NNNN@yongshin-ms.ms.kr`
  ) {
    throw new Error(
      "가입 기준 응답을 확인하지 못했습니다. 다시 불러와 주세요.",
    );
  }
  return value;
};

// Login reads this before a new student's application session exists. A failed
// read never substitutes an old or permissive client-side default.
export const getStudentRegistrationPolicy = async () => {
  const owner = auth.currentUser;
  if (!owner) throw new Error("로그인 후 다시 시도해 주세요.");
  const callable = await getHttpsCallable<
    Record<string, never>,
    StudentRegistrationPolicy
  >("getStudentRegistrationPolicy", { timeout: 15000 });
  if (auth.currentUser !== owner)
    throw new Error("로그인 계정이 바뀌었습니다. 다시 확인해 주세요.");
  const response = await callable({});
  if (auth.currentUser !== owner)
    throw new Error("로그인 계정이 바뀌었습니다. 다시 확인해 주세요.");
  return readPolicy(response.data);
};

const flights = new Map<string, Promise<StudentRegistrationPolicy>>();

export const saveStudentRegistrationPolicy = (
  input: StudentRegistrationPolicyInput,
): Promise<StudentRegistrationPolicy> => {
  const owner = auth.currentUser;
  if (!owner) return Promise.reject(new Error("로그인 후 다시 시도해 주세요."));
  const snapshot = { ...input };
  const key = JSON.stringify([owner.uid, snapshot]);
  const pending = flights.get(key);
  if (pending) return pending;
  const flight = (async () => {
    await ensureSensitiveOperation();
    if (auth.currentUser !== owner)
      throw new Error("로그인 계정이 바뀌었습니다. 다시 확인해 주세요.");
    const result = await callStudentDataService<
      StudentRegistrationPolicyInput,
      StudentRegistrationPolicy
    >("saveStudentRegistrationPolicy", snapshot, owner.uid);
    if (auth.currentUser !== owner)
      throw new Error("로그인 계정이 바뀌었습니다. 다시 확인해 주세요.");
    const policy = readPolicy(result);
    if (
      policy.admissionYear !== snapshot.admissionYear ||
      policy.admissionGrade !== snapshot.admissionGrade ||
      policy.revision < snapshot.expectedRevision ||
      policy.revision > snapshot.expectedRevision + 1
    ) {
      throw new Error(
        "저장 결과가 요청과 다릅니다. 저장된 기준을 다시 불러와 주세요.",
      );
    }
    return policy;
  })().finally(() => {
    if (flights.get(key) === flight) flights.delete(key);
  });
  flights.set(key, flight);
  return flight;
};
