import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useAppToast } from "../../components/common/AppToastProvider";
import WisIcon from "../../components/common/WisIcon";
import {
  AVATAR_ITEMS,
  AVATAR_SLOTS,
  defaultAvatarLook,
  ownsAvatarItem,
  selectAvatarItem,
  type AvatarItem,
  type AvatarLook,
  type AvatarSlot,
  type AvatarState,
} from "./catalog";
import {
  avatarErrorMessage,
  avatarPricingFromError,
  getAvatarStudioState,
  makeAvatarThumbnail,
  purchaseAvatarItem,
  saveStudentAvatar,
  type AvatarPurchaseResult,
  type AvatarCatalogPricingState,
} from "./service";
import AvatarStage from "./AvatarStage";
import AvatarPlaceholder from "./AvatarPlaceholder";
import AvatarItemPreview from "./AvatarItemPreview";
import { getAvatarItemGroup } from "./itemPresentation";
import "./avatarStudio.css";

export interface AvatarStudioAdapter {
  load(): Promise<{
    avatar: AvatarState;
    balance: number | null;
    pricing?: AvatarCatalogPricingState;
  }>;
  purchase(
    itemId: string,
    expectedPrice: number,
    expectedPricingRevision: number,
  ): Promise<AvatarPurchaseResult>;
  save(
    look: AvatarLook,
    revision: number,
    thumbnail: string,
  ): Promise<AvatarState>;
}
type StageControls = {
  capture(): string;
  resetView(): void;
  focusFace(): void;
  rotate(angle: number): void;
  animateOnce?(duration?: number): void;
  stop?(): void;
};

