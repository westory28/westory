import React from "react";
import type { W8DomainState } from "../../lib/w8Domains";
import StatePanel from "./StatePanel";

const W8ReadOnlyState: React.FC<{ state: W8DomainState }> = ({ state }) => {
  if (!state.readOnly) return null;
  if (state.provenance === "LEGACY" || state.status === "LEGACY") {
    return (
      <StatePanel
        state="LEGACY"
        compact
        description="이전 구조의 자료이며 현재 학기 자료와 섞지 않습니다. 확인만 할 수 있습니다."
        readOnly
      />
    );
  }
  if (state.provenance === "PREPARING") {
    return (
      <StatePanel
        state="STALE"
        compact
        title="준비 중인 학기 자료입니다."
        description="운영 준비가 끝날 때까지 확인만 할 수 있습니다."
        readOnly
      />
    );
  }
  if (state.provenance === "EXPLICIT") {
    return (
      <StatePanel
        state="ARCHIVED"
        compact
        title="직접 선택한 학기 자료입니다."
        description="현재 학기 작업과 섞이지 않도록 확인만 할 수 있습니다."
        readOnly
      />
    );
  }
  return <StatePanel state="ARCHIVED" compact readOnly />;
};

export default W8ReadOnlyState;
