import {
  DEFAULT_WEPLAY_DIFFICULTIES,
  WEPLAY_DIFFICULTY_LABELS,
  getWeplayNormalWordCount,
  type WeplayDifficulty,
  type WeplayLobby,
} from "../../../lib/weplay";

export default function WeplayGuideRules({ lobby }: { lobby: WeplayLobby }) {
  const { policy } = lobby;
  const amounts = policy.resultRewards.map((row) => row.amount);
  const maxReward = Math.max(0, ...amounts);
  const bestNet = maxReward - policy.challengeCost;
  const maxLoss = Math.max(
    0,
    policy.challengeCost - (amounts.length ? Math.min(...amounts) : 0),
  );
  return (
    <details className="weplay-guide-rules">
      <summary>난이도·위스 규칙</summary>
      <div>
        <p>
          선생님이 만든 빈칸 정답 전체에서 출제됩니다. 일반 단어를 맞히면
          자동으로 장전·발사됩니다.
        </p>
        <dl className="weplay-guide-difficulties">
          {(Object.keys(WEPLAY_DIFFICULTY_LABELS) as WeplayDifficulty[]).map(
            (difficulty, index) => {
              const practice =
                lobby.difficulties?.[difficulty] ||
                DEFAULT_WEPLAY_DIFFICULTIES[difficulty];
              const challenge =
                lobby.challengeDifficulties?.[difficulty] || practice;
              return (
                <div key={difficulty}>
                  <dt>{WEPLAY_DIFFICULTY_LABELS[difficulty]}</dt>
                  <dd>{index + 2}단어마다 화포 1회</dd>
                  <dd>
                    연습 {practice.durationSeconds}초 · 도전{" "}
                    {challenge.durationSeconds}초
                  </dd>
                  <dd>
                    일반 단어: 연습{" "}
                    {getWeplayNormalWordCount(practice.durationSeconds)}개 ·
                    도전 {getWeplayNormalWordCount(challenge.durationSeconds)}개
                  </dd>
                </div>
              );
            },
          )}
        </dl>
        <p>
          필살기 단어는 5초 안에 입력하세요. 필살기는 전투 점수에 반영되며,
          위스는 일반 단어 성공률로 정산됩니다.
        </p>
        <h3>연습과 도전</h3>
        <p>
          연습은 위스 변동이 없습니다. 도전은 시작할 때 {policy.challengeCost}
          위스가 차감됩니다.
        </p>
        <p>
          최대 손실 {maxLoss}위스 · 최대 순손익 {bestNet > 0 ? "+" : ""}
          {bestNet}위스
        </p>
        <p>
          하루 {policy.dailyChallengeLimit}회 · 오늘 남은 도전{" "}
          {lobby.dailyRemaining}회 · 난이도 공통
        </p>
        <p>
          중간에 종료해도 참가 비용은 반환되지 않으며, 전체 일반 단어 수를
          기준으로 성공률을 계산합니다.
        </p>
        <h3>결과별 지급 위스</h3>
        <ul>
          {policy.resultRewards.map((row, index, rows) => (
            <li key={row.minCorrect}>
              <span>
                성공률 {row.minCorrect * 5}% 이상
                {rows[index + 1]
                  ? ` ${rows[index + 1].minCorrect * 5}% 미만`
                  : ""}
              </span>
              <strong>{row.amount}위스</strong>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
