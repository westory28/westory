import React from "react";
import { Link } from "react-router-dom";

interface PublicServiceLinksProps {
  onOpenTerms?: () => void;
  onOpenPrivacy?: () => void;
  includeContact?: boolean;
  className?: string;
}

const PublicServiceLinks: React.FC<PublicServiceLinksProps> = ({
  onOpenTerms,
  onOpenPrivacy,
  includeContact = true,
  className = "",
}) => (
  <nav
    className={`ws-public-links ${className}`.trim()}
    aria-label="서비스 정책과 문의"
  >
    {onOpenTerms ? (
      <button type="button" onClick={onOpenTerms}>
        이용약관
      </button>
    ) : (
      <Link to="/?policy=terms">이용약관</Link>
    )}
    <span aria-hidden="true">|</span>
    {onOpenPrivacy ? (
      <button type="button" onClick={onOpenPrivacy}>
        개인정보 보호 약관
      </button>
    ) : (
      <Link to="/?policy=privacy">개인정보 보호 약관</Link>
    )}
    {includeContact && (
      <>
        <span aria-hidden="true">|</span>
        <a href="mailto:westoria28@gmail.com">westoria28@gmail.com</a>
      </>
    )}
  </nav>
);

export default PublicServiceLinks;
