import type { User } from "firebase/auth";
import type { UserData } from "../types";
import { normalizeStaffPermissions } from "./permissions";

export const AUTH_STARTUP_DEADLINE_MS = 15_000;
export type AuthPhase =
  | "resolving"
  | "opening-session"
  | "loading-profile"
  | "ready"
  | "onboarding"
  | "signed-out"
  | "error";
export interface AuthStartupError {
  code: string;
  message: string;
  retryable: boolean;
}
export interface AuthStartupState {
  phase: AuthPhase;
  generation: number;
  currentUser: User | null;
  onboardingUser: User | null;
  userData: UserData | null;
  error: AuthStartupError | null;
}
export interface LoginBootstrap {
  generation: number;
  user: User;
  authTime: number;
  profile: UserData | null;
}
export interface ProfileSnapshot {
  exists: boolean;
  data: Partial<UserData> | null;
  fromCache: boolean;
  hasPendingWrites: boolean;
}
interface Dependencies {
  currentUser: () => User | null;
  prepareSession: (
    user: User,
    options: { fresh: boolean; isCurrent: () => boolean },
  ) => Promise<void>;
  listenProfile: (
    user: User,
    next: (snapshot: ProfileSnapshot) => void,
    error: (error: unknown) => void,
  ) => () => void;
  change: (state: AuthStartupState) => void;
  sessionReady: (user: User, generation: number) => void;
  mark: (phase: string, generation: number) => void;
  setTimer: (callback: () => void, delay: number) => number;
  clearTimer: (timer: number) => void;
}
interface Attempt {
  generation: number;
  user: User;
  authTime: number | null;
  claimedBy: number | null;
  participants: Set<number>;
  settled: boolean;
  promise: Promise<LoginBootstrap>;
  resolve: (result: LoginBootstrap) => void;
  reject: (error: Error) => void;
}

export const authStartupFailure = (error: unknown): AuthStartupError => {
  const failure = error as { code?: string; details?: { reason?: string } };
  const code = String(failure?.code || "auth/startup-failed");
  const reason = String(failure?.details?.reason || "");
  if (
    code.includes("unauthenticated") ||
    reason.startsWith("SESSION_") ||
    reason === "RECENT_AUTH_REQUIRED"
  ) {
    return {
      code,
      message: "로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.",
      retryable: false,
    };
  }
  if (code.includes("permission-denied")) {
    return {
      code,
      message: "이 계정으로 접근할 수 없습니다. 로그인 계정을 확인해 주세요.",
      retryable: false,
    };
  }
  return {
    code,
    message:
      code === "auth/startup-timeout"
        ? "로그인 확인이 지연되고 있습니다. 연결을 확인한 뒤 다시 시도해 주세요."
        : "로그인 정보를 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
    retryable: true,
  };
};
const failureError = (failure: AuthStartupError) =>
  Object.assign(new Error(failure.message), { code: failure.code });
const staleError = () =>
  Object.assign(new Error("로그인 상태가 변경되었습니다."), {
    code: "auth/stale-attempt",
  });

// This owns one startup operation, not a cache of successful server sessions.
// Login may consume that operation's result once. A retry always opens a new
// operation and performs a fresh server handshake.
export class AuthStartupController {
  private generation = 0;
  private observation = 0;
  private flow = 0;
  private enrolledFlow: number | null = null;
  private interactiveFlow: number | null = null;
  private active = true;
  private locked = false;
  private timer: number | null = null;
  private stopProfile: (() => void) | null = null;
  private attempt: Attempt | null = null;
  private state: AuthStartupState;
  private waiters = new Set<(state: AuthStartupState) => void>();

  constructor(
    private readonly deps: Dependencies,
    initialGeneration = 0,
  ) {
    this.generation = initialGeneration;
    this.state = this.empty("resolving");
    this.publish(this.state);
    this.armDeadline(this.generation);
  }

  private empty(phase: AuthPhase, error: AuthStartupError | null = null) {
    return {
      phase,
      generation: this.generation,
      currentUser: null,
      onboardingUser: null,
      userData: null,
      error,
    } satisfies AuthStartupState;
  }
  private publish(state: AuthStartupState) {
    this.state = state;
    this.deps.change(state);
    this.deps.mark(state.phase, state.generation);
    for (const notify of this.waiters) notify(state);
  }
  private clearDeadline() {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }
  private armDeadline(generation: number) {
    this.clearDeadline();
    this.timer = this.deps.setTimer(() => {
      if (!this.active || this.generation !== generation) return;
      this.fail(generation, { code: "auth/startup-timeout" });
    }, AUTH_STARTUP_DEADLINE_MS);
  }
  private supersede() {
    this.generation += 1;
    this.observation += 1;
    this.clearDeadline();
    this.stopProfile?.();
    this.stopProfile = null;
    if (this.attempt && !this.attempt.settled) {
      this.attempt.settled = true;
      this.attempt.reject(staleError());
    }
    this.attempt = null;
    for (const notify of this.waiters) notify(this.empty("resolving"));
  }
  private fail(generation: number, error: unknown) {
    if (!this.active || this.generation !== generation) return;
    const failure = authStartupFailure(error);
    this.flow += 1;
    this.enrolledFlow = null;
    this.interactiveFlow = null;
    const attempt = this.attempt;
    if (attempt && !attempt.settled) {
      attempt.settled = true;
      attempt.reject(failureError(failure));
    }
    this.supersede();
    this.locked = true;
    this.publish(this.empty("error", failure));
  }

