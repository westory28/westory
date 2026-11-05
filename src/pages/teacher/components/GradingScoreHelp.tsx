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
            {
              label: "예상 등급",
              content:
                "일부 항목만 입력하면 입력한 항목의 반영 비율을 기준으로 100점 만점으로 환산합니다.",
            },
          ],
        },
      ]}
    />
  );
}
