import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  DEFAULT_STUDENT_MAINTENANCE_CONFIG,
  type StudentMaintenanceConfig,
} from "../../lib/studentMaintenance";
import StatePanel from "../../components/common/StatePanel";

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
  const [signingOut, setSigningOut] = React.useState(false);
  const resolved = config || DEFAULT_STUDENT_MAINTENANCE_CONFIG;
  const title = unavailable
    ? "위스토리 접속 상태를 확인하고 있습니다"
    : resolved.title;
  const description = unavailable
    ? "현재 접속 권한과 점검 상태를 안전하게 확인하지 못했습니다. 잠시 후 다시 접속해 주세요."
    : resolved.message;

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
    <main className="ws-maintenance-page" aria-label="학생 서비스 점검 안내">
      <section className="ws-maintenance-card">
        <div className="ws-maintenance-brand" aria-label="위스토리">
          <img
            src={`${import.meta.env.BASE_URL || "/"}icons/westory-icon-192.png`}
            width="80"
            height="80"
            alt=""
          />
          <span aria-hidden="true">
            <strong>We</strong>story
          </span>
        </div>
        <p className="ws-maintenance-eyebrow">
          {unavailable ? "접속 확인 중" : "학생 서비스 점검 중"}
        </p>
        <StatePanel
          state="MAINTENANCE"
          title={title}
          description={description}
          contactAdmin
          className="ws-maintenance-state"
          headingLevel={1}
        />
        <p className="ws-maintenance-help">
          이용 안내가 필요하면 담당 교사에게 문의해 주세요.
        </p>
        {currentUser && (
          <button
            type="button"
            className="ws-maintenance-signout"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
          >
            {signingOut ? "로그아웃 중입니다" : "다른 계정으로 로그인"}
          </button>
        )}
      </section>
    </main>
  );
};

export default Maintenance;
