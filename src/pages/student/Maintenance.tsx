import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  DEFAULT_STUDENT_MAINTENANCE_CONFIG,
  type StudentMaintenanceConfig,
} from "../../lib/studentMaintenance";

interface MaintenanceProps {
  config?: StudentMaintenanceConfig | null;
  unavailable?: boolean;
}

const Maintenance: React.FC<MaintenanceProps> = ({
  config,
  unavailable = false,
}) => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
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
        <div className="maintenance-brand" role="img" aria-label="위스토리">
          <img
            className="maintenance-brand__icon"
            src="/icons/westory-icon-192.png"
            width="96"
            height="96"
            alt=""
          />
          <p className="maintenance-brand__wordmark" aria-hidden="true">
            <span className="logo-we">We</span>
            <span className="logo-story">story</span>
          </p>
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
      </section>
    </main>
  );
};

export default Maintenance;