  isCurrent = (generation: number, user: User) =>
    this.active &&
    !this.locked &&
    this.generation === generation &&
    this.attempt?.user === user &&
    this.deps.currentUser() === user;

  assertCurrent = async (generation: number, user: User) => {
    if (!this.isCurrent(generation, user)) throw staleError();
    let timer: number | null = null;
    const token = await Promise.race([
      user.getIdTokenResult(),
      new Promise<never>((_, reject) => {
        timer = this.deps.setTimer(() => {
          const error = { code: "auth/startup-timeout" };
          this.fail(generation, error);
          reject(failureError(authStartupFailure(error)));
        }, AUTH_STARTUP_DEADLINE_MS);
      }),
    ]).finally(() => {
      if (timer !== null) this.deps.clearTimer(timer);
    });
    if (!this.isCurrent(generation, user)) throw staleError();
    if (Number(token.claims.auth_time) !== this.attempt?.authTime) {
      this.flow += 1;
      this.enrolledFlow = null;
      this.start(user, true);
      throw staleError();
    }
  };

  observe = async (user: User | null) => {
    if (!this.active || this.deps.currentUser() !== user) return;
    if (!user) {
      if (this.interactiveFlow !== null) return;
      const hadAttempt = !!this.attempt;
      this.supersede();
      if (hadAttempt) this.flow += 1;
      this.publish(this.empty("signed-out"));
      return;
    }
    // A timed-out restoration is not revived by a late SDK callback. A user
    // action can retry it or start an interactive sign-in.
    if (this.locked) return;
    // Only the owner of an interactive acquisition can accept its credential.
    if (this.interactiveFlow !== null) return;
    const attempt = this.attempt;
    if (attempt?.user !== user) {
      if (attempt) {
        this.flow += 1;
        this.enrolledFlow = null;
      }
      this.start(user, false);
      return;
    }
    if (attempt.authTime === null) return;
    const observation = ++this.observation;
    try {
      const token = await user.getIdTokenResult();
      if (
        !this.active ||
        observation !== this.observation ||
        this.deps.currentUser() !== user
      )
        return;
      const authTime = Number(token.claims.auth_time);
      if (!Number.isFinite(authTime)) throw staleError();
      if (authTime !== attempt.authTime) {
        this.flow += 1;
        this.enrolledFlow = null;
        this.start(user, true);
      }
    } catch (error) {
      if (observation === this.observation) this.fail(this.generation, error);
    }
  };

  beginLoginFlow = (resume = false) => {
    const flow = ++this.flow;
    this.enrolledFlow = flow;
    this.interactiveFlow = resume ? null : flow;
    if (resume && this.attempt && !this.attempt.settled) {
      this.attempt.participants.add(flow);
    }
    if (!resume) {
      this.supersede();
      this.locked = false;
      this.publish(this.empty("resolving"));
      // Choosing an OAuth account is user interaction, not network startup.
    }
    return flow;
  };

  isLoginFlowCurrent = (flow: number) => this.active && this.flow === flow;
  abandonLoginFlow = (flow: number) => {
    if (this.interactiveFlow === flow && this.isLoginFlowCurrent(flow))
      this.invalidate();
  };
  rejectStaleAcquisition = (user: User, flow: number) => {
    if (
      !this.active ||
      this.isLoginFlowCurrent(flow) ||
      this.deps.currentUser() !== user
    )
      return false;
    // A newer acquisition may own the same SDK object. Never discard its
    // accepted credential or invalidate an unrelated pending chooser.
    if (this.attempt?.user === user && this.attempt.claimedBy === this.flow)
      return false;
    const hasNewChooser = this.interactiveFlow !== null;
    this.supersede();
    if (!hasNewChooser) {
      this.flow += 1;
      this.enrolledFlow = null;
    }
    this.locked = !hasNewChooser;
    this.publish(this.empty(hasNewChooser ? "resolving" : "signed-out"));
    return true;
  };

  failLoginFlow = (flow: number, error: unknown) => {
    if (!this.isLoginFlowCurrent(flow)) return;
    if (!this.deps.currentUser()) {
      this.flow += 1;
      this.supersede();
      this.enrolledFlow = null;
      this.interactiveFlow = null;
      this.locked = true;
      this.publish(this.empty("signed-out"));
    } else {
      this.fail(this.generation, error);
    }
  };

