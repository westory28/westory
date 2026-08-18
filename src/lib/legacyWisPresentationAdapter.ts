import { POINT_POLICY_FALLBACK } from "./points";
import {
  forgetLegacyWisMutationIntent,
  getLegacyWisMutationIntent,
  getOrCreateLegacyWisMutationIntent,
  shouldForgetLegacyWisIntentAfterError,
} from "./legacyWisMutationIntent";
import {
  deductWis,
  getWisEconomyState,
  grantWis,
  placeWisOrder,
  reverseWisEntry,
  reviewWisOrder,
  saveWisHallOfFameConfig,
  upsertWisInventory,
  upsertWisProduct,
  type WisAccount,
  type WisEconomyState,
  type WisInventory,
  type WisLedgerEntry,
} from "./wisEconomy";
import type {
  PointOrder,
  PointOrderStatus,
  PointPolicy,
  PointProduct,
  PointStudentTarget,
  PointTransaction,
  PointTransactionType,
  PointWallet,
  SystemConfig,
  HallOfFameInterfaceConfig,
  WisHallOfFameSnapshot,
} from "../types";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

export type LegacyWisQueryContext = {
  semesterId?: string;
  provenance?: "CURRENT" | "ARCHIVE" | "LEGACY" | "EXPLICIT";
};

type LegacyPointOrderOptions = { uid?: string; limitCount?: number };
type LegacySchoolOption = { value: string; label: string };
type LegacyActor = { uid: string; name?: string };
type SchoolIdentity = { grade: string; class: string; number: string };
type WisProjection =
  | "summary"
  | "overview"
  | "student-core"
  | "account"
  | "orders"
  | "catalog"
  | "hall-of-fame";
type WisQueryOptions = {
  projection?: WisProjection;
  accountId?: string;
  ledgerEntryId?: string;
  orderStatus?: string;
  cursor?: string;
  limit?: number;
};

export class LegacyWisPresentationError extends Error {
  readonly safeToDisplay = true;

  constructor(message: string) {
    super(message);
    this.name = "LegacyWisPresentationError";
  }
}

const pendingQueries = new Map<string, Promise<WisEconomyState>>();

const semesterKey = (config: ConfigLike) =>
  `${String(config?.year || "").trim()}-${String(config?.semester || "").trim()}`;

const normalizeQueryContext = (
  context?: LegacyWisQueryContext,
): LegacyWisQueryContext => ({
  ...(context?.semesterId
    ? { semesterId: String(context.semesterId).trim() }
    : {}),
  ...(context?.provenance ? { provenance: context.provenance } : {}),
});

const queryState = (
  config: ConfigLike,
  audience: "student" | "teacher",
  context?: LegacyWisQueryContext,
  options: WisQueryOptions = {},
) => {
  const normalized = normalizeQueryContext(context);
  const key = [
    audience,
    options.projection || "",
    options.accountId || "",
    options.ledgerEntryId || "",
    options.orderStatus || "",
    options.cursor || "",
    options.limit || "",
    semesterKey(config),
    normalized.semesterId || "",
    normalized.provenance || "CURRENT",
  ].join("|");
  const pending = pendingQueries.get(key);
  if (pending) return pending;

  const request = getWisEconomyState({
    config,
    audience,
    ...normalized,
    ...options,
  }).finally(() => {
    pendingQueries.delete(key);
  });
  pendingQueries.set(key, request);
  return request;
};

const queryCurrentTeacherState = (
  config: ConfigLike,
  options: WisQueryOptions = {},
) => queryState(config, "teacher", { provenance: "CURRENT" }, options);

const mergePagedStates = (
  states: WisEconomyState[],
  key: "accounts" | "orders" | "products",
) => {
  const first = states[0];
  if (!first)
    throw new LegacyWisPresentationError("위스 자료를 불러오지 못했습니다.");
  return {
    ...first,
    accounts:
      key === "accounts"
        ? states.flatMap((state) => state.accounts)
        : states.flatMap((state) => state.accounts),
    orders:
      key === "orders" ? states.flatMap((state) => state.orders) : first.orders,
    products:
      key === "products"
        ? states.flatMap((state) => state.products)
        : first.products,
    inventory:
      key === "products"
        ? states.flatMap((state) => state.inventory)
        : first.inventory,
    nextCursor: "",
  };
};

