import { auth } from "./firebase";
import { readStorage, writeStorage, removeStorage } from "./safeStorage";
import {
  assertWisOwner,
  queryWisState,
  queryAllWisState,
  wisSemesterId,
  wisWallet,
  wisTransaction,
  wisProducts,
  wisOrder,
  wisHallOfFame,
  wisRevisionScope,
  runWisOperation,
  type WisConfig,
  type WisRow,
  type WisState,
} from "./wisEconomyClient";
import type {
  PointProduct,
  PointOrderStatus,
  PointTransactionType,
  HallOfFameInterfaceConfig,
} from "../types";

export const getCanonicalWisHallOfFame = async (config: WisConfig) =>
  wisHallOfFame(await queryWisState(config, "teacher", "hall-of-fame"));
export const saveCanonicalWisHallOfFameConfig = async (
  config: WisConfig,
  hallOfFame: HallOfFameInterfaceConfig,
) =>
  runWisOperation(
    ["hall-of-fame-config", wisSemesterId(config), hallOfFame],
    true,
    async (step) => {
      const result = await step("config", async () => {
        const state = await queryWisState(config, "teacher", "hall-of-fame");
        return {
          commandType: "saveWisHallOfFameConfig",
          payload: {
            ...wisRevisionScope(state),
            expectedHallOfFameRevision: state.hallOfFameConfigRevision,
            hallOfFame,
            reason: "교사 명예의 전당 설정 변경",
          },
        };
      });
      return {
        saved: true,
        hallOfFame: result.hallOfFame as HallOfFameInterfaceConfig,
      };
    },
  );

const accountState = async (config: WisConfig, uid: string) => {
  const owner = auth.currentUser;
  const overview = await queryAllWisState(config, "overview");
  const account = overview.accounts.find((item) => item.studentUid === uid);
  if (!account)
    throw new Error("현재 학기에 등록된 학생의 위스 계정을 찾지 못했습니다.");
  const state = await queryWisState(config, "teacher", "account", {
    accountId: account.accountId,
  });
  if (auth.currentUser !== owner || state.account?.studentUid !== uid)
    throw new Error(
      "학생 또는 로그인 계정이 바뀌었습니다. 다시 확인해 주세요.",
    );
  return state;
};
const requireAccount = (state: WisState) => {
  if (!state.account)
    throw new Error("학생의 위스 계정을 확인하지 못했습니다.");
  return state.account;
};
export const getCanonicalPointWallet = async (
  config: WisConfig,
  uid: string,
) => {
  const state = await accountState(config, uid);
  return state.account ? wisWallet(state.account) : null;
};
export const listCanonicalPointWallets = async (config: WisConfig) =>
  (await queryAllWisState(config, "overview")).accounts
    .map(wisWallet)
    .sort(
      (a, b) =>
        b.balance - a.balance ||
        a.studentName.localeCompare(b.studentName, "ko"),
    );
export const listCanonicalPointStudentTargets = async (config: WisConfig) =>
  (await listCanonicalPointWallets(config)).map((wallet) => ({
    uid: wallet.uid,
    studentName: wallet.studentName,
    grade: wallet.grade,
    class: wallet.class,
    number: wallet.number,
    email: "",
  }));
