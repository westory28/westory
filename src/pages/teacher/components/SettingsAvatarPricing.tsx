import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import InfoHelp from "../../../components/common/InfoHelp";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { InlineLoading } from "../../../components/common/LoadingState";
import WisIcon from "../../../components/common/WisIcon";
import { useAuth } from "../../../contexts/AuthContext";
import {
  AVATAR_ITEMS,
  AVATAR_SLOTS,
  AVATAR_CATALOG_VERSION,
  defaultAvatarLook,
  applyAvatarCatalogSettings,
  avatarItemMetadata,
  avatarItemPricePolicy,
  effectiveAvatarItemPrice,
  type AvatarItem,
  type AvatarItemMetadata,
} from "../../../features/avatar/catalog";
import AvatarItemPreview from "../../../features/avatar/AvatarItemPreview";
import {
  AvatarStudio,
  type AvatarStudioAdapter,
} from "../../../features/avatar/AvatarStudio";
import {
  avatarItemTypeLabel,
  getAvatarItemGroup,
} from "../../../features/avatar/itemPresentation";
import {
  avatarErrorMessage,
  avatarPricingFromError,
  getAvatarCatalogPricing,
  updateAvatarCatalogPricing,
  type AvatarCatalogPricingState,
} from "../../../features/avatar/service";
import { acquirePageScrollLock } from "../../../lib/pageScrollLock";
import { isAdminUser } from "../../../lib/permissions";
import "../../../components/common/portalPage.css";
import "./settingsAvatarPricing.css";

const MAX_PRICE = 1_000_000;
const genderLabels = { boy: "남자", girl: "여자", unisex: "공용" };
type ItemDraft = AvatarItemMetadata & { paid: boolean; price: string };
type Drafts = Record<string, ItemDraft>;
export interface AvatarPricingAdapter {
  load: () => Promise<AvatarCatalogPricingState>;
  save: (input: {
    expectedRevision: number;
    prices: Record<string, number>;
    metadata: Record<string, AvatarItemMetadata>;
  }) => Promise<AvatarCatalogPricingState>;
}
const adapter: AvatarPricingAdapter = {
  load: getAvatarCatalogPricing,
  save: updateAvatarCatalogPricing,
};
const normalizePricing = (
  state: AvatarCatalogPricingState,
): AvatarCatalogPricingState => ({
  ...state,
  prices: Object.fromEntries(
    AVATAR_ITEMS.map((item) => {
      const price = state.prices[item.id];
      if (!Number.isSafeInteger(price) || price < 0 || price > MAX_PRICE)
        throw new Error(
          "아이템 정보를 확인하지 못했습니다. 다시 불러와 주세요.",
        );
      return [item.id, effectiveAvatarItemPrice(item, price)];
    }),
  ),
});
const draftFor = (
  item: AvatarItem,
  state: AvatarCatalogPricingState,
): ItemDraft => {
  const effective = applyAvatarCatalogSettings(item, state);
  return {
    ...avatarItemMetadata(effective),
    paid: effective.price > 0,
    price: effective.price ? String(effective.price) : "",
  };
};
const priceOf = (draft: ItemDraft | undefined): number | null => {
  if (!draft) return null;
  if (!draft.paid) return 0;
  if (!/^\d+$/.test(draft.price)) return null;
  const value = Number(draft.price);
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_PRICE
    ? value
    : null;
};
const metadataOf = (draft: ItemDraft): AvatarItemMetadata => ({
  label: draft.label.trim(),
  gender: draft.gender,
  description: draft.description.trim(),
});
const changedFrom = (
  draft: ItemDraft | undefined,
  item: AvatarItem,
  state: AvatarCatalogPricingState,
): boolean => {
  if (!draft) return false;
  const current = draftFor(item, state);
  return (
    priceOf(draft) !== priceOf(current) ||
    draft.label.trim() !== current.label ||
    draft.gender !== current.gender ||
    draft.description.trim() !== current.description
  );
};
const validationFor = (draft: ItemDraft): string => {
  if (!draft.label.trim() || draft.label.trim().length > 60)
    return "이름은 1~60자로 입력해 주세요.";
  if (draft.description.trim().length > 400)
    return "설명은 400자 이내로 입력해 주세요.";
  if (priceOf(draft) === null)
    return "가격은 1~1,000,000 위스의 정수로 입력해 주세요.";
  return "";
};

