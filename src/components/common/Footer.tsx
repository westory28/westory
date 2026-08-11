import React, { useEffect, useRef, useState } from "react";
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
const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const policyRequestRef = useRef(0);

  const footerText =
    String(interfaceConfig?.footerText || "").trim() || FALLBACK_FOOTER_TEXT;
  const instagramUrl = normalizeInstagramUrl(interfaceConfig?.instagramUrl);

  const openPolicyModal = async (type: PolicyType) => {
    const requestId = ++policyRequestRef.current;
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

  useEffect(() => {
    if (!openPolicy) return undefined;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePolicyModal();
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      previousFocusRef.current?.focus();
    };
  }, [openPolicy]);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [],
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <footer className="bg-white border-t border-stone-200 py-4 mt-auto">
        <div className="container mx-auto text-center">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => openPolicyModal("terms")}
              className="inline-flex min-h-11 items-center px-2 text-stone-400 hover:text-stone-600 text-xs font-medium transition"
            >
              이용 약관
            </button>
            <span className="text-stone-300 text-xs">|</span>
            <button
              type="button"
              onClick={() => openPolicyModal("privacy")}
              className="inline-flex min-h-11 items-center px-2 text-stone-400 hover:text-stone-600 text-xs font-medium transition"
            >
              개인정보 처리 방침
            </button>
            <span className="text-stone-300 text-xs">|</span>
            <Link
              to="/developer-log"
              className="inline-flex min-h-11 items-center px-2 text-stone-400 hover:text-stone-600 text-xs font-medium transition"
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
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-stone-400 transition hover:bg-pink-50 hover:text-pink-600"
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
            ref={dialogRef}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleDialogKeyDown}
            role="dialog"
            aria-modal="true"
            aria-labelledby="westory-policy-title"
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2
                id="westory-policy-title"
                className="text-lg font-bold text-gray-900"
              >
                {POLICY_TITLE[openPolicy]}
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closePolicyModal}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition"
                aria-label={`${POLICY_TITLE[openPolicy]} 닫기`}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="m6 6 12 12M18 6 6 18"
                    strokeLinecap="round"
                    strokeWidth="2"
                  />
                </svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 text-sm text-gray-700 leading-relaxed">
              {loading ? (
                <InlineLoading message="약관을 불러오는 중입니다." />
              ) : (
                <div className="policy-rich-text whitespace-pre-line">
                  {policyText}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <style>{`
                .policy-rich-text {
                    color: #374151;
                    line-height: 1.8;
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
