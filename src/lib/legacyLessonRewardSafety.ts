import type { SystemConfig } from "../types";
import { claimLessonCorePointReward } from "./lessonCorePointReward";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

export type LegacyLessonRewardAvailability =
  | "AVAILABLE"
  | "PERMISSION_REQUIRED"
  | "PERSISTENCE_DISABLED"
  | "REQUEST_FAILED";

export interface LegacyLessonRewardSafetyState {
  availability: LegacyLessonRewardAvailability;
  claimable: boolean;
  requestIssued: boolean;
  awarded: boolean;
  settled: boolean;
  amount: number;
  duplicate?: boolean;
  message: string;
}

export const resolveLegacyLessonRewardSafetyState = (options: {
  authenticated: boolean;
  persistenceEnabled: boolean;
}): LegacyLessonRewardSafetyState => {
  if (!options.authenticated) {
    return {
      availability: "PERMISSION_REQUIRED",
      claimable: false,
      requestIssued: false,
      awarded: false,
      settled: false,
      amount: 0,
      message: "로그인 상태를 확인할 수 없어 위스 보상을 요청하지 않았습니다.",
    };
  }

  if (!options.persistenceEnabled) {
    return {
      availability: "PERSISTENCE_DISABLED",
      claimable: false,
      requestIssued: false,
      awarded: false,
      settled: false,
      amount: 0,
      message: "미리보기에서는 위스 보상을 요청하지 않습니다.",
    };
  }

  return {
    availability: "AVAILABLE",
    claimable: true,
    requestIssued: false,
    awarded: false,
    settled: false,
    amount: 0,
    message: "핵심포인트를 모두 찾으면 500위스를 받을 수 있습니다.",
  };
};

export const requestLegacyLessonCorePointReward = async (options: {
  config: ConfigLike;
  authenticated: boolean;
  persistenceEnabled: boolean;
}): Promise<LegacyLessonRewardSafetyState> => {
  const safety = resolveLegacyLessonRewardSafetyState(options);
  if (!safety.claimable) return safety;
  const response = await claimLessonCorePointReward(options.config);
  const result = response.result;
  const amount = Number(result.totalAwarded || result.amount || 0);
  return {
    availability: "AVAILABLE",
    claimable: !result.settled,
    requestIssued: true,
    awarded: result.awarded === true,
    duplicate: result.duplicate === true,
    settled: result.settled === true,
    amount,
    message:
      amount > 0
        ? `+${amount}위스가 반영되었습니다.`
        : result.blockedMessage ||
          "핵심포인트 완주 보상은 이미 반영되었습니다.",
  };
};

export const resolveLegacyLessonRewardFailure = (
  _error: unknown,
): LegacyLessonRewardSafetyState => ({
  availability: "REQUEST_FAILED",
  claimable: false,
  requestIssued: false,
  awarded: false,
  settled: false,
  amount: 0,
  message: "보상 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.",
});
