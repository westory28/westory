import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import { InlineLoading } from "../../../components/common/LoadingState";
import WisIcon from "../../../components/common/WisIcon";
import { useAuth } from "../../../contexts/AuthContext";
import { AVATAR_ITEMS, AVATAR_SLOTS } from "../../../features/avatar/catalog";
import AvatarItemPreview from "../../../features/avatar/AvatarItemPreview";
import {
  avatarItemTypeLabel,
  getAvatarItemGroup,
} from "../../../features/avatar/itemPresentation";
import {
  avatarErrorMessage,
  getAvatarCatalogPricing,
  updateAvatarCatalogPricing,
  type AvatarCatalogPricingState,
} from "../../../features/avatar/service";
import { isAdminUser } from "../../../lib/permissions";
import "../../../components/common/portalPage.css";
import "./settingsAvatarPricing.css";

const MAX_PRICE = 1_000_000;
type PriceDraft = { paid: boolean; price: string };
type Drafts = Record<string, PriceDraft>;
export interface AvatarPricingAdapter {
  load: () => Promise<AvatarCatalogPricingState>;
  save: (input: {
    expectedRevision: number;
    prices: Record<string, number>;
  }) => Promise<AvatarCatalogPricingState>;
}
const adapter: AvatarPricingAdapter = {
  load: getAvatarCatalogPricing,
  save: updateAvatarCatalogPricing,
};
const draftsFrom = (state: AvatarCatalogPricingState): Drafts =>
  Object.fromEntries(
    AVATAR_ITEMS.map((item) => {
      const price = state.prices[item.id];
      if (!Number.isSafeInteger(price) || price < 0 || price > MAX_PRICE)
        throw new Error("가격표 형식을 확인하지 못했습니다.");
      return [
        item.id,
        { paid: price > 0, price: price > 0 ? String(price) : "" },
      ];
    }),
  );
const priceOf = (draft: PriceDraft | undefined): number | null => {
  if (!draft) return null;
  if (!draft.paid) return 0;
  if (!/^\d+$/.test(draft.price)) return null;
  const value = Number(draft.price);
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_PRICE
    ? value
    : null;
};

