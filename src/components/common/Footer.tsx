import React, { useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { InlineLoading } from "./LoadingState";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import { normalizeInstagramUrl } from "../../lib/socialLinks";

type PolicyType = "terms" | "privacy";

const POLICY_TITLE: Record<PolicyType, string> = {
  terms: "이용 약관",
  privacy: "개인정보 처리 방침",
};

const FALLBACK_FOOTER_TEXT = "Copyright © Westory. All rights reserved.";
const policyHtmlToText = (value: unknown) => {
  const html = String(value || "");
  if (!html) return "";
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]+>/g, " ");
  const withLineBreaks = html.replace(
    /<\/(p|li|h[1-6]|div|section)>/giu,
    "$&\n",
  );
  const parsed = new DOMParser().parseFromString(withLineBreaks, "text/html");
  return String(parsed.body.textContent || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const Footer: React.FC = () => {
  const { interfaceConfig } = useAuth();
  const [openPolicy, setOpenPolicy] = useState<PolicyType | null>(null);
  const [loading, setLoading] = useState(false);
  const [policyText, setPolicyText] = useState("");
  const policyRequestRef = React.useRef(0);
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const modalTitleId = React.useId();

  const footerText =
    String(interfaceConfig?.footerText || "").trim() || FALLBACK_FOOTER_TEXT;
  const instagramUrl = normalizeInstagramUrl(interfaceConfig?.instagramUrl);

  const openPolicyModal = async (type: PolicyType) => {
    const requestId = ++policyRequestRef.current;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setOpenPolicy(type);
    setLoading(true);
    setPolicyText("");

    try {
      const snap = await getDoc(doc(db, "site_settings", type));
      if (policyRequestRef.current !== requestId) return;
      if (snap.exists() && snap.data().text) {
        setPolicyText(policyHtmlToText(snap.data().text));
      } else {
        setPolicyText("등록된 내용이 없습니다.");
      }
    } catch (error) {
      if (policyRequestRef.current !== requestId) return;
      console.error("Footer policy load error:", error);
      setPolicyText("내용을 불러오지 못했습니다.");
    } finally {
      if (policyRequestRef.current === requestId) setLoading(false);
    }
  };

  const closePolicyModal = () => {
    policyRequestRef.current += 1;
    setOpenPolicy(null);
  };

  React.useEffect(() => {
    if (!openPolicy) return undefined;

    const frame = window.requestAnimationFrame(() =>
      closeButtonRef.current?.focus(),
    );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePolicyModal();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [openPolicy]);

  return (
    <>
      <footer className="bg-white border-t border-stone-200 py-4 mt-auto">
        <div className="container mx-auto text-center">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => void openPolicyModal("terms")}
              className="text-stone-400 hover:text-stone-600 text-xs font-medium transition"
            >
              이용 약관
            </button>
            <span className="text-stone-300 text-xs">|</span>
            <button
              type="button"
              onClick={() => void openPolicyModal("privacy")}
              className="text-stone-400 hover:text-stone-600 text-xs font-medium transition"
            >
              개인정보 처리 방침
            </button>
            <span className="text-stone-300 text-xs">|</span>
            <Link
              to="/developer-log"
              className="text-stone-400 hover:text-stone-600 text-xs font-medium transition"
            >
              개발자 일지
            </Link>
            {instagramUrl && (
              <>
                <span className="text-stone-300 text-xs">|</span>
                <a
                  href={instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="위스토리 공식 인스타그램"
                  title="위스토리 공식 인스타그램"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition hover:bg-pink-50 hover:text-pink-600"
                >
                  <i
                    className="fa-brands fa-instagram text-base"
                    aria-hidden="true"
                  ></i>
                </a>
              </>
            )}
          </div>
          <p className="text-stone-400 text-xs font-bold">{footerText}</p>
        </div>
      </footer>

      {openPolicy && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm"
          onClick={closePolicyModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 id={modalTitleId} className="text-lg font-bold text-gray-900">
                {POLICY_TITLE[openPolicy]}
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closePolicyModal}
                className="text-gray-400 hover:text-gray-700 text-xl transition"
                aria-label={`${POLICY_TITLE[openPolicy]} 닫기`}
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 text-sm text-gray-700 leading-relaxed">
              {loading ? (
                <InlineLoading
                  message="약관을 불러오는 중입니다."
                  showWarning
                />
              ) : (
                <div className="policy-rich-text">{policyText}</div>
              )}
            </div>
          </div>
        </div>
      )}
      <style>{`
                .policy-rich-text {
                    color: #374151;
                    line-height: 1.8;
                    white-space: pre-wrap;
                }
                .policy-rich-text p {
                    margin: 0.35rem 0;
                    white-space: pre-wrap;
                }
                .policy-rich-text ul {
                    list-style: disc;
                    padding-left: 1.4rem;
                    margin: 0.45rem 0;
                }
                .policy-rich-text ol {
                    list-style: decimal;
                    padding-left: 1.4rem;
                    margin: 0.45rem 0;
                }
                .policy-rich-text li {
                    margin: 0.25rem 0;
                    white-space: pre-wrap;
                }
                .policy-rich-text li[data-list='bullet'] {
                    list-style-type: disc;
                }
                .policy-rich-text li[data-list='ordered'] {
                    list-style-type: decimal;
                }
                .policy-rich-text .ql-indent-1 { padding-left: 2em; }
                .policy-rich-text .ql-indent-2 { padding-left: 4em; }
                .policy-rich-text .ql-indent-3 { padding-left: 6em; }
            `}</style>
    </>
  );
};

export default Footer;
