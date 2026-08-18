import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import {
  DEFAULT_STUDENT_MAINTENANCE_CONFIG,
  type StudentMaintenanceConfig,
} from "../../lib/studentMaintenance";

interface MaintenanceProps {
  config?: StudentMaintenanceConfig | null;
  unavailable?: boolean;
}

type MaintenancePolicyType = "terms" | "privacy";

const POLICY_LABEL: Record<MaintenancePolicyType, string> = {
  terms: "이용약관",
  privacy: "개인정보 보호 약관",
};

const POLICY_BLOCK_TAGS = new Set([
  "address",
  "article",
  "blockquote",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "ol",
  "p",
  "section",
  "ul",
]);

const toReadablePolicyText = (value: string) => {
  const parsed = new DOMParser().parseFromString(value, "text/html");
  parsed
    .querySelectorAll("script, style, template, noscript")
    .forEach((element) => element.remove());

  const readNode = (node: ChildNode): string => {
    if (node.nodeType === 3) return node.textContent || "";
    if (!(node instanceof HTMLElement)) {
      return Array.from(node.childNodes).map(readNode).join("");
    }

    const tagName = node.tagName.toLowerCase();
    if (tagName === "br") return "\n";

    const content = Array.from(node.childNodes).map(readNode).join("");
    if (tagName === "li") return `• ${content.trim()}\n`;
    return POLICY_BLOCK_TAGS.has(tagName) ? `${content.trim()}\n` : content;
  };

  return readNode(parsed.body)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const Maintenance: React.FC<MaintenanceProps> = ({
  config,
  unavailable = false,
}) => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const policyDialogRef = useRef<HTMLDialogElement | null>(null);
  const policyTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [openPolicy, setOpenPolicy] = useState<MaintenancePolicyType | null>(
    null,
  );
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyText, setPolicyText] = useState("");
  const resolvedConfig = config || DEFAULT_STUDENT_MAINTENANCE_CONFIG;
  const title = unavailable
    ? "위스토리 접속 상태를 확인하고 있습니다"
    : resolvedConfig.title;
  const messageLines = unavailable
    ? [
        "현재 접속 권한과 점검 상태를 안전하게 확인하지 못했습니다.",
        "잠시 후 다시 접속해 주세요.",
      ]
    : resolvedConfig.message.split(/\r?\n/).filter(Boolean);

  const handleClosePolicy = () => {
    const trigger = policyTriggerRef.current;
    setOpenPolicy(null);
    window.requestAnimationFrame(() => trigger?.focus());
  };

  useEffect(() => {
    const dialog = policyDialogRef.current;
    if (!openPolicy || !dialog) return;
    if (!dialog.open) dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [openPolicy]);

  const handleOpenPolicy = async (
    type: MaintenancePolicyType,
    trigger: HTMLButtonElement,
  ) => {
    policyTriggerRef.current = trigger;
    setOpenPolicy(type);
    setPolicyLoading(true);
    setPolicyText("");

    try {
      const snap = await getDoc(doc(db, "site_settings", type));
      const text = snap.exists()
        ? String((snap.data() as { text?: unknown }).text || "")
        : "";
      setPolicyText(toReadablePolicyText(text) || "등록된 내용이 없습니다.");
    } catch (error) {
      console.error("Maintenance policy load error:", error);
      setPolicyText("내용을 불러오지 못했습니다.");
    } finally {
      setPolicyLoading(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      navigate("/", { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <main className="maintenance-page" aria-labelledby="maintenance-title">
      <section className="maintenance-card">
        <div className="maintenance-brand">
          <img
            className="maintenance-brand__wordmark"
            src="/icons/westory-wordmark.svg"
            width="264"
            height="72"
            alt="Westory"
          />
        </div>

        <p className="maintenance-status">
          {unavailable ? "접속 확인 중" : "정기 점검 중"}
        </p>
        <h1 id="maintenance-title" className="maintenance-title">
          {title}
        </h1>
        <div className="maintenance-message">
          {messageLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        <div className="maintenance-help">
          <p>이용 안내가 필요하면 담당 교사에게 문의해 주세요.</p>
          <a className="maintenance-contact" href="mailto:westoria28@gmail.com">
            교사 연락 이메일 westoria28@gmail.com
          </a>
          {currentUser && (
            <button
              type="button"
              className="maintenance-signout"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
            >
              {signingOut ? "로그아웃 중" : "다른 계정으로 로그인"}
            </button>
          )}
        </div>

        <nav className="maintenance-policy-links" aria-label="약관 안내">
          <button
            type="button"
            onClick={(event) =>
              void handleOpenPolicy("terms", event.currentTarget)
            }
          >
            이용약관
          </button>
          <span aria-hidden="true">|</span>
          <button
            type="button"
            onClick={(event) =>
              void handleOpenPolicy("privacy", event.currentTarget)
            }
          >
            개인정보 보호 약관
          </button>
        </nav>
      </section>

      {openPolicy && (
        <dialog
          ref={policyDialogRef}
          className="maintenance-policy-backdrop"
          onCancel={(event) => {
            event.preventDefault();
            handleClosePolicy();
          }}
          aria-labelledby="maintenance-policy-title"
        >
          <section className="maintenance-policy-dialog">
            <header className="maintenance-policy-dialog__header">
              <h2 id="maintenance-policy-title">{POLICY_LABEL[openPolicy]}</h2>
              <button
                type="button"
                className="maintenance-policy-dialog__close"
                onClick={handleClosePolicy}
                aria-label={`${POLICY_LABEL[openPolicy]} 닫기`}
              >
                닫기
              </button>
            </header>
            <div
              className="maintenance-policy-dialog__body"
              role="region"
              tabIndex={0}
              aria-label={`${POLICY_LABEL[openPolicy]} 내용`}
            >
              {policyLoading ? (
                <p role="status">약관을 불러오는 중입니다.</p>
              ) : (
                <p className="maintenance-policy-content">{policyText}</p>
              )}
            </div>
          </section>
        </dialog>
      )}
    </main>
  );
};

export default Maintenance;