export function AvatarStudio({
  adapter,
  access = "student",
  active = true,
}: {
  adapter: AvatarStudioAdapter;
  access?: "student" | "teacher";
  active?: boolean;
}) {
  const allAvailable = access === "teacher";
  const { showToast } = useAppToast();
  const [saved, setSaved] = useState<AvatarState | null>(null);
  const [look, setLook] = useState<AvatarLook>(defaultAvatarLook());
  const [characterChosen, setCharacterChosen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [pricing, setPricing] = useState<AvatarCatalogPricingState>({
    revision: 0,
    prices: {},
  });
  const [slot, setSlot] = useState<AvatarSlot>("top");
  const [filter, setFilter] = useState<"all" | "owned" | "premium">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"buy" | "save" | null>(null);
  const [ready, setReady] = useState(false);
  const [stageError, setStageError] = useState("");
  const [stageKey, setStageKey] = useState(0);
  const [purchase, setPurchase] = useState<AvatarItem | null>(null);
  const [confirmError, setConfirmError] = useState("");
  const stage = useRef<StageControls | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const data = await adapter.load();
      if (current !== generation.current) return;
      setSaved(data.avatar);
      setLook(data.avatar.look);
      setCharacterChosen(Boolean(data.avatar.thumbnailUrl));
      setBalance(data.balance);
      setPricing(data.pricing || { revision: 0, prices: {} });
    } catch (failure) {
      if (current === generation.current) setError(avatarErrorMessage(failure));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [adapter]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
      stage.current = null;
    };
  }, [load]);
  useEffect(() => {
    if (purchase && !dialog.current?.open) dialog.current?.showModal();
    else if (!purchase && dialog.current?.open) dialog.current?.close();
  }, [purchase]);
  useEffect(() => {
    if (!active) {
      stage.current = null;
      setReady(false);
    }
  }, [active]);
  useEffect(() => {
    if (
      saved &&
      characterChosen &&
      (!saved.thumbnailUrl ||
        JSON.stringify(saved.look) !== JSON.stringify(look))
    ) {
      const prevent = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", prevent);
      return () => window.removeEventListener("beforeunload", prevent);
    }
  }, [saved, look, characterChosen]);
  const onReady = useCallback((controller: StageControls) => {
    stage.current = controller;
    setReady(true);
    setStageError("");
  }, []);
  const onStageError = useCallback(() => {
    stage.current = null;
    setReady(false);
    setStageError("3D를 불러오지 못했습니다. 다시 시도해 주세요.");
  }, []);
  const onLoadingChange = useCallback((value: boolean) => {
    if (value) {
      stage.current = null;
      setReady(false);
    }
  }, []);
  const owned = saved?.ownedItemIds || [];
  const pricedItems = useMemo(
    () =>
      AVATAR_ITEMS.map((item) => {
        const price = pricing.prices[item.id];
        return Number.isSafeInteger(price) && price >= 0 && price <= 1_000_000
          ? { ...item, price }
          : item;
      }),
    [pricing],
  );
  const available = (item: AvatarItem) =>
    allAvailable || ownsAvatarItem(item, owned);
  const itemForCurrentLook = (key: AvatarSlot) =>
    pricedItems.find(
      (item) =>
        item.slot === key &&
        item.value === look[key] &&
        item.characters.includes(look.character),
    );
  const selected = itemForCurrentLook(slot);
  const items = pricedItems.filter(
    (item) =>
      item.slot === slot &&
      item.characters.includes(look.character) &&
      (filter !== "owned" || available(item)) &&
      (filter !== "premium" || item.price > 0),
  );
  const missing = AVATAR_SLOTS.map(({ key }) => itemForCurrentLook(key)).filter(
    (item): item is AvatarItem => Boolean(item && !available(item)),
  );
  const dirty =
    saved &&
    characterChosen &&
    (!saved.thumbnailUrl ||
      JSON.stringify(saved.look) !== JSON.stringify(look));
  const choose = (item: AvatarItem) => {
    if (busyRef.current) return;
    if (item.slot !== "character" && !characterChosen) return;
    if (item.slot === "character" && !available(item)) setSlot("character");
    if (
      item.slot === "character" &&
      (!characterChosen || item.value !== look.character)
    ) {
      stage.current = null;
      setReady(false);
      setCharacterChosen(true);
    }
    setLook((previous) => selectAvatarItem(previous, item));
  };
  const buy = async () => {
    if (allAvailable || !characterChosen || !purchase || busyRef.current)
      return;
    busyRef.current = true;
    setBusy("buy");
    setConfirmError("");
    setError("");
    const current = generation.current;
    try {
      const result = await adapter.purchase(
        purchase.id,
        purchase.price,
        pricing.revision,
      );
      if (current !== generation.current) return;
      setSaved(result.avatar);
      setBalance(result.wallet.balance);
      if (result.pricing) setPricing(result.pricing);
      setPurchase(null);
      showToast({
        title: result.alreadyOwned
          ? "이미 보유한 아이템입니다"
          : "구매했습니다",
        message: result.charged
          ? `${result.charged.toLocaleString()} 위스를 사용했습니다.`
          : undefined,
        tone: "success",
      });
    } catch (failure) {
      if (current === generation.current) {
        const updatedPricing = avatarPricingFromError(failure);
        if (updatedPricing) {
          setPricing(updatedPricing);
          setPurchase(null);
          setError(avatarErrorMessage(failure));
        } else setConfirmError(avatarErrorMessage(failure));
      }
    } finally {
      busyRef.current = false;
      if (current === generation.current) setBusy(null);
    }
  };
  const save = async () => {
    if (
      !characterChosen ||
      !saved ||
      !stage.current ||
      busyRef.current ||
      missing.length
    )
      return;
    busyRef.current = true;
    setBusy("save");
    setError("");
    const current = generation.current;
    try {
      stage.current.stop?.();
      stage.current.resetView();
      // Let the on-demand renderer draw the reset camera before capturing.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (current !== generation.current || !stage.current) return;
      const thumbnail = await makeAvatarThumbnail(stage.current.capture());
      if (current !== generation.current) return;
      const result = await adapter.save(look, saved.revision, thumbnail);
      if (current !== generation.current) return;
      setSaved(result);
      setLook(result.look);
      showToast({ title: "아바타를 저장했습니다", tone: "success" });
    } catch (failure) {
      if (current === generation.current) {
        const updatedPricing = avatarPricingFromError(failure);
        if (updatedPricing) setPricing(updatedPricing);
        setError(avatarErrorMessage(failure));
      }
    } finally {
      busyRef.current = false;
      if (current === generation.current) setBusy(null);
    }
  };
  if (loading)
    return (
      <div className="avatar-studio-status" role="status">
        {allAvailable
          ? "아바타를 불러오는 중입니다."
          : "아바타와 위스 지갑을 불러오는 중입니다."}
      </div>
    );
  if (!saved)
    return (
      <div className="avatar-studio-status" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => void load()}>
          다시 불러오기
        </button>
      </div>
    );

  return (
    <section
      className="avatar-studio"
      aria-label="아바타 꾸미기"
      aria-busy={Boolean(busy)}
    >
      <div className="avatar-studio-heading">
        <h2>아바타 꾸미기</h2>
        {!allAvailable && (
          <span className="avatar-studio-wallet">
            내 지갑{" "}
            <strong>
              {balance === null ? "확인 필요" : balance.toLocaleString("ko-KR")}
            </strong>
            <WisIcon />
          </span>
        )}
      </div>
      <div className="avatar-studio-layout">
        <div className="avatar-studio-preview">
          <div
            className="avatar-studio-characters"
            role="group"
            aria-label="남녀 아바타 선택"
          >
            {pricedItems
              .filter((item) => item.slot === "character")
              .map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={
                    characterChosen && look.character === item.value
                  }
                  disabled={Boolean(busy)}
                  onClick={() => choose(item)}
                >
                  {allAvailable
                    ? item.value === "boy"
                      ? "남성"
                      : "여성"
                    : item.label}{" "}
                  아바타
                  {!available(item) && (
                    <span className="avatar-studio-character-price">
                      {item.price.toLocaleString()} 위스
                    </span>
                  )}
                </button>
              ))}
          </div>
          <div
            className="avatar-studio-stage"
            aria-label="선택한 아바타 미리보기"
          >
            {characterChosen ? (
              <AvatarStage
                key={stageKey}
                look={look}
                active={active}
                onReady={onReady}
                onError={onStageError}
                onLoadingChange={onLoadingChange}
              />
            ) : (
              <AvatarPlaceholder />
            )}
            {stageError && (
              <div className="avatar-studio-stage-error" role="alert">
                <p>{stageError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setStageError("");
                    setReady(false);
                    setStageKey((key) => key + 1);
                  }}
                >
                  다시 불러오기
                </button>
              </div>
            )}
          </div>
          <div className="avatar-studio-camera" aria-label="아바타 보기 조절">
            <button
              type="button"
              disabled={!ready || Boolean(busy)}
              onClick={() => stage.current?.rotate(-0.4)}
              aria-label="왼쪽으로 돌리기"
            >
              <i className="fas fa-rotate-left" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={!ready || Boolean(busy)}
              onClick={() => stage.current?.resetView()}
            >
              전체 보기
            </button>
            <button
              type="button"
              disabled={!ready || Boolean(busy)}
              onClick={() => stage.current?.focusFace()}
            >
              얼굴 보기
            </button>
            <button
              type="button"
              disabled={!ready || Boolean(busy)}
              onClick={() => stage.current?.rotate(0.4)}
              aria-label="오른쪽으로 돌리기"
            >
              <i className="fas fa-rotate-right" aria-hidden="true" />
            </button>
          </div>
          <div className="avatar-studio-save">
            <button
              type="button"
              disabled={Boolean(busy) || !dirty}
              onClick={() => {
                setLook(saved.look);
                setCharacterChosen(Boolean(saved.thumbnailUrl));
                stage.current = null;
                setReady(false);
                setStageError("");
                setStageKey((key) => key + 1);
              }}
            >
              저장한 모습
            </button>
            <button
              type="button"
              className="avatar-primary"
              disabled={
                !ready ||
                Boolean(busy) ||
                missing.length > 0 ||
                (!dirty && Boolean(saved.thumbnailUrl))
              }
              onClick={() => void save()}
            >
              {busy === "save" ? "저장 중…" : "아바타 저장"}
            </button>
          </div>
          {missing.length > 0 && (
            <p className="avatar-studio-pending" role="status">
              미보유 아이템 {missing.length}개 · 구매 후 저장할 수 있습니다.
            </p>
          )}
          {error && (
            <div className="avatar-studio-error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void load()}
              >
                새로고침
              </button>
            </div>
          )}
        </div>
        <div className="avatar-studio-picker">
          <div className="avatar-studio-categories" aria-label="꾸미기 종류">
            {AVATAR_SLOTS.filter(
              (category) => category.key !== "character",
            ).map((category) => (
              <button
                type="button"
                key={category.key}
                aria-pressed={slot === category.key}
                onClick={() => setSlot(category.key)}
              >
                <i className={`fas ${category.icon}`} aria-hidden="true" />
                <span>{category.label}</span>
              </button>
            ))}
          </div>
          {!allAvailable && (
            <div className="avatar-studio-filter" aria-label="아이템 필터">
              {(
                [
                  ["all", "전체"],
                  ["owned", "보유"],
                  ["premium", "유료"],
                ] as const
              ).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div
            className="avatar-studio-items"
            aria-label={
              AVATAR_SLOTS.find((category) => category.key === slot)?.label
            }
          >
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`avatar-studio-item ${item.price ? "is-premium" : "is-basic"}`}
                aria-pressed={selected?.id === item.id}
                disabled={!characterChosen || Boolean(busy)}
                onClick={() => choose(item)}
              >
                <AvatarItemPreview item={item} character={look.character} />
                <span className="avatar-studio-item-type">
                  {getAvatarItemGroup(item)}
                </span>
                <span className="avatar-studio-item-name">{item.label}</span>
                {!allAvailable && (
                  <span className="avatar-studio-item-price">
                    {item.price === 0 ? (
                      "무료"
                    ) : available(item) ? (
                      "보유"
                    ) : (
                      <>
                        {item.price.toLocaleString()} <WisIcon />
                      </>
                    )}
                  </span>
                )}
                {selected?.id === item.id && (
                  <i
                    className="fas fa-check avatar-studio-item-check"
                    aria-label="선택됨"
                  />
                )}
              </button>
            ))}
          </div>
          {!items.length && (
            <p className="avatar-studio-empty">
              이 조건에 맞는 아이템이 없습니다.
            </p>
          )}
          {selected && (
            <div className="avatar-studio-selected">
              <div>
                <strong>{selected.label}</strong>
                {!allAvailable && (
                  <span>{selected.price ? "유료" : "무료"}</span>
                )}
              </div>
              {!available(selected) ? (
                <button
                  type="button"
                  className="avatar-primary"
                  disabled={Boolean(busy) || balance === null}
                  onClick={() => {
                    setConfirmError("");
                    setPurchase(selected);
                  }}
                >
                  {selected.price.toLocaleString()} 위스로 구매
                </button>
              ) : (
                <span className="avatar-studio-owned">사용 가능</span>
              )}
            </div>
          )}
        </div>
      </div>
      <dialog
        ref={dialog}
        className="avatar-purchase-dialog"
        aria-labelledby="avatar-purchase-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setPurchase(null);
        }}
        onClose={() => {
          if (!busy) setPurchase(null);
        }}
      >
        <h3 id="avatar-purchase-title">아이템 구매</h3>
        {purchase && (
          <>
            <p className="avatar-purchase-name">{purchase.label}</p>
            <dl>
              <div>
                <dt>가격</dt>
                <dd>{purchase.price.toLocaleString()} 위스</dd>
              </div>
              <div>
                <dt>구매 후 잔액</dt>
                <dd>
                  {balance === null
                    ? "확인 필요"
                    : `${Math.max(0, balance - purchase.price).toLocaleString()} 위스`}
                </dd>
              </div>
            </dl>
            <p>구매해도 누적 위스와 등급은 유지됩니다.</p>
            {balance !== null && balance < purchase.price && (
              <p role="alert">위스가 부족합니다.</p>
            )}
          </>
        )}
        {confirmError && (
          <p role="alert" className="avatar-studio-error">
            {confirmError}
          </p>
        )}
        <div className="avatar-purchase-actions">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => setPurchase(null)}
          >
            취소
          </button>
          <button
            type="button"
            className="avatar-primary"
            disabled={
              Boolean(busy) ||
              balance === null ||
              !purchase ||
              balance < purchase.price
            }
            onClick={() => void buy()}
          >
            {busy === "buy" ? "구매 중…" : "구매하기"}
          </button>
        </div>
      </dialog>
    </section>
  );
}

export default function StudentAvatarStudio() {
  const { user, config, authGeneration } = useAuth();
  const adapter = useMemo<AvatarStudioAdapter>(
    () => ({
      load: async () => {
        if (!user || !config?.year || !config.semester)
          throw new Error("로그인과 학기를 확인해 주세요.");
        return getAvatarStudioState(config);
      },
      purchase: (itemId, expectedPrice, expectedPricingRevision) =>
        purchaseAvatarItem(
          config!,
          itemId,
          expectedPrice,
          expectedPricingRevision,
        ),
      save: saveStudentAvatar,
    }),
    [user?.uid, config?.year, config?.semester, authGeneration],
  );
  return (
    <AvatarStudio
      key={`${user?.uid}:${authGeneration}:${config?.year}:${config?.semester}`}
      adapter={adapter}
    />
  );
}