export const listCanonicalPointTransactions = async (
  config: WisConfig,
  options?: { uid?: string; type?: PointTransactionType; limitCount?: number },
) => {
  const states = options?.uid
    ? [await accountState(config, options.uid)]
    : await Promise.all(
        (await queryAllWisState(config, "overview")).accounts.map((account) =>
          queryWisState(config, "teacher", "account", {
            accountId: account.accountId,
          }),
        ),
      );
  const rows = states
    .flatMap((state) =>
      state.ledger.map((entry) =>
        wisTransaction(
          entry,
          state.account?.studentUid || entry.studentUid || "",
        ),
      ),
    )
    .filter(
      (entry) =>
        !options?.type ||
        entry.type === options.type ||
        entry.activityType === options.type,
    )
    .sort(
      (a, b) =>
        (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0),
    );
  return options?.limitCount ? rows.slice(0, options.limitCount) : rows;
};
export const listCanonicalPointProducts = async (
  config: WisConfig,
  activeOnly = false,
) => wisProducts(await queryAllWisState(config, "catalog"), activeOnly);
export const listCanonicalPointOrders = async (
  config: WisConfig,
  options?: { uid?: string; limitCount?: number },
) => {
  const state = await queryAllWisState(config, "orders");
  const rows = state.orders
    .filter((order) => !options?.uid || order.studentUid === options.uid)
    .map((order) =>
      wisOrder(
        order,
        state.accounts.find((account) => account.accountId === order.accountId),
      ),
    );
  return options?.limitCount ? rows.slice(0, options.limitCount) : rows;
};
export const adjustCanonicalPoints = async (input: {
  config: WisConfig;
  uid: string;
  delta: number;
  sourceId?: string;
  sourceLabel?: string;
  actor: { uid: string };
  mode?: string;
}) => {
  assertWisOwner(input.actor.uid);
  if (!Number.isSafeInteger(input.delta) || !input.delta)
    throw new Error("위스는 0이 아닌 정수로 입력해 주세요.");
  return runWisOperation(
    [
      "adjust",
      wisSemesterId(input.config),
      input.uid,
      input.delta,
      input.sourceId || "",
      input.sourceLabel || "",
    ],
    true,
    async (step) => {
      const result = await step("adjust", async () => {
        const state = await accountState(input.config, input.uid),
          account = requireAccount(state);
        return {
          commandType: input.delta > 0 ? "grantWis" : "deductWis",
          payload: {
            ...wisRevisionScope(state),
            accountId: account.accountId,
            expectedAccountRevision: account.revision,
            amount: Math.abs(input.delta),
            sourceId: input.sourceId || `manual-${crypto.randomUUID()}`,
            reason: input.sourceLabel?.trim() || "교사 직접 조정",
          },
        };
      });
      return {
        walletId: result.accountId,
        transactionId: result.ledgerEntryId,
        balance: result.balance,
        type:
          input.delta > 0
            ? ("manual_adjust" as const)
            : ("manual_reclaim" as const),
      };
    },
  );
};
export const upsertCanonicalPointProduct = async (
  config: WisConfig,
  product: Partial<PointProduct> & Pick<PointProduct, "name" | "price">,
  actor: { uid: string },
) => {
  assertWisOwner(actor.uid);
  const value = {
    id: product.id || "",
    name: product.name.trim(),
    description: (product.description || "").trim(),
    price: Number(product.price),
    stock: Number(product.stock || 0),
    isActive: product.isActive !== false,
    imageUrl: (product.imageUrl || "").trim(),
  };
  if (
    !value.name ||
    !Number.isSafeInteger(value.price) ||
    value.price < 1 ||
    !Number.isSafeInteger(value.stock) ||
    value.stock < 0
  )
    throw new Error(
      "상품명과 1 이상의 정수 가격, 0 이상의 정수 재고를 입력해 주세요.",
    );
  return runWisOperation(
    ["product", wisSemesterId(config), value],
    true,
    async (step) => {
      const saved = await step("product", async () => {
        const state = await queryAllWisState(config, "catalog"),
          existing = state.products.find((item) => item.productId === value.id);
        if (value.id && !existing)
          throw new Error(
            "상품 정보가 변경되었습니다. 목록을 새로고침해 주세요.",
          );
        return {
          commandType: "upsertWisProduct",
          payload: {
            ...wisRevisionScope(state),
            productId:
              value.id || `wisprod_${crypto.randomUUID().replace(/-/g, "")}`,
            expectedProductRevision: existing?.revision ?? null,
            name: value.name,
            description: value.description,
            imageUrl: value.imageUrl,
            active: value.isActive,
            reason: "위스 상점 상품 저장",
          },
        };
      });
      await step("inventory", async () => {
        const state = await queryAllWisState(config, "catalog");
        const current = state.inventory.find(
          (item) => item.productId === saved.productId,
        );
        return {
          commandType: "upsertWisInventory",
          payload: {
            ...wisRevisionScope(state),
            productId: saved.productId,
            expectedInventoryRevision:
              current?.revision ?? saved.inventoryRevision ?? null,
            price: value.price,
            stock: value.stock,
            active: value.isActive,
            reason: "위스 상점 가격 및 재고 저장",
          },
        };
      });
      return {
        id: saved.productId,
        name: value.name,
        description: value.description,
        price: value.price,
        stock: value.stock,
        isActive: value.isActive,
        imageUrl: value.imageUrl,
        sortOrder: 0,
      };
    },
  );
};
export const archiveCanonicalPointProduct = async (
  config: WisConfig,
  productId: string,
) => {
  const products = await listCanonicalPointProducts(config),
    product = products.find((item) => item.id === productId);
  if (!product) throw new Error("상품을 찾지 못했습니다.");
  await upsertCanonicalPointProduct(
    config,
    { ...product, isActive: false },
    { uid: auth.currentUser?.uid || "" },
  );
};
export const reviewCanonicalPointOrder = async (input: {
  config: WisConfig;
  orderId: string;
  nextStatus: PointOrderStatus;
  actor: { uid: string };
  memo?: string;
}) => {
  assertWisOwner(input.actor.uid);
  const actions: Partial<Record<PointOrderStatus, string>> = {
    approved: "APPROVE",
    rejected: "REJECT",
    cancelled: "REJECT",
    fulfilled: "FULFILL",
  };
  const action = actions[input.nextStatus];
  if (!action) throw new Error("승인한 주문은 지급 처리로 이어집니다.");
  return runWisOperation(
    [
      "review",
      wisSemesterId(input.config),
      input.orderId,
      action,
      input.memo || "",
    ],
    true,
    async (step) => {
      const result = await step("review", async () => {
        const state = await queryAllWisState(input.config, "orders"),
          order = state.orders.find((item) => item.orderId === input.orderId);
        if (!order) throw new Error("주문을 찾지 못했습니다.");
        return {
          commandType: "reviewWisOrder",
          payload: {
            ...wisRevisionScope(state),
            orderId: input.orderId,
            expectedOrderRevision: order.revision,
            action,
            reason:
              input.memo?.trim() ||
              (action === "REJECT"
                ? "교사 주문 반려"
                : action === "FULFILL"
                  ? "상품 지급 완료"
                  : "교사 주문 승인"),
          },
        };
      });
      return {
        orderId: result.orderId,
        transactionId: result.refundLedgerEntryId || "",
        status: String(result.status).toLowerCase() as PointOrderStatus,
      };
    },
  );
};
type AdjustmentRecovery = {
  transactionId: string;
  action: "update" | "cancel";
  nextDelta?: number;
};
const adjustmentRecoveryKey = (config: WisConfig) =>
  `westoryWisAdjustmentRecovery:${auth.currentUser?.uid || ""}:${wisSemesterId(config)}`;