function CatalogDialog({
  title,
  className,
  children,
  onClose,
}: {
  title: string;
  className: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const release = acquirePageScrollLock();
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      release();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className={`avatar-pricing-dialog ${className}`}
      aria-labelledby="avatar-catalog-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== dialog.current) return;
        const bounds = dialog.current.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <div className="avatar-pricing-dialog-heading">
        <h3 id="avatar-catalog-dialog-title">{title}</h3>
        <button type="button" onClick={onClose} aria-label={`${title} 닫기`}>
          닫기
        </button>
      </div>
      <div className="avatar-pricing-dialog-body">{children}</div>
    </dialog>,
    document.body,
  );
}

function ItemEditor({
  item,
  draft,
  changed,
  onChange,
  onClose,
}: {
  item: AvatarItem;
  draft: ItemDraft;
  changed: boolean;
  onChange: (patch: Partial<ItemDraft>) => void;
  onClose: () => void;
}) {
  const policy = avatarItemPricePolicy(item);
  const invalid = validationFor(draft);
  return (
    <CatalogDialog
      title="아이템 수정"
      className="avatar-pricing-editor-dialog"
      onClose={onClose}
    >
      <div className="avatar-pricing-editor-layout">
        <AvatarItemPreview
          item={item}
          character={draft.gender === "boy" ? "boy" : "girl"}
          className="avatar-pricing-editor-image"
        />
        <div className="avatar-pricing-editor-fields">
          <label>
            <span>이름</span>
            <input
              aria-label={`${item.label} 이름`}
              value={draft.label}
              maxLength={60}
              onChange={(event) => onChange({ label: event.target.value })}
              aria-invalid={!draft.label.trim()}
            />
          </label>
          <div className="avatar-pricing-editor-options">
            <label>
              <span>성별</span>
              <select
                aria-label={`${item.label} 성별`}
                value={draft.gender}
                onChange={(event) =>
                  onChange({
                    gender: event.target.value as ItemDraft["gender"],
                  })
                }
              >
                <option value="unisex">공용</option>
                <option value="boy">남자</option>
                <option value="girl">여자</option>
              </select>
            </label>
            <label>
              <span>판매 방식</span>
              <select
                aria-label={`${item.label} 무료·유료`}
                value={draft.paid ? "paid" : "free"}
                onChange={(event) =>
                  onChange({ paid: event.target.value === "paid" })
                }
                disabled={policy !== null}
              >
                <option value="free">무료</option>
                <option value="paid">유료</option>
              </select>
            </label>
            <label className="avatar-pricing-editor-price">
              <span>가격</span>
              <span className="avatar-pricing-value">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_PRICE}
                  step={1}
                  aria-label={`${item.label} 위스 가격`}
                  aria-invalid={priceOf(draft) === null}
                  value={draft.paid ? draft.price : ""}
                  placeholder={draft.paid ? "가격" : "0"}
                  onChange={(event) => onChange({ price: event.target.value })}
                  disabled={!draft.paid}
                />
                <WisIcon />
              </span>
            </label>
          </div>
          <label>
            <span>설명</span>
            <textarea
              aria-label={`${item.label} 설명`}
              rows={4}
              maxLength={400}
              value={draft.description}
              onChange={(event) =>
                onChange({ description: event.target.value })
              }
            />
          </label>
          {policy && (
            <p className="avatar-pricing-policy">
              {policy === "free" ? "학교 체육복 · 무료" : "1~1,000,000 위스"}
            </p>
          )}
          {invalid && (
            <p className="avatar-pricing-item-error" role="alert">
              {invalid}
            </p>
          )}
          {changed && (
            <p className="avatar-pricing-draft-status" role="status">
              저장 전 변경 사항
            </p>
          )}
        </div>
      </div>
    </CatalogDialog>
  );
}

