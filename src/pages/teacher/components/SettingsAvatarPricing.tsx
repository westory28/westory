import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import { InlineLoading } from "../../../components/common/LoadingState";
import WisIcon from "../../../components/common/WisIcon";
import { useAuth } from "../../../contexts/AuthContext";
import { AVATAR_ITEMS, AVATAR_SLOTS } from "../../../features/avatar/catalog";
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
  const [slot, setSlot] = useState("all");
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
  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return AVATAR_ITEMS.filter(
      (item) =>
        (slot === "all" || item.slot === slot) &&
        (!query || item.label.toLocaleLowerCase().includes(query)),
    );
  }, [search, slot]);

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
            onClick={() => void load()}
            disabled={loading || saving}
            title="저장된 가격 다시 불러오기"
            aria-label="저장된 가격 다시 불러오기"
          >
            <i className="fas fa-rotate-right" aria-hidden="true" />
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
            <input
              type="search"
              aria-label="아바타 아이템 검색"
              placeholder="아이템 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              aria-label="꾸미기 종류"
              value={slot}
              onChange={(event) => setSlot(event.target.value)}
            >
              <option value="all">전체 종류</option>
              {AVATAR_SLOTS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
            <span>
              {visibleItems.length}개
              {changed.length ? ` · 변경 ${changed.length}개` : ""}
            </span>
          </div>
          <div
            className="ws-surface avatar-pricing-table-scroll"
            tabIndex={0}
            aria-label="아바타 가격 목록"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">아이템</th>
                  <th scope="col">종류</th>
                  <th scope="col">아바타</th>
                  <th scope="col">무료·유료</th>
                  <th scope="col">위스 가격</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => {
                  const draft = drafts[item.id];
                  return (
                    <tr key={item.id}>
                      <th scope="row">{item.label}</th>
                      <td>
                        {
                          AVATAR_SLOTS.find((entry) => entry.key === item.slot)
                            ?.label
                        }
                      </td>
                      <td>
                        {item.characters.length === 2
                          ? "공통"
                          : item.characters[0] === "girl"
                            ? "여성형"
                            : "남성형"}
                      </td>
                      <td>
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
                      </td>
                      <td>
                        <label className="avatar-pricing-value">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={MAX_PRICE}
                            step={1}
                            aria-label={`${item.label} 위스 가격`}
                            aria-invalid={draft.paid && priceOf(draft) === null}
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
                        </label>
                      </td>
                    </tr>
                  );
                })}
                {!visibleItems.length && (
                  <tr>
                    <td colSpan={5}>검색 결과가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
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