export const getPendingCanonicalPointAdjustment = (
  config: WisConfig,
): AdjustmentRecovery | null => {
  if (!auth.currentUser) return null;
  try {
    const value = JSON.parse(
      readStorage(adjustmentRecoveryKey(config)) || "null",
    );
    if (
      typeof value?.transactionId !== "string" ||
      !value.transactionId ||
      !["update", "cancel"].includes(value.action)
    )
      return null;
    if (
      value.action === "update" &&
      (!Number.isSafeInteger(value.nextDelta) || !value.nextDelta)
    )
      return null;
    return {
      transactionId: value.transactionId,
      action: value.action,
      ...(value.action === "update" ? { nextDelta: value.nextDelta } : {}),
    };
  } catch {
    return null;
  }
};
export const updateCanonicalPointAdjustment = async (input: {
  config: WisConfig;
  transactionId: string;
  action: "update" | "cancel";
  nextDelta?: number;
}) => {
  if (
    input.action === "update" &&
    (!Number.isSafeInteger(input.nextDelta) || !input.nextDelta)
  )
    throw new Error("수정 위스는 0이 아닌 정수로 입력해 주세요.");
  const recoveryKey = adjustmentRecoveryKey(input.config);
  const recovery: AdjustmentRecovery = {
    transactionId: input.transactionId,
    action: input.action,
    ...(input.action === "update" ? { nextDelta: input.nextDelta } : {}),
  };
  const previous = getPendingCanonicalPointAdjustment(input.config);
  if (previous && JSON.stringify(previous) !== JSON.stringify(recovery))
    throw new Error("이전 조정의 결과를 먼저 확인해 주세요.");
  const retainRecovery = () =>
    writeStorage(recoveryKey, JSON.stringify(recovery));
  return runWisOperation(
    [
      "adjustment",
      wisSemesterId(input.config),
      input.transactionId,
      input.action,
      input.nextDelta ?? null,
    ],
    true,
    async (step) => {
      const reversed = await step("reverse", async () => {
        const state = await queryWisState(input.config, "teacher", "account", {
            ledgerEntryId: input.transactionId,
          }),
          account = requireAccount(state);
        const entry = state.ledger.find(
          (item) => item.ledgerEntryId === input.transactionId,
        );
        if (
          !entry ||
          entry.reversalEntryId ||
          !["GRANT", "DEDUCT", "ADJUST"].includes(entry.type)
        )
          throw new Error(
            "취소할 수 있는 직접 조정 내역을 다시 선택해 주세요.",
          );
        return {
          commandType: "reverseWisEntry",
          payload: {
            ...wisRevisionScope(state),
            accountId: account.accountId,
            expectedAccountRevision: account.revision,
            ledgerEntryId: input.transactionId,
            reason:
              input.action === "update"
                ? "직접 조정 수정: 기존 내역 취소"
                : "교사 직접 조정 취소",
          },
        };
      }).catch((error) => {
        if (
          /(?:unavailable|deadline-exceeded|internal|network-request-failed)$/.test(
            String(error?.code || ""),
          )
        )
          retainRecovery();
        throw error;
      });
      retainRecovery();
      if (input.action === "cancel")
        return {
          walletId: reversed.accountId,
          transactionId: input.transactionId,
          balance: reversed.balance,
          delta: 0,
          cancelled: true,
        };
      const adjusted = await step("replacement", async () => {
        const state = await queryWisState(input.config, "teacher", "account", {
            ledgerEntryId: input.transactionId,
          }),
          account = requireAccount(state);
        return {
          commandType: Number(input.nextDelta) > 0 ? "grantWis" : "deductWis",
          payload: {
            ...wisRevisionScope(state),
            accountId: account.accountId,
            expectedAccountRevision: account.revision,
            amount: Math.abs(Number(input.nextDelta)),
            sourceId: `correction-${input.transactionId}`,
            reason: "교사 직접 조정 수정",
          },
        };
      }).catch((error) => {
        throw Object.assign(
          new Error(
            "기존 조정은 취소되었습니다. 새 금액 반영 결과를 확인하지 못했습니다. 같은 금액으로 다시 저장하면 이어서 처리합니다.",
          ),
          { code: error?.code, details: error?.details },
        );
      });
      return {
        walletId: adjusted.accountId,
        transactionId: adjusted.ledgerEntryId,
        balance: adjusted.balance,
        delta: Number(input.nextDelta),
        cancelled: false,
      };
    },
  ).then((result) => {
    removeStorage(recoveryKey);
    return result;
  });
};
export const createCanonicalPurchase = async (input: {
  config: WisConfig;
  productId: string;
  expectedPrice?: number;
  memo?: string;
  requestKey: string;
}) => {
  if (!input.requestKey) throw new Error("구매할 상품을 다시 선택해 주세요.");
  return runWisOperation(
    ["purchase", wisSemesterId(input.config), input.requestKey],
    false,
    async (step) => {
      const result = await step("purchase", async () => {
        const state = await queryWisState(input.config, "student", "catalog"),
          account = requireAccount(state);
        const inventory = state.inventory.find(
          (item) =>
            item.productId === input.productId &&
            item.active &&
            item.available > 0,
        );
        if (!inventory)
          throw new Error("재고가 없습니다. 상품 목록을 새로고침해 주세요.");
        if (
          input.expectedPrice !== undefined &&
          Number(inventory.price) !== input.expectedPrice
        )
          throw new Error(
            "상품 가격이 변경되었습니다. 목록을 새로고침한 뒤 다시 선택해 주세요.",
          );
        return {
          commandType: "placeWisOrder",
          payload: {
            ...wisRevisionScope(state),
            inventoryId: inventory.inventoryId,
            expectedInventoryRevision: inventory.revision,
            expectedAccountRevision: account.revision,
            quantity: 1,
            memo: input.memo?.trim() || "",
          },
        };
      });
      return {
        created: true,
        duplicate: false,
        orderId: result.orderId,
        transactionId: result.ledgerEntryId,
        balance: result.balance,
      };
    },
    true,
  );
};