function StudentShopPreview({
  pricing,
  unsaved,
  onClose,
}: {
  pricing: AvatarCatalogPricingState;
  unsaved: boolean;
  onClose: () => void;
}) {
  const previewAdapter = useMemo<AvatarStudioAdapter>(
    () => ({
      load: async () => ({
        avatar: {
          schemaVersion: 1,
          catalogVersion: AVATAR_CATALOG_VERSION,
          look: defaultAvatarLook(),
          revision: 0,
          lookHash: "catalog-preview",
          ownedItemIds: [],
          requiresThumbnailRefresh: true,
        },
        balance: 0,
        pricing,
      }),
      purchase: async () => {
        throw new Error("미리보기에서는 구매할 수 없습니다.");
      },
      save: async () => {
        throw new Error("미리보기에서는 저장할 수 없습니다.");
      },
    }),
    [pricing],
  );
  return (
    <CatalogDialog
      title="학생 미리보기"
      className="avatar-pricing-student-dialog"
      onClose={onClose}
    >
      {unsaved && (
        <p className="avatar-pricing-draft-status">저장 전 변경 사항 포함</p>
      )}
      <AvatarStudio adapter={previewAdapter} mode="shop" preview />
    </CatalogDialog>
  );
}

export function AvatarPricingManager({
  pricingAdapter = adapter,
}: {
  pricingAdapter?: AvatarPricingAdapter;
}) {
  const { showToast } = useAppToast();
  const [state, setState] = useState<AvatarCatalogPricingState | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [slot, setSlot] = useState("top");
  const [group, setGroup] = useState("all");
  const [gender, setGender] = useState("all");
  const [sale, setSale] = useState("all");
  const [changedOnly, setChangedOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const sequence = useRef(0);
  const busy = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Refresh clean cards while preserving unrelated edits and conflict drafts.
  const acceptState = useCallback(
    (next: AvatarCatalogPricingState, savedId?: string) => {
      const previous = stateRef.current;
      setDrafts((current) =>
        Object.fromEntries(
          AVATAR_ITEMS.map((item) => [
            item.id,
            item.id !== savedId &&
            previous &&
            changedFrom(current[item.id], item, previous)
              ? current[item.id]
              : draftFor(item, next),
          ]),
        ),
      );
      stateRef.current = next;
      setState(next);
    },
    [],
  );
  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const request = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const next = normalizePricing(await pricingAdapter.load());
      if (request === sequence.current) {
        acceptState(next);
        setItemErrors({});
      }
    } catch (cause) {
      if (request === sequence.current) setError(avatarErrorMessage(cause));
    } finally {
      if (request === sequence.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [pricingAdapter, acceptState]);
  useEffect(() => {
    void load();
    return () => {
      sequence.current += 1;
      busy.current = false;
    };
  }, [load]);

  const items = useMemo(
    () =>
      state
        ? AVATAR_ITEMS.map((item) => applyAvatarCatalogSettings(item, state))
        : [],
    [state],
  );
  const changed = useMemo(
    () =>
      new Set(
        state
          ? AVATAR_ITEMS.filter((item) =>
              changedFrom(drafts[item.id], item, state),
            ).map((item) => item.id)
          : [],
      ),
    [drafts, state],
  );
  const groups = useMemo(
    () => [
      ...new Set(
        items
          .filter((item) => slot === "all" || item.slot === slot)
          .map(getAvatarItemGroup),
      ),
    ],
    [slot, items],
  );
  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return items.filter(
      (item) =>
        (slot === "all" || item.slot === slot) &&
        (group === "all" || getAvatarItemGroup(item) === group) &&
        (gender === "all" || avatarItemMetadata(item).gender === gender) &&
        (sale === "all" ||
          (sale === "paid" ? item.price > 0 : item.price === 0)) &&
        (!changedOnly || changed.has(item.id)) &&
        (!query ||
          `${item.label} ${item.description || ""} ${avatarItemTypeLabel(item)} ${getAvatarItemGroup(item)}`
            .toLocaleLowerCase()
            .includes(query)),
    );
  }, [search, slot, group, gender, sale, changedOnly, changed, items]);
  const updateDraft = (id: string, patch: Partial<ItemDraft>) => {
    setItemErrors((current) => ({ ...current, [id]: "" }));
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  };
  const save = async (id: string) => {
    const draft = drafts[id];
    if (
      !state ||
      loading ||
      busy.current ||
      !draft ||
      validationFor(draft) ||
      !changed.has(id)
    )
      return;
    busy.current = true;
    const request = ++sequence.current;
    setSavingId(id);
    setItemErrors((current) => ({ ...current, [id]: "" }));
    try {
      const next = normalizePricing(
        await pricingAdapter.save({
          expectedRevision: state.revision,
          prices: { [id]: priceOf(draft)! },
          metadata: { [id]: metadataOf(draft) },
        }),
      );
      if (request !== sequence.current) return;
      acceptState(next, id);
      showToast({
        tone: "success",
        title: "저장했습니다.",
        message: draft.label.trim(),
      });
    } catch (cause) {
      if (request !== sequence.current) return;
      const latest = avatarPricingFromError(cause);
      if (latest) acceptState(normalizePricing(latest));
      setItemErrors((current) => ({
        ...current,
        [id]: avatarErrorMessage(cause),
      }));
    } finally {
      if (request === sequence.current) {
        busy.current = false;
        setSavingId(null);
      }
    }
  };
  const editingItem = items.find((item) => item.id === editingId);
  const invalidDraft = Object.values(drafts).some((draft) =>
    Boolean(validationFor(draft)),
  );
  const previewPricing = useMemo<AvatarCatalogPricingState | null>(
    () =>
      state
        ? {
            ...state,
            prices: Object.fromEntries(
              AVATAR_ITEMS.map((item) => [
                item.id,
                priceOf(drafts[item.id]) ?? state.prices[item.id],
              ]),
            ),
            metadata: Object.fromEntries(
              AVATAR_ITEMS.map((item) => [
                item.id,
                drafts[item.id]
                  ? metadataOf(drafts[item.id])
                  : avatarItemMetadata(item),
              ]),
            ),
          }
        : null,
    [state, drafts],
  );

  return (
    <section className="ws-page avatar-pricing" aria-label="아바타 아이템 관리">
      <div className="ws-page-header">
        <div className="avatar-pricing-title">
          <h2>아바타 아이템 관리</h2>
          <InfoHelp label="아바타 아이템 설정 안내">
            성별은 상점 분류이며 착용 가능한 체형을 제한하지 않습니다. 이미
            보유한 아이템은 다시 구매하지 않습니다.
          </InfoHelp>
        </div>
        <div className="avatar-pricing-page-actions">
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            disabled={loading || Boolean(savingId) || !state || invalidDraft}
          >
            학생 미리보기
          </button>
          <button
            type="button"
            className="avatar-pricing-reload"
            onClick={() => void load()}
            disabled={loading || Boolean(savingId)}
            title="저장된 아이템 다시 불러오기"
            aria-label="저장된 아이템 다시 불러오기"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 7v5h-5M20 12a8 8 0 1 0-2.35 5.65M20 7l-2.35-2.65" />
            </svg>
          </button>
        </div>
      </div>
      {error && (
        <p className="avatar-pricing-error" role="alert">
          {error}
        </p>
      )}
      {loading && <InlineLoading />}
      {state && (
        <>
          <div className="ws-filter-bar avatar-pricing-filters">
            <label className="avatar-pricing-search">
              <span>아이템 검색</span>
              <input
                type="search"
                placeholder="이름·설명 검색"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              <span>꾸미기 종류</span>
              <select
                aria-label="꾸미기 종류"
                value={slot}
                onChange={(event) => {
                  setSlot(event.target.value);
                  setGroup("all");
                }}
              >
                <option value="all">전체 종류</option>
                {AVATAR_SLOTS.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label} (
                    {
                      AVATAR_ITEMS.filter((item) => item.slot === entry.key)
                        .length
                    }
                    )
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>유형</span>
              <select
                aria-label="유형"
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              >
                <option value="all">전체 유형</option>
                {groups.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="avatar-pricing-browse">
            <div
              className="avatar-pricing-filter"
              role="group"
              aria-label="판매 방식"
            >
              {(
                [
                  ["all", "전체"],
                  ["paid", "유료"],
                  ["free", "무료"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={sale === value}
                  onClick={() => setSale(value)}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div
              className="avatar-pricing-filter"
              role="group"
              aria-label="성별"
            >
              {(
                [
                  ["all", "성별 전체"],
                  ["boy", "남자"],
                  ["girl", "여자"],
                  ["unisex", "공용"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={gender === value}
                  onClick={() => setGender(value)}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="avatar-pricing-summary">
            <span role="status">
              {visibleItems.length}개
              {changed.size ? ` · 변경 ${changed.size}개` : ""}
            </span>
            <label>
              <input
                type="checkbox"
                checked={changedOnly}
                onChange={(event) => setChangedOnly(event.target.checked)}
              />
              변경한 항목만
            </label>
          </div>
          <ul className="avatar-pricing-items" aria-label="아바타 아이템 목록">
            {visibleItems.map((item) => {
              const draft = drafts[item.id];
              const invalid = validationFor(draft);
              const isChanged = changed.has(item.id);
              const saving = savingId === item.id;
              return (
                <li
                  key={item.id}
                  className={`avatar-pricing-item${isChanged ? " is-changed" : ""}`}
                  data-item-id={item.id}
                >
                  <AvatarItemPreview
                    item={item}
                    character={draft.gender === "boy" ? "boy" : "girl"}
                    className="avatar-pricing-preview"
                  />
                  <div className="avatar-pricing-item-identity">
                    <h4 title={draft.label.trim() || item.label}>
                      {draft.label.trim() || item.label}
                    </h4>
                    <div className="avatar-pricing-labels">
                      <span>{avatarItemTypeLabel(item)}</span>
                      <span>{genderLabels[draft.gender]}</span>
                    </div>
                    <p className="avatar-pricing-current">
                      {priceOf(draft) === null ? (
                        "가격 확인 필요"
                      ) : priceOf(draft) === 0 ? (
                        "무료"
                      ) : (
                        <>
                          <WisIcon />
                          {priceOf(draft)!.toLocaleString()}
                        </>
                      )}
                    </p>
                    {isChanged && (
                      <span className="avatar-pricing-changed">변경됨</span>
                    )}
                  </div>
                  {(invalid || itemErrors[item.id]) && (
                    <p className="avatar-pricing-item-error" role="alert">
                      {invalid || itemErrors[item.id]}
                    </p>
                  )}
                  <div className="avatar-pricing-item-actions">
                    <button
                      type="button"
                      className="avatar-pricing-edit"
                      aria-label={`${item.label} 수정`}
                      onClick={() => setEditingId(item.id)}
                      disabled={loading || Boolean(savingId)}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      className="avatar-pricing-save"
                      onClick={() => void save(item.id)}
                      disabled={
                        loading ||
                        Boolean(savingId) ||
                        !isChanged ||
                        Boolean(invalid)
                      }
                    >
                      {saving ? "저장 중" : "저장"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {!visibleItems.length && (
            <p className="avatar-pricing-empty">해당하는 아이템이 없습니다.</p>
          )}
        </>
      )}
      {editingItem && (
        <ItemEditor
          item={editingItem}
          draft={drafts[editingItem.id]}
          changed={changed.has(editingItem.id)}
          onChange={(patch) => updateDraft(editingItem.id, patch)}
          onClose={() => setEditingId(null)}
        />
      )}
      {showPreview && previewPricing && (
        <StudentShopPreview
          pricing={previewPricing}
          unsaved={changed.size > 0}
          onClose={() => setShowPreview(false)}
        />
      )}
    </section>
  );
}

export default function SettingsAvatarPricing() {
  const { currentUser, userData, authGeneration } = useAuth();
  if (!currentUser) return <InlineLoading />;
  if (!isAdminUser(userData, currentUser.email))
    return <p role="alert">관리자 계정에서 사용할 수 있습니다.</p>;
  return <AvatarPricingManager key={`${currentUser.uid}:${authGeneration}`} />;
}
