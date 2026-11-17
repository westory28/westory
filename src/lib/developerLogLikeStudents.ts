import type { User } from "firebase/auth";
import { auth } from "./firebase";
import { callWithApplicationSession } from "./applicationSession";

export interface DeveloperLogLikeStudent {
  id: string;
  name: string;
  grade: string;
  class: string;
  number: string;
}

export interface DeveloperLogLikeStudentsPage {
  students: DeveloperLogLikeStudent[];
  nextCursor: string | null;
  hasMore: boolean;
}

// Only share concurrent requests for the same SDK identity and page. A fresh
// opening always reads the server; student names never enter persistent storage.
const flights = new WeakMap<
  User,
  Map<string, Promise<DeveloperLogLikeStudentsPage>>
>();

export const getDeveloperLogLikeStudents = (
  user: User,
  postId: string,
  cursor?: string,
): Promise<DeveloperLogLikeStudentsPage> => {
  const assertOwner = () => {
    if (auth.currentUser !== user) {
      throw new Error("로그인 상태가 바뀌었습니다. 다시 로그인해 주세요.");
    }
  };
  assertOwner();
  let requests = flights.get(user);
  if (!requests) {
    requests = new Map();
    flights.set(user, requests);
  }
  const key = JSON.stringify([postId, cursor || ""]);
  const existing = requests.get(key);
  if (existing) return existing;
  const request = callWithApplicationSession<
    { postId: string; cursor?: string; pageSize: number },
    DeveloperLogLikeStudentsPage
  >(
    "getDeveloperLogLikeStudents",
    { postId, ...(cursor ? { cursor } : {}), pageSize: 40 },
    user,
    { beforeDispatch: assertOwner },
  ).then((response) => {
    assertOwner();
    return response.data;
  });
  requests.set(key, request);
  void request
    .finally(() => {
      if (requests.get(key) === request) requests.delete(key);
    })
    .catch(() => {});
  return request;
};
