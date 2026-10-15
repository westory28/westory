import InfoHelp from "../../../components/common/InfoHelp";
import {
  isThreeLevelSubject,
  SCORE_ACHIEVEMENT_GUIDANCE,
} from "../../../lib/studentScores";

export default function GradingScoreHelp({ subject }: { subject: string }) {
  return (
    <InfoHelp
      label="성취도 기준 도움말"
      sections={[
        {
          rows: [
            {
              label: "성취도 기준",
              content: isThreeLevelSubject(subject)
                ? SCORE_ACHIEVEMENT_GUIDANCE.artsPE
                : SCORE_ACHIEVEMENT_GUIDANCE.general,
            },
            { label: "반올림", content: SCORE_ACHIEVEMENT_GUIDANCE.rounding },
          ],
        },
      ]}
    />
  );
}
