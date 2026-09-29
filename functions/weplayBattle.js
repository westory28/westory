// Pure, bounded combat replay. No timers, database reads, or animation work.
// Keep src/lib/weplayBattle.ts in parity; verify-weplay-battle.cjs checks both.
const WEPLAY_BATTLE_MAX_HP = 100;
const WEPLAY_BATTLE_CONFIG = {
  mild: { ammoRequired: 2, enemyIntervalMs: 8000, enemyDamage: 8, initialWindow: 12 },
  medium: { ammoRequired: 3, enemyIntervalMs: 6000, enemyDamage: 8, initialWindow: 10 },
  spicy: { ammoRequired: 4, enemyIntervalMs: 4800, enemyDamage: 9, initialWindow: 8 },
};

function simulateWeplayBattle(session, elapsedMs, acceptedEvents = session.acceptedEvents || []) {
  const config = WEPLAY_BATTLE_CONFIG[session.difficulty];
  const durationMs = session.endsAtMs - session.startsAtMs;
  const until = Math.max(0, Math.min(durationMs, elapsedMs));
  const windows = session.difficultySettings?.fallSeconds || { mild: [12, 10, 8], medium: [10, 8, 6], spicy: [8, 6, 4] }[session.difficulty];
  const intervalAt = (time) => Math.max(1000, Math.round(config.enemyIntervalMs * windows[Math.min(2, Math.floor(Math.max(0, time) / (durationMs / 3)))] / config.initialWindow));
  const state = {
    playerHp: WEPLAY_BATTLE_MAX_HP, enemyHp: WEPLAY_BATTLE_MAX_HP, ammo: 0,
    cannonShots: 0, specialCount: 0, sunkShips: 0, damageDealt: 0, enemyShots: 0,
    nextEnemyAttackAtMs: intervalAt(0), defeatAtMs: null, outcome: 'active',
    score: 0, normalCorrectCount: 0, rewardCorrectCount: 0,
  };
  const attackUntil = (time) => {
    while (state.nextEnemyAttackAtMs <= time && state.nextEnemyAttackAtMs < durationMs && state.playerHp > 0) {
      const attackedAt = state.nextEnemyAttackAtMs;
      state.enemyShots += 1;
      state.playerHp = Math.max(0, state.playerHp - config.enemyDamage);
      state.nextEnemyAttackAtMs += intervalAt(attackedAt);
      if (state.playerHp === 0) state.defeatAtMs = attackedAt;
    }
  };
  const seen = new Set();
  const words = new Map(session.words.map((word) => [word.id, word]));
  const events = [...acceptedEvents].sort((a, b) => a.elapsedMs - b.elapsedMs || a.wordId.localeCompare(b.wordId));
  for (const event of events) {
    if (event.elapsedMs > until) break;
    const word = words.get(event.wordId);
    if (!word || seen.has(event.wordId) || !Number.isFinite(event.elapsedMs) || event.elapsedMs < 0) continue;
    seen.add(event.wordId);
    attackUntil(event.elapsedMs);
    if (state.playerHp === 0) break;
    let damage = 0;
    if (word.kind === 'special') {
      state.specialCount += 1;
      damage = 45;
      state.nextEnemyAttackAtMs += 5000;
    } else {
      state.normalCorrectCount += 1;
      state.ammo += 1;
      if (state.ammo === config.ammoRequired) {
        state.ammo = 0;
        state.cannonShots += 1;
        damage = 12;
        state.nextEnemyAttackAtMs += 5000;
      }
    }
    state.damageDealt += damage;
    state.enemyHp -= damage;
    while (state.enemyHp <= 0) {
      state.sunkShips += 1;
      state.enemyHp += WEPLAY_BATTLE_MAX_HP;
    }
  }
  attackUntil(until);
  state.outcome = state.playerHp === 0 ? 'defeat' : elapsedMs >= durationMs ? 'victory' : 'active';
  const normalTotal = session.words.filter((word) => word.kind !== 'special').length;
  state.rewardCorrectCount = normalTotal ? Math.min(20, Math.floor(state.normalCorrectCount * 20 / normalTotal)) : 0;
  state.score = state.normalCorrectCount * 100 + state.cannonShots * 150 + state.specialCount * 500 + state.sunkShips * 1000;
  return state;
}

module.exports = { WEPLAY_BATTLE_MAX_HP, WEPLAY_BATTLE_CONFIG, simulateWeplayBattle };
