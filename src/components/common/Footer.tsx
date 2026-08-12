import React, { useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { InlineLoading } from "./LoadingState";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import { normalizeInstagramUrl } from "../../lib/socialLinks";
import ModalSurface from "./ModalSurface";
import PublicServiceLinks from "./PublicServiceLinks";

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

  return (
    <>
      <footer className="bg-white border-t border-stone-200 py-4 mt-auto">
        <div className="container mx-auto text-center">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
            <PublicServiceLinks
              onOpenTerms={() => void openPolicyModal("terms")}
              onOpenPrivacy={() => void openPolicyModal("privacy")}
            />
            <span className="text-stone-300 text-xs" aria-hidden="true">
              ·
            </span>
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

      <ModalSurface
        open={Boolean(openPolicy)}
        title={openPolicy ? POLICY_TITLE[openPolicy] : "서비스 정책"}
        onClose={closePolicyModal}
        size="wide"
      >
        {loading ? (
          <InlineLoading message="약관을 불러오는 중입니다." />
        ) : (
          <div className="policy-rich-text whitespace-pre-line">
            {policyText}
          </div>
        )}
      </ModalSurface>
    </>
  );
};

export default Footer;