  claimLoginBootstrap = async (user: User, flow: number) => {
    if (!this.active || flow !== this.flow || this.deps.currentUser() !== user)
      throw staleError();
    if (this.interactiveFlow === flow) this.interactiveFlow = null;
    let attempt = this.attempt;
    if (
      !attempt ||
      attempt.user !== user ||
      this.locked ||
      (attempt.settled && !attempt.participants.has(flow))
    ) {
      attempt = this.start(user, true);
    }
    if (attempt.claimedBy !== null) throw staleError();
    attempt.claimedBy = flow;
    const result = await attempt.promise;
    await this.assertCurrent(result.generation, user);
    if (flow !== this.flow) throw staleError();
    return { ...result, profile: this.state.userData };
  };

  waitForProfile = (
    generation: number,
    user: User,
    matches: (profile: UserData) => boolean,
  ) =>
    new Promise<void>((resolve, reject) => {
      let timer: number | null = null;
      const finish = (error?: Error) => {
        this.waiters.delete(check);
        if (timer !== null) this.deps.clearTimer(timer);
        if (error) reject(error);
        else resolve();
      };
      const check = (state: AuthStartupState) => {
        if (!this.isCurrent(generation, user)) return finish(staleError());
        if (
          state.phase === "ready" &&
          state.userData &&
          matches(state.userData)
        )
          finish();
      };
      this.waiters.add(check);
      timer = this.deps.setTimer(() => {
        this.fail(generation, { code: "auth/startup-timeout" });
        finish(
          failureError(authStartupFailure({ code: "auth/startup-timeout" })),
        );
      }, AUTH_STARTUP_DEADLINE_MS);
      check(this.state);
    });

  retry = async () => {
    this.flow += 1;
    this.enrolledFlow = null;
    this.interactiveFlow = null;
    const user = this.deps.currentUser();
    if (!user) {
      this.supersede();
      this.locked = false;
      this.publish(this.empty("signed-out"));
      return;
    }
    const attempt = this.start(user, true);
    await attempt.promise;
  };

  invalidate = () => {
    this.supersede();
    this.flow += 1;
    this.enrolledFlow = null;
    this.interactiveFlow = null;
    this.locked = true;
    this.publish(this.empty("signed-out"));
  };

  observerFailed = (error: unknown) => this.fail(this.generation, error);

  dispose = () => {
    this.supersede();
    this.active = false;
  };

  private start(user: User, fresh: boolean): Attempt {
    this.supersede();
    this.locked = false;
    let resolve!: Attempt["resolve"];
    let reject!: Attempt["reject"];
    const promise = new Promise<LoginBootstrap>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Automatic startup may have no consumer until Login mounts.
    void promise.catch(() => undefined);
    const attempt: Attempt = {
      generation: this.generation,
      user,
      authTime: null,
      claimedBy: null,
      participants: new Set(
        this.enrolledFlow === null ? [] : [this.enrolledFlow],
      ),
      settled: false,
      promise,
      resolve,
      reject,
    };
    this.attempt = attempt;
    this.publish(this.empty("resolving"));
    this.armDeadline(attempt.generation);
    void this.run(attempt, fresh);
    return attempt;
  }

  private async run(attempt: Attempt, fresh: boolean) {
    const { user, generation } = attempt;
    const current = () => this.isCurrent(generation, user);
    try {
      const token = await user.getIdTokenResult();
      if (!current()) return;
      const authTime = Number(token.claims.auth_time);
      if (!Number.isFinite(authTime)) throw staleError();
      attempt.authTime = authTime;
      this.publish(this.empty("opening-session"));
      await this.deps.prepareSession(user, { fresh, isCurrent: current });
      await this.assertCurrent(generation, user);
      if (!current()) return;
      this.deps.sessionReady(user, generation);
      this.publish(this.empty("loading-profile"));
      const stopProfile = this.deps.listenProfile(
        user,
        (snapshot) => {
          if (!current() || snapshot.fromCache || snapshot.hasPendingWrites)
            return;
          try {
            const raw = snapshot.data;
            const profile: UserData | null =
              snapshot.exists && raw
                ? ({
                    ...raw,
                    uid: user.uid,
                    role:
                      raw.role === "teacher"
                        ? "teacher"
                        : raw.role === "staff"
                          ? "staff"
                          : "student",
                    staffPermissions: normalizeStaffPermissions(
                      raw.staffPermissions,
                    ),
                    teacherPortalEnabled: raw.teacherPortalEnabled === true,
                  } as UserData)
                : null;
            this.clearDeadline();
            this.publish({
              phase: profile ? "ready" : "onboarding",
              generation,
              currentUser: profile ? user : null,
              onboardingUser: profile ? null : user,
              userData: profile,
              error: null,
            });
            if (!attempt.settled) {
              attempt.settled = true;
              attempt.resolve({ generation, user, authTime, profile });
            }
          } catch (error) {
            this.fail(generation, error);
          }
        },
        (error) => this.fail(generation, error),
      );
      if (current()) this.stopProfile = stopProfile;
      else stopProfile();
    } catch (error) {
      this.fail(generation, error);
    }
  }
}
