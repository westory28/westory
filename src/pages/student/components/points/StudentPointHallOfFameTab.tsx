import React, { useState } from 'react';
import WisHallOfFameStudentPreview, {
  type HallOfFamePreviewView,
} from '../../../../components/common/WisHallOfFameStudentPreview';
import type {
  HallOfFameInterfaceConfig,
  WisHallOfFameSnapshot,
} from '../../../../types';

interface StudentPointHallOfFameTabProps {
  snapshot: WisHallOfFameSnapshot | null;
  hallOfFameConfig?: HallOfFameInterfaceConfig | null;
  currentGrade?: string;
  currentClass?: string;
}

const StudentPointHallOfFameTab: React.FC<
  StudentPointHallOfFameTabProps
> = ({ snapshot, hallOfFameConfig, currentGrade, currentClass }) => {
  const [activeView, setActiveView] = useState<HallOfFamePreviewView>('grade');

  return (
    <WisHallOfFameStudentPreview
      snapshot={snapshot}
      hallOfFameConfig={hallOfFameConfig}
      activeView={activeView}
      onActiveViewChange={setActiveView}
      currentGrade={currentGrade}
      currentClass={currentClass}
    />
  );
};

export default StudentPointHallOfFameTab;