export function AvatarPricingManager({
  pricingAdapter = adapter,
}: {
  pricingAdapter?: AvatarPricingAdapter;
}) {
  const [state, setState] = useState<AvatarCatalogPricingState | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState("");
  const [slot, setSlot] = useState("top");
  const [group, setGroup] = useState("all");
  const [character, setCharacter] = useState("all");
  const [changedOnly, setChangedOnly] = useState(false);
  const sequence = useRef(0);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    const request = ++sequence.current;
    setLoading(true);
    setError("");
    setSaved(false);
    try {
      const next = await pricingAdapter.load();
      const nextDrafts = draftsFrom(next);
      if (request !== sequence.current) return;
      setState(next);
      setDrafts(nextDrafts);
    } catch (cause) {
      if (request === sequence.current) setError(avatarErrorMessage(cause));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [pricingAdapter]);
  useEffect(() => {
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [load]);

  const changed = useMemo(
    () =>
      state
        ? AVATAR_ITEMS.filter(
            (item) => priceOf(drafts[item.id]) !== state.prices[item.id],
          )
        : [],
    [drafts, state],
  );
  const invalid = useMemo(
    () =>
      state && AVATAR_ITEMS.some((item) => priceOf(drafts[item.id]) === null),
    [drafts, state],
  );
  const groups = useMemo(
    () => [
      ...new Set(
        AVATAR_ITEMS.filter((item) => slot === "all" || item.slot === slot).map(
          getAvatarItemGroup,
        ),
      ),
    ],
    [slot],
  );
  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return AVATAR_ITEMS.filter(
      (item) =>
        (slot === "all" || item.slot === slot) &&
        (group === "all" || getAvatarItemGroup(item) === group) &&
        (character === "all" ||
          (item.slot === "character"
            ? item.value === character
            : item.characters.includes(character as "girl" | "boy"))) &&
        (!changedOnly || changed.some((entry) => entry.id === item.id)) &&
        (!query ||
          `${item.label} ${avatarItemTypeLabel(item)} ${getAvatarItemGroup(item)}`
            .toLocaleLowerCase()
            .includes(query)),
    );
  }, [search, slot, group, character, changedOnly, changed]);
  const visibleGroups = useMemo(
    () =>
      Array.from(new Set(visibleItems.map(getAvatarItemGroup)), (label) => ({
        label,
        items: visibleItems.filter(
          (item) => getAvatarItemGroup(item) === label,
        ),
      })),
    [visibleItems],
  );

  const updateDraft = (id: string, patch: Partial<PriceDraft>) => {
    setSaved(false);
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  };
  const save = async () => {
    if (!state || loading || busy.current || invalid || !changed.length) return;
    busy.current = true;
    const request = ++sequence.current;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const next = await pricingAdapter.save({
        expectedRevision: state.revision,
        prices: Object.fromEntries(
          AVATAR_ITEMS.map((item) => [item.id, priceOf(drafts[item.id])!]),
        ),
      });
      const nextDrafts = draftsFrom(next);
      if (request !== sequence.current) return;
      setState(next);
      setDrafts(nextDrafts);
      setSaved(true);
    } catch (cause) {
      if (request === sequence.current) setError(avatarErrorMessage(cause));
    } finally {
      busy.current = false;
      if (request === sequence.current) setSaving(false);
    }
  };

  return (
    <section className="ws-page avatar-pricing" aria-label="아바타 가격 관리">
      <div className="ws-page-header">
        <div className="avatar-pricing-title">
          <h2>아바타 가격 관리</h2>
          <InfoHelp label="아바타 가격 적용 안내">
            학생에게 적용할 무료·유료와 위스 가격을 설정합니다. 이미 보유한
            아이템은 다시 구매하지 않으며, 교사는 가격과 관계없이 모든 항목을
            사용할 수 있습니다. 변경 사항은 저장할 때 함께 반영됩니다.
          </InfoHelp>
        </div>
        <div className="avatar-pricing-actions">
          <button
            type="button"
            className="avatar-pricing-reload"
            onClick={() => void load()}
            disabled={loading || saving}
            title="저장된 가격 다시 불러오기"
            aria-label="저장된 가격 다시 불러오기"
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
          <button
            type="button"
            className="avatar-pricing-save"
            onClick={() => void save()}
            disabled={loading || saving || !changed.length || Boolean(invalid)}
          >
            {saving ? "저장 중" : "가격 저장"}
          </button>
        </div>
      </div>
      {error && (
        <p className="avatar-pricing-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="avatar-pricing-status" role="status">
          저장했습니다.
        </p>
      )}
      {invalid && (
        <p className="avatar-pricing-error" role="alert">
          유료 항목의 가격을 1~1,000,000 위스의 정수로 입력해 주세요.
        </p>
      )}
      {loading ? (
        <InlineLoading />
      ) : state ? (
        <>
          <div className="ws-filter-bar avatar-pricing-filters">
            <label className="avatar-pricing-search">
              <span>아이템 검색</span>
              <input
                type="search"
                aria-label="아이템 검색"
                placeholder="이름·유형 검색"
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
            <label>
              <span>아바타</span>
              <select
                aria-label="아바타"
                value={character}
                onChange={(event) => setCharacter(event.target.value)}
              >
                <option value="all">전체</option>
                <option value="girl">여성형</option>
                <option value="boy">남성형</option>
              </select>
            </label>
          </div>
          <div className="avatar-pricing-summary">
            <span role="status">
              {visibleItems.length}개
              {changed.length ? ` · 변경 ${changed.length}개` : ""}
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
          <div className="avatar-pricing-catalog" aria-label="아바타 가격 목록">
            {visibleGroups.map(({ label, items }) => (
              <section
                key={label}
                className="avatar-pricing-group"
                aria-label={label}
              >
                <h3>
                  {label}
                  <span>{items.length}개</span>
                </h3>
                <ul className="avatar-pricing-items">
                  {items.map((item) => {
                    const draft = drafts[item.id];
                    const isInvalid = draft.paid && priceOf(draft) === null;
                    const isChanged = priceOf(draft) !== state.prices[item.id];
                    const currentPrice = state.prices[item.id];
                    return (
                      <li
                        key={item.id}
                        className={`avatar-pricing-item${isChanged ? " is-changed" : ""}`}
                      >
                        <div className="avatar-pricing-item-heading">
                          <AvatarItemPreview
                            item={item}
                            character={
                              character === "boy"
                                ? "boy"
                                : character === "girl"
                                  ? "girl"
                                  : undefined
                            }
                            className="avatar-pricing-preview"
                          />
                          <div className="avatar-pricing-item-identity">
                            <h4>{item.label}</h4>
                            <div className="avatar-pricing-labels">
                              <span>{avatarItemTypeLabel(item)}</span>
                              {getAvatarItemGroup(item) !==
                                avatarItemTypeLabel(item) && (
                                <span>{getAvatarItemGroup(item)}</span>
                              )}
                              <span>
                                {item.slot === "character"
                                  ? item.value === "girl"
                                    ? "여성형"
                                    : "남성형"
                                  : item.characters.length === 2
                                    ? "공용"
                                    : item.characters[0] === "girl"
                                      ? "여성형"
                                      : "남성형"}
                              </span>
                            </div>
                            <p className="avatar-pricing-current">
                              현재{" "}
                              {currentPrice === 0
                                ? "무료"
                                : `${currentPrice.toLocaleString()} 위스`}
                            </p>
                            {isChanged && (
                              <span className="avatar-pricing-changed">
                                변경됨
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="avatar-pricing-item-controls">
                          <label>
                            <span>판매 방식</span>
                            <select
                              aria-label={`${item.label} 무료·유료`}
                              value={draft.paid ? "paid" : "free"}
                              onChange={(event) =>
                                updateDraft(item.id, {
                                  paid: event.target.value === "paid",
                                })
                              }
                              disabled={saving}
                            >
                              <option value="free">무료</option>
                              <option value="paid">유료</option>
                            </select>
                          </label>
                          <label>
                            <span>가격</span>
                            <span className="avatar-pricing-value">
                              <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={MAX_PRICE}
                                step={1}
                                aria-label={`${item.label} 위스 가격`}
                                aria-invalid={isInvalid}
                                aria-describedby={
                                  isInvalid
                                    ? `avatar-price-error-${item.id}`
                                    : undefined
                                }
                                value={draft.paid ? draft.price : ""}
                                placeholder={draft.paid ? "가격" : "0"}
                                onChange={(event) =>
                                  updateDraft(item.id, {
                                    price: event.target.value,
                                  })
                                }
                                disabled={saving || !draft.paid}
                              />
                              <WisIcon />
                            </span>
                          </label>
                        </div>
                        {isInvalid && (
                          <p
                            className="avatar-pricing-item-error"
                            id={`avatar-price-error-${item.id}`}
                          >
                            1~1,000,000 위스를 입력해 주세요.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {!visibleItems.length && (
              <p className="avatar-pricing-empty">
                해당하는 아이템이 없습니다.
              </p>
            )}
          </div>
        </>
      ) : null}
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