const queryAllPages = async (
  config: ConfigLike,
  projection: "overview" | "orders" | "catalog",
) => {
  const states: WisEconomyState[] = [];
  let cursor = "";
  for (let page = 0; page < 100; page += 1) {
    const state = await queryCurrentTeacherState(config, {
      projection,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    states.push(state);
    cursor = state.nextCursor;
    if (!cursor) break;
  }
  if (cursor) {
    throw new LegacyWisPresentationError(
      "위스 자료가 너무 많아 한 번에 불러올 수 없습니다. 조회 범위를 좁혀 주세요.",
    );
  }
  return mergePagedStates(
    states,
    projection === "overview"
      ? "accounts"
      : projection === "orders"
        ? "orders"
        : "products",
  );
};

const requireWritableState = (state: WisEconomyState) => {
  if (!state.economy) {
    throw new LegacyWisPresentationError(
      "현재 학기의 위스 운영 정보가 준비되지 않았습니다.",
    );
  }
  if (state.provenance !== "CURRENT" || state.readOnly) {
    throw new LegacyWisPresentationError(
      "현재 학기 자료에서만 위스 정보를 변경할 수 있습니다.",
    );
  }
  return state.economy;
};

const parseSchoolIdentity = (account: WisAccount) => {
  const classId = String(account.classId || "").trim();
  const enrollmentId = String(account.enrollmentId || "").trim();
  const grade =
    String(account.grade || "").trim() ||
    classId.match(/(?:^|[-_:])(?:grade|g)(\d+)(?:[-_:]|$)/i)?.[1] ||
    "";
  const className =
    String(account.classNumber || "").trim() ||
    classId.match(/(?:^|[-_:])(?:class|c)(\d+)(?:[-_:]|$)/i)?.[1] ||
    "";
  const number =
    String(account.studentNumber || "").trim() ||
    enrollmentId.match(/(?:^|[-_:])(?:number|no|n)(\d+)(?:[-_:]|$)/i)?.[1] ||
    "";
  return { grade, class: className, number };
};

const ledgerForAccount = (state: WisEconomyState, accountId: string) =>
  state.ledger.filter((entry) => entry.accountId === accountId);

export const hydrateLegacyStudentWisOwnProjection = (
  state: WisEconomyState,
  studentUid: string,
): WisEconomyState => {
  const accountId = String(state.account?.accountId || "").trim();
  return {
    ...state,
    ledger: state.ledger.map((entry) => ({
      ...entry,
      accountId: entry.accountId || accountId,
      studentUid: entry.studentUid || studentUid,
    })),
    orders: state.orders.map((order) => ({
      ...order,
      accountId: order.accountId || accountId,
      studentUid: order.studentUid || studentUid,
    })),
  };
};

const mapLedgerType = (entry: WisLedgerEntry): PointTransactionType => {
  if (entry.type === "ORDER_DEBIT") return "purchase_hold";
  if (entry.type === "ORDER_REFUND") return "purchase_cancel";
  if (entry.type === "GRANT" && entry.sourceId === "lesson-core-points-all")
    return "lesson_core_points";
  if (entry.type === "DEDUCT") return "manual_reclaim";
  if (entry.type === "REVERSAL")
    return entry.delta >= 0 ? "manual_adjust" : "manual_reclaim";
  return entry.delta >= 0 ? "manual_adjust" : "manual_reclaim";
};

const mapLedgerEntry = (
  entry: WisLedgerEntry,
  studentUid: string,
): PointTransaction => {
  const type = mapLedgerType(entry);
  return {
    id: entry.ledgerEntryId,
    uid: studentUid,
    type,
    activityType: type,
    delta: entry.delta,
    balanceAfter: entry.balanceAfter,
    sourceId: entry.sourceId,
    sourceLabel: entry.reason || "위스 원장 반영",
    policyId: "w7-canonical-ledger",
    createdBy: entry.actorUid,
    createdAt: entry.createdAt,
    reclaimed: entry.type === "REVERSAL" || Boolean(entry.reversalEntryId),
  };
};

const mapWallet = (
  state: WisEconomyState,
  account: WisAccount,
  identity?: SchoolIdentity,
): PointWallet => {
  const entries = ledgerForAccount(state, account.accountId);
  const school = identity || parseSchoolIdentity(account);
  return {
    uid: account.studentUid,
    studentName: account.displayName || "학생",
    ...school,
    balance: account.balance,
    earnedTotal: Number(account.earnedTotal || 0),
    rankEarnedTotal: Number(account.rankEarnedTotal || 0),
    spentTotal: Number(account.spentTotal || 0),
    adjustedTotal: Number(account.adjustedTotal || 0),
    rankSnapshot: null,
    lastTransactionAt: entries[0]?.createdAt || null,
  };
};

const mapProducts = (
  state: WisEconomyState,
  options: { activeOnly: boolean; useAvailableStock: boolean },
) => {
  const inventoryByProductId = new Map(
    state.inventory.map((inventory) => [inventory.productId, inventory]),
  );
  const products: PointProduct[] = state.products.map((product, index) => {
    const inventory = inventoryByProductId.get(product.productId);
    return {
      id: product.productId,
      name: product.name,
      description: product.description,
      price: Number(inventory?.price || 0),
      stock: Number(
        options.useAvailableStock
          ? inventory?.available || 0
          : inventory?.stock || 0,
      ),
      isActive: product.active && inventory?.active === true,
      sortOrder: (index + 1) * 10,
      imageUrl: product.imageUrl,
      previewImageUrl: product.imageUrl,
      imageStoragePath: "",
      previewStoragePath: "",
    };
  });
  return options.activeOnly
    ? products.filter((product) => product.isActive)
    : products;
};

const mapOrderStatus = (status: string): PointOrderStatus => {
  if (status === "APPROVED") return "approved";
  if (status === "REJECTED") return "rejected";
  if (status === "FULFILLED") return "fulfilled";
  return "requested";
};

const mapOrders = (state: WisEconomyState): PointOrder[] => {
  const accountById = new Map(
    [state.account, ...state.accounts]
      .filter((account): account is WisAccount => Boolean(account))
      .map((account) => [account.accountId, account]),
  );
  return state.orders.map((order) => {
    const account = accountById.get(order.accountId);
    const school = account
      ? parseSchoolIdentity(account)
      : { grade: "", class: "", number: "" };
    return {
      id: order.orderId,
      uid: order.studentUid,
      studentName: account?.displayName || "학생",
      ...school,
      productId: order.productId,
      productName: order.productName,
      priceSnapshot: order.totalPrice,
      status: mapOrderStatus(order.status),
      stockDeducted:
        order.status === "APPROVED" || order.status === "FULFILLED",
      requestedAt: order.createdAt,
      reviewedAt: order.reviewedAt,
      reviewedBy: order.reviewedBy,
      memo: order.reviewReason,
    };
  });
};

const compatibilityPolicy = (state: WisEconomyState): PointPolicy => {
  const manualAdjustEnabled =
    state.provenance === "CURRENT" &&
    !state.readOnly &&
    Boolean(state.economy) &&
    ["ACTIVE_INITIALIZING", "ACTIVE_OPEN"].includes(
      state.economy?.status || "",
    );
  return {
    ...POINT_POLICY_FALLBACK,
    manualAdjustEnabled,
    allowNegativeBalance: false,
    controlPolicy: {
      ...POINT_POLICY_FALLBACK.controlPolicy,
      manualAdjustEnabled,
      allowNegativeBalance: false,
    },
  };
};

const limitRows = <T>(items: T[], limitCount?: number) => {
  const limit = Number(limitCount || 0);
  return Number.isFinite(limit) && limit > 0
    ? items.slice(0, Math.floor(limit))
    : items;
};

export const getLegacyStudentPointWalletByUid = async (
  config: ConfigLike,
  uid: string,
  context?: LegacyWisQueryContext,
) => {
  const state = hydrateLegacyStudentWisOwnProjection(
    await queryState(config, "student", context, {
      projection: "student-core",
      limit: 100,
    }),
    uid,
  );
  return state.account ? mapWallet(state, state.account) : null;
};

export const listLegacyStudentPointTransactionsByUid = async (
  config: ConfigLike,
  uid: string,
  limitCount = 100,
  context?: LegacyWisQueryContext,
) => {
  const state = hydrateLegacyStudentWisOwnProjection(
    await queryState(config, "student", context, {
      projection: "student-core",
      limit: Math.min(200, Math.max(1, Math.floor(limitCount || 100))),
    }),
    uid,
  );
  const account = state.account;
  if (!account) return [];
  return limitRows(
    ledgerForAccount(state, account.accountId).map((entry) =>
      mapLedgerEntry(entry, account.studentUid),
    ),
    limitCount,
  );
};

export const getLegacyStudentPointPolicy = async (
  config: ConfigLike,
  uid: string,
  context?: LegacyWisQueryContext,
) =>
  compatibilityPolicy(
    await queryState(config, "student", context, { projection: "summary" }),
  );

export const getLegacyStudentRankEarnedPointsByUid = async (
  config: ConfigLike,
  uid: string,
  context?: LegacyWisQueryContext,
) => {
  const state = await queryState(config, "student", context, {
    projection: "student-core",
    limit: 1,
  });
  return Number(state.account?.rankEarnedTotal || 0);
};

export const getLegacyStudentWisHallOfFameSnapshot = async (
  config: ConfigLike,
  _uid: string,
  context?: LegacyWisQueryContext,
): Promise<WisHallOfFameSnapshot | null> =>
  (
    await queryState(config, "student", context, {
      projection: "hall-of-fame",
      limit: 20,
    })
  ).hallOfFame;

export const listLegacyStudentPointProducts = async (
  config: ConfigLike,
  uid: string,
  activeOnly: boolean,
  context?: LegacyWisQueryContext,
) =>
  mapProducts(
    await queryState(config, "student", context, {
      projection: "catalog",
      limit: 200,
    }),
    {
      activeOnly,
      useAvailableStock: true,
    },
  );

export const listLegacyStudentPointOrders = async (
  config: ConfigLike,
  uid: string,
  options?: LegacyPointOrderOptions,
  context?: LegacyWisQueryContext,
) => {
  const state = hydrateLegacyStudentWisOwnProjection(
    await queryState(config, "student", context, {
      projection: "orders",
      limit: Math.min(200, Math.max(1, Math.floor(options?.limitCount || 100))),
    }),
    uid,
  );
  return limitRows(
    mapOrders(state).filter(
      (order) => !options?.uid || order.uid === options.uid,
    ),
    options?.limitCount,
  );
};

export const requestLegacyStudentWisPurchase = async (input: {
  config: ConfigLike;
  uid: string;
  productId: string;
  memo: string;
  requestKey: string;
  context?: LegacyWisQueryContext;
}) => {
  if (input.memo.trim()) {
    throw new LegacyWisPresentationError(
      "새 위스 원장은 구매 메모를 저장하지 않습니다. 메모를 비운 뒤 다시 요청해 주세요.",
    );
  }
  const intentKey = [
    "student-order",
    semesterKey(input.config),
    input.context?.semesterId || "",
    input.context?.provenance || "CURRENT",
    input.uid,
    input.productId,
    input.requestKey,
  ].join("|");
  const existingIntent =
    getLegacyWisMutationIntent<Parameters<typeof placeWisOrder>[0]>(intentKey);
  if (existingIntent) {
    try {
      const result = await placeWisOrder(existingIntent.payload, {
        commandId: existingIntent.commandId,
      });
      forgetLegacyWisMutationIntent(intentKey);
      return result;
    } catch (error) {
      if (shouldForgetLegacyWisIntentAfterError(error)) {
        forgetLegacyWisMutationIntent(intentKey);
      }
      throw error;
    } finally {
      pendingQueries.clear();
    }
  }

  const [state, catalogState] = await Promise.all([
    queryState(input.config, "student", input.context, {
      projection: "student-core",
      limit: 1,
    }),
    queryState(input.config, "student", input.context, {
      projection: "catalog",
      limit: 200,
    }),
  ]);
  const economy = requireWritableState(state);
  if (!state.account) {
    throw new LegacyWisPresentationError(
      "현재 학기의 학생 위스 계정이 준비되지 않았습니다.",
    );
  }
  const inventory = catalogState.inventory.find(
    (item) => item.productId === input.productId && item.active,
  );
  if (!inventory) {
    throw new LegacyWisPresentationError(
      "선택한 상품의 현재 학기 재고 정보를 찾지 못했습니다.",
    );
  }
  if (inventory.available < 1) {
    throw new LegacyWisPresentationError("선택한 상품의 재고가 없습니다.");
  }
  const intent = getOrCreateLegacyWisMutationIntent(intentKey, () => ({
    semesterId: state.semesterId,
    expectedSemesterRevision: state.manifestRevision,
    expectedEconomyRevision: economy.revision,
    inventoryId: inventory.inventoryId,
    expectedInventoryRevision: inventory.revision,
    expectedAccountRevision: state.account!.revision,
    quantity: 1,
  }));
  try {
    const result = await placeWisOrder(intent.payload, {
      commandId: intent.commandId,
    });
    forgetLegacyWisMutationIntent(intentKey);
    return result;
  } catch (error) {
    if (shouldForgetLegacyWisIntentAfterError(error)) {
      forgetLegacyWisMutationIntent(intentKey);
    }
    throw error;
  } finally {
    pendingQueries.clear();
  }
};

export const listLegacyTeacherPointWallets = async (config: ConfigLike) => {
  const state = await queryAllPages(config, "overview");
  return state.accounts.map((account) => mapWallet(state, account));
};

export const getLegacyTeacherPointSchoolOptions = async (
  config: ConfigLike,
): Promise<{
  grades: LegacySchoolOption[];
  classes: LegacySchoolOption[];
}> => {
  const state = await queryAllPages(config, "overview");
  const identities = state.accounts.map(parseSchoolIdentity);
  const grades = Array.from(
    new Set(identities.map((identity) => identity.grade).filter(Boolean)),
  ).sort((left, right) => Number(left) - Number(right));
  const classes = Array.from(
    new Set(identities.map((identity) => identity.class).filter(Boolean)),
  ).sort((left, right) => Number(left) - Number(right));
  return {
    grades: (grades.length ? grades : ["1", "2", "3"]).map((value) => ({
      value,
      label: `${value}학년`,
    })),
    classes: (classes.length
      ? classes
      : Array.from({ length: 12 }, (_, index) => String(index + 1))
    ).map((value) => ({ value, label: `${value}반` })),
  };
};

export const getLegacyTeacherPointPolicy = async (config: ConfigLike) =>
  compatibilityPolicy(
    await queryCurrentTeacherState(config, { projection: "summary" }),
  );

export type LegacyTeacherWisHallOfFameState = {
  snapshot: WisHallOfFameSnapshot | null;
  hallOfFame: HallOfFameInterfaceConfig | null;
  revision: number;
};

export const getLegacyTeacherWisHallOfFameState = async (
  config: ConfigLike,
): Promise<LegacyTeacherWisHallOfFameState> => {
  const state = await queryCurrentTeacherState(config, {
    projection: "hall-of-fame",
    limit: 20,
  });
  return {
    snapshot: state.hallOfFame,
    hallOfFame: state.hallOfFameConfig,
    revision: state.hallOfFameConfigRevision,
  };
};

export const saveLegacyTeacherWisHallOfFameConfig = async (input: {
  config: ConfigLike;
  hallOfFame: Parameters<typeof saveWisHallOfFameConfig>[0]["hallOfFame"];
  expectedRevision: number;
  actionKey: string;
}): Promise<LegacyTeacherWisHallOfFameState> => {
  const intentKey = [
    "teacher-hall-of-fame-config",
    semesterKey(input.config),
    input.expectedRevision,
    input.actionKey,
  ].join("|");
  type HallConfigPayload = Parameters<typeof saveWisHallOfFameConfig>[0];
  const existingIntent =
    getLegacyWisMutationIntent<HallConfigPayload>(intentKey);
  if (existingIntent) {
    try {
      await saveWisHallOfFameConfig(existingIntent.payload, {
        commandId: existingIntent.commandId,
      });
      forgetLegacyWisMutationIntent(intentKey);
      pendingQueries.clear();
      return getLegacyTeacherWisHallOfFameState(input.config);
    } catch (error) {
      if (shouldForgetLegacyWisIntentAfterError(error)) {
        forgetLegacyWisMutationIntent(intentKey);
      }
      throw error;
    }
  }
  const state = await queryCurrentTeacherState(input.config, {
    projection: "summary",
  });
  const economy = requireWritableState(state);
  const intent = getOrCreateLegacyWisMutationIntent<HallConfigPayload>(
    intentKey,
    () => ({
      semesterId: state.semesterId,
      expectedSemesterRevision: state.manifestRevision,
      expectedEconomyRevision: economy.revision,
      expectedHallOfFameRevision: input.expectedRevision,
      hallOfFame: input.hallOfFame,
      reason: "화랑의 전당 공개 범위와 배치 설정 저장",
    }),
  );
  try {
    await saveWisHallOfFameConfig(intent.payload, {
      commandId: intent.commandId,
    });
    forgetLegacyWisMutationIntent(intentKey);
    pendingQueries.clear();
    return getLegacyTeacherWisHallOfFameState(input.config);
  } catch (error) {
    if (shouldForgetLegacyWisIntentAfterError(error)) {
      forgetLegacyWisMutationIntent(intentKey);
    }
    throw error;
  }
};

export const listLegacyTeacherPointProducts = async (
  config: ConfigLike,
  activeOnly = false,
) =>
  mapProducts(await queryAllPages(config, "catalog"), {
    activeOnly,
    useAvailableStock: false,
  });

export const listLegacyTeacherPointOrders = async (
  config: ConfigLike,
  options?: LegacyPointOrderOptions,
) =>
  limitRows(
    mapOrders(
      await queryCurrentTeacherState(config, {
        projection: "orders",
        limit: Math.min(
          200,
          Math.max(1, Math.floor(options?.limitCount || 100)),
        ),
      }),
    ).filter((order) => !options?.uid || order.uid === options.uid),
    options?.limitCount,
  );

export const getLegacyTeacherRankEarnedPointsMap = async (
  config: ConfigLike,
) => {
  const state = await queryAllPages(config, "overview");
  return Object.fromEntries(
    state.accounts.map((account) => [
      account.studentUid,
      Number(account.rankEarnedTotal || 0),
    ]),
  );
};

export const listLegacyTeacherPointTransactionsByUid = async (
  config: ConfigLike,
  uid: string,
  limitCount = 100,
) => {
  const overview = await queryAllPages(config, "overview");
  const account = overview.accounts.find((item) => item.studentUid === uid);
  if (!account) return [];
  const state = await queryCurrentTeacherState(config, {
    projection: "account",
    accountId: account.accountId,
    limit: Math.min(200, Math.max(1, Math.floor(limitCount || 100))),
  });
  return limitRows(
    ledgerForAccount(state, account.accountId).map((entry) =>
      mapLedgerEntry(entry, account.studentUid),
    ),
    limitCount,
  );
};

const mapStudentTargets = (state: WisEconomyState): PointStudentTarget[] => {
  return state.accounts.map((account) => ({
    uid: account.studentUid,
    studentName: account.displayName || "학생",
    ...parseSchoolIdentity(account),
    email: "",
  }));
};

export const listLegacyTeacherPointStudentTargets = async (
  config: ConfigLike,
) => {
  const state = await queryAllPages(config, "overview");
  return mapStudentTargets(state);
};

export const listLegacyTeacherPointStudentTargetsByClass = async (
  config: ConfigLike,
  grade: string,
  className: string,
) => {
  const state = await queryAllPages(config, "overview");
  return mapStudentTargets(state).filter(
    (student) => student.grade === grade && student.class === className,
  );
};

export const adjustLegacyTeacherWis = async (input: {
  config: ConfigLike;
  uid: string;
  delta: number;
  sourceLabel: string;
  mode: "grant" | "reclaim";
  actionKey: string;
}) => {
  const amount = Math.abs(Math.trunc(Number(input.delta)));
  if (!Number.isFinite(amount) || amount < 1) {
    throw new LegacyWisPresentationError(
      "지급하거나 환수할 위스를 1 이상 입력해 주세요.",
    );
  }
  const intentKey = [
    "teacher-adjust",
    semesterKey(input.config),
    input.uid,
    input.mode,
    amount,
    input.sourceLabel.trim(),
    input.actionKey,
  ].join("|");
  type AdjustmentPayload = Parameters<typeof grantWis>[0];
  const existingIntent =
    getLegacyWisMutationIntent<AdjustmentPayload>(intentKey);
  if (existingIntent) {
    try {
      const result =
        input.mode === "reclaim"
          ? await deductWis(existingIntent.payload, {
              commandId: existingIntent.commandId,
            })
          : await grantWis(existingIntent.payload, {
              commandId: existingIntent.commandId,
            });
      forgetLegacyWisMutationIntent(intentKey);
      return result;
    } catch (error) {
      if (shouldForgetLegacyWisIntentAfterError(error)) {
        forgetLegacyWisMutationIntent(intentKey);
      }
      throw error;
    } finally {
      pendingQueries.clear();
    }
  }

  const state = await queryAllPages(input.config, "overview");
  const economy = requireWritableState(state);
  const account = state.accounts.find((item) => item.studentUid === input.uid);
  if (!account) {
    throw new LegacyWisPresentationError(
      "선택한 학생의 현재 학기 위스 계정을 찾지 못했습니다.",
    );
  }
  const intent = getOrCreateLegacyWisMutationIntent<AdjustmentPayload>(
    intentKey,
    (commandId) => ({
      semesterId: state.semesterId,
      expectedSemesterRevision: state.manifestRevision,
      expectedEconomyRevision: economy.revision,
      accountId: account.accountId,
      expectedAccountRevision: account.revision,
      amount,
      sourceId: `legacy-w10p:${input.mode}:${commandId}`,
      reason: input.sourceLabel.trim() || "교사 위스 조정",
    }),
  );
  try {
    const result =
      input.mode === "reclaim"
        ? await deductWis(intent.payload, { commandId: intent.commandId })
        : await grantWis(intent.payload, { commandId: intent.commandId });
    forgetLegacyWisMutationIntent(intentKey);
    return result;
  } catch (error) {
    if (shouldForgetLegacyWisIntentAfterError(error)) {
      forgetLegacyWisMutationIntent(intentKey);
    }
    throw error;
  } finally {
    pendingQueries.clear();
  }
};

export const saveLegacyTeacherPointPolicy = async (
  _config: ConfigLike,
  _policy: Partial<PointPolicy>,
  _actor: LegacyActor,
) => {
  throw new LegacyWisPresentationError(
    "기존 운영 정책과 등급 꾸미기는 현재 위스 원장에 자동 변환할 수 없어 저장할 수 없습니다.",
  );
};

const findInventory = (
  state: WisEconomyState,
  productId: string,
): WisInventory | undefined =>
  state.inventory.find((inventory) => inventory.productId === productId);

export const saveLegacyTeacherPointProduct = async (
  config: ConfigLike,
  product: Partial<PointProduct> & Pick<PointProduct, "name" | "price">,
  _actor: LegacyActor,
) => {
  const state = await queryAllPages(config, "catalog");
  const economy = requireWritableState(state);
  const productId = String(product.id || "").trim();
  const currentProduct = state.products.find(
    (item) => item.productId === productId,
  );
  const currentInventory = productId
    ? findInventory(state, productId)
    : undefined;
  const price = Math.trunc(Number(product.price));
  const stock = Math.trunc(Number(product.stock || 0));
  if (!String(product.name || "").trim()) {
    throw new LegacyWisPresentationError("상품 이름을 입력해 주세요.");
  }
  if (!Number.isFinite(price) || price < 1) {
    throw new LegacyWisPresentationError(
      "상품 가격을 1위스 이상 입력해 주세요.",
    );
  }
  if (!Number.isFinite(stock) || stock < 0) {
    throw new LegacyWisPresentationError("상품 재고를 0개 이상 입력해 주세요.");
  }
  if (!currentProduct || !currentInventory) {
    throw new LegacyWisPresentationError(
      "상품과 재고를 한 번에 안전하게 등록하는 기능이 준비되지 않아 새 상품을 저장할 수 없습니다.",
    );
  }

  const nextName = String(product.name).trim();
  const nextDescription = String(product.description || "").trim();
  const nextImageUrl = String(
    product.imageUrl || currentProduct.imageUrl || "",
  ).trim();
  const nextActive = product.isActive !== false;
  const productChanged =
    currentProduct.name !== nextName ||
    currentProduct.description !== nextDescription ||
    currentProduct.imageUrl !== nextImageUrl ||
    currentProduct.active !== nextActive;
  const inventoryChanged =
    currentInventory.price !== price || currentInventory.stock !== stock;

  if (productChanged && inventoryChanged) {
    throw new LegacyWisPresentationError(
      "상품 정보와 가격·재고를 동시에 바꿀 수 없습니다. 한 종류씩 나누어 저장해 주세요.",
    );
  }
  if (productChanged) {
    await upsertWisProduct({
      semesterId: state.semesterId,
      expectedSemesterRevision: state.manifestRevision,
      expectedEconomyRevision: economy.revision,
      productId,
      expectedProductRevision: currentProduct.revision,
      name: nextName,
      description: nextDescription,
      imageUrl: nextImageUrl,
      active: nextActive,
      reason: "기존 상품 정보 변경",
    });
  } else if (inventoryChanged) {
    await upsertWisInventory({
      semesterId: state.semesterId,
      expectedSemesterRevision: state.manifestRevision,
      expectedEconomyRevision: economy.revision,
      productId,
      expectedInventoryRevision: currentInventory.revision,
      price,
      stock,
      active: currentInventory.active,
      reason: "기존 학기 재고 변경",
    });
  }
  pendingQueries.clear();
  return product;
};

export const deleteLegacyTeacherPointProduct = async (
  _config: ConfigLike,
  _productId: string,
) => {
  throw new LegacyWisPresentationError(
    "현재 위스 상품은 원장 근거를 위해 삭제하지 않습니다. 상품을 숨김 상태로 전환해 주세요.",
  );
};

export const reviewLegacyTeacherPointOrder = async (input: {
  config: ConfigLike;
  orderId: string;
  nextStatus: PointOrderStatus;
  actor: LegacyActor;
  memo: string;
}) => {
  const action =
    input.nextStatus === "approved"
      ? "APPROVE"
      : input.nextStatus === "rejected"
        ? "REJECT"
        : input.nextStatus === "fulfilled"
          ? "FULFILL"
          : null;
  if (!action) {
    throw new LegacyWisPresentationError(
      "현재 위스 주문은 승인 취소나 별도 취소 상태를 지원하지 않습니다. 요청 상태에 맞춰 승인·반려·지급 완료 중 하나를 선택해 주세요.",
    );
  }
  const state = await queryAllPages(input.config, "orders");
  const economy = requireWritableState(state);
  const order = state.orders.find((item) => item.orderId === input.orderId);
  if (!order) {
    throw new LegacyWisPresentationError("처리할 구매 요청을 찾지 못했습니다.");
  }
  const result = await reviewWisOrder({
    semesterId: state.semesterId,
    expectedSemesterRevision: state.manifestRevision,
    expectedEconomyRevision: economy.revision,
    orderId: order.orderId,
    expectedOrderRevision: order.revision,
    action,
    reason:
      input.memo.trim() ||
      (action === "REJECT" ? "교사 확인 후 반려" : "교사 확인 완료"),
  });
  pendingQueries.clear();
  return {
    orderId: order.orderId,
    transactionId: "",
    status: input.nextStatus,
    duplicate: Boolean(result.replayed),
  };
};

export const updateLegacyTeacherPointAdjustment = async (input: {
  config: ConfigLike;
  transactionId: string;
  action: "update" | "cancel";
  nextDelta?: number;
}) => {
  if (input.action === "update") {
    void input.nextDelta;
    throw new LegacyWisPresentationError(
      "새 위스 원장 항목은 수정할 수 없습니다. 기존 항목을 취소한 뒤 새 금액으로 다시 지급하거나 환수해 주세요.",
    );
  }
  const state = await queryCurrentTeacherState(input.config, {
    projection: "account",
    ledgerEntryId: input.transactionId,
    limit: 1,
  });
  const economy = requireWritableState(state);
  const entry = state.ledger.find(
    (item) => item.ledgerEntryId === input.transactionId,
  );
  if (!entry) {
    throw new LegacyWisPresentationError(
      "취소할 위스 원장 항목을 찾지 못했습니다.",
    );
  }
  const account = state.accounts.find(
    (item) => item.accountId === entry.accountId,
  );
  if (!account) {
    throw new LegacyWisPresentationError("학생 위스 계정을 찾지 못했습니다.");
  }
  const result = await reverseWisEntry({
    semesterId: state.semesterId,
    expectedSemesterRevision: state.manifestRevision,
    expectedEconomyRevision: economy.revision,
    accountId: account.accountId,
    expectedAccountRevision: account.revision,
    ledgerEntryId: entry.ledgerEntryId,
    reason: "기존 화면에서 교사 직접 조정 취소",
  });
  pendingQueries.clear();
  return {
    walletId: account.studentUid,
    transactionId: entry.ledgerEntryId,
    balance: Number(result.result.balance || account.balance),
    delta: -entry.delta,
    cancelled: true,
  };
};
