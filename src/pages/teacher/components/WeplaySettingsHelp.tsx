import InfoHelp from "../../../components/common/InfoHelp";

export default function WeplaySettingsHelp() {
  return (
    <InfoHelp
      label="난이도 설정 도움말"
      sections={[
        {
          rows: [
            {
              label: "출제량",
              content:
                "90초 기준 일반 단어 60개입니다. 시간을 늘리면 출제량도 늘어납니다.",
            },
            {
              label: "진행 단계",
              content: "초반·중반·후반은 전체 제한시간의 ⅓씩입니다.",
            },
            {
              label: "입력 시간",
              content: "짧을수록 단어가 빨리 사라지고 적의 공격도 빨라집니다.",
            },
            {
              label: "화포 발사",
              content: "착한맛 2단어 · 중간맛 3단어 · 매운맛 4단어",
            },
            {
              label: "필살기",
              content:
                "기회는 2회이며 긴 단어를 5초 안에 입력해야 합니다. 단어 길이는 공백을 제외하고 셉니다.",
            },
          ],
        },
      ]}
    />
  );
}
