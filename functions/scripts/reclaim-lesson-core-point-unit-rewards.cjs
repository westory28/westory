const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeApp, applicationDefault, getApps } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const DEFAULT_PROJECT_ID = 'history-quiz-yongsin';
const LESSON_CORE_POINTS_ALL_SOURCE_ID = 'lesson-core-points-all';
const RECLAIM_TYPE = 'lesson_core_points_reclaim';
const FIREBASE_CLI_CLIENT_ID =
  process.env.FIREBASE_CLIENT_ID ||
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLI_CLIENT_SECRET =
  process.env.FIREBASE_CLIENT_SECRET || 'j9iVZfS8kkCEFUPaAeJV0sAi';
const DEFAULT_RANK_TIERS = [
  { code: 'tier_1', minPoints: 0 },
  { code: 'tier_2', minPoints: 50 },
  { code: 'tier_3', minPoints: 150 },
  { code: 'tier_4', minPoints: 300 },
  { code: 'tier_5', minPoints: 500 },
];

const parseArgs = (argv) => argv.reduce((accumulator, argument) => {
  if (!argument.startsWith('--')) return accumulator;
  const [rawKey, rawValue] = argument.slice(2).split('=');
  const key = String(rawKey || '').trim();
  if (!key) return accumulator;
  accumulator[key] = rawValue === undefined ? 'true' : String(rawValue).trim();
  return accumulator;
}, {});

const resolveProjectId = (args) => (
  String(args.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || DEFAULT_PROJECT_ID).trim()
  || DEFAULT_PROJECT_ID
);

const resolveFirebaseCliConfigPath = () => {
  if (process.env.FIREBASE_TOOLS_CONFIG_PATH && fs.existsSync(process.env.FIREBASE_TOOLS_CONFIG_PATH)) {
    return process.env.FIREBASE_TOOLS_CONFIG_PATH;
  }

  const candidates = [
    path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
};

const loadFirebaseCliRefreshToken = () => {
  const configPath = resolveFirebaseCliConfigPath();
  if (!configPath) return null;

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const refreshToken = raw?.tokens?.refresh_token;
  const email = raw?.user?.email || '';
  if (!refreshToken) return null;

  return {
    configPath,
    email,
    refreshToken,
  };
};

const ensureCredentialSource = () => {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      type: 'google-application-credentials',
      path: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      email: '',
      cleanup: () => undefined,
    };
  }

  const cliAuth = loadFirebaseCliRefreshToken();
  if (!cliAuth) {
    throw new Error(
      [
        'No application default credentials were found.',
        'Set GOOGLE_APPLICATION_CREDENTIALS or sign in with `npx firebase-tools login` first.',
      ].join(' '),
    );
  }

  const credentialPath = path.join(
    os.tmpdir(),
    `westory-${(cliAuth.email || 'firebase-cli').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}-adc.json`,
  );
  fs.writeFileSync(credentialPath, JSON.stringify({
    type: 'authorized_user',
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET,
    refresh_token: cliAuth.refreshToken,
  }, null, 2));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;

  return {
    type: 'firebase-cli-login',
    path: cliAuth.configPath,
    email: cliAuth.email,
    cleanup: () => {
      try {
        fs.unlinkSync(credentialPath);
      } catch (error) {
        if (error && error.code !== 'ENOENT') {
          console.warn('[cleanup] Failed to remove temporary ADC file:', error.message || error);
        }
      }
    },
  };
};

const normalizeTierCode = (value, index) => {
  const raw = String(value || '').trim();
  return /^tier_\d+$/.test(raw) ? raw : `tier_${index + 1}`;
};

const normalizeRankPolicy = (rawRankPolicy) => {
  const tiers = Array.isArray(rawRankPolicy?.tiers)
    ? rawRankPolicy.tiers
      .map((tier, index) => ({
        code: normalizeTierCode(tier?.code, index),
        minPoints: Math.max(0, Number(tier?.minPoints ?? tier?.threshold ?? 0)),
      }))
      .sort((a, b) => a.minPoints - b.minPoints)
    : DEFAULT_RANK_TIERS.map((tier) => ({ ...tier }));

  return {
    basedOn: rawRankPolicy?.basedOn === 'earnedTotal' || rawRankPolicy?.basedOn === 'earnedTotal_plus_positive_manual_adjust'
      ? rawRankPolicy.basedOn
      : 'earnedTotal_plus_positive_manual_adjust',
    tiers: tiers.length > 0 ? tiers : DEFAULT_RANK_TIERS.map((tier) => ({ ...tier })),
  };
};

const buildRankSnapshot = (rankEarnedTotal, rankPolicy) => {
  const metricValue = Math.max(0, Number(rankEarnedTotal || 0));
  let activeTier = rankPolicy.tiers[0] || DEFAULT_RANK_TIERS[0];
  rankPolicy.tiers.forEach((tier) => {
    if (metricValue >= Number(tier.minPoints || 0)) {
      activeTier = tier;
    }
  });
  return {
    tierCode: activeTier.code,
    metricValue,
    basedOn: rankPolicy.basedOn,
    updatedAt: FieldValue.serverTimestamp(),
  };
};

const sanitizeReclaimText = (value, fallback = '') => (
  String(value || '').replace(/\s+/g, ' ').trim() || fallback
);

const shouldReclaim = (transaction) => {
  const sourceId = String(transaction.sourceId || '').trim();
  return (
    String(transaction.type || '').trim() === 'lesson_core_points'
    && sourceId
    && sourceId !== LESSON_CORE_POINTS_ALL_SOURCE_ID
    && Number(transaction.delta || 0) > 0
    && transaction.reclaimed !== true
  );
};

const usage = () => {
  console.error(
    'Usage: node scripts/reclaim-lesson-core-point-unit-rewards.cjs [--year=2026 --semester=1] [--write=true] [--project=history-quiz-yongsin]',
  );
  process.exit(1);
};

const resolveTargetScope = async (db, args) => {
  const explicitYear = String(args.year || '').trim();
  const explicitSemester = String(args.semester || '').trim();
  if (explicitYear && explicitSemester) {
    return { year: explicitYear, semester: explicitSemester, activeConfig: null };
  }
  if (explicitYear || explicitSemester) usage();

  const activeConfigSnap = await db.doc('site_settings/config').get();
  const activeConfig = activeConfigSnap.exists ? activeConfigSnap.data() || {} : {};
  const year = String(activeConfig.year || '').trim();
  const semester = String(activeConfig.semester || '').trim();
  if (!year || !semester) {
    throw new Error('Active year/semester was not found. Pass --year and --semester explicitly.');
  }
  return {
    year,
    semester,
    activeConfig: { year, semester },
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const shouldWrite = args.write === 'true';
  const projectId = resolveProjectId(args);
  const credentialSource = ensureCredentialSource();

  try {
    if (!getApps().length) {
      initializeApp({
        credential: applicationDefault(),
        projectId,
      });
    }

    const db = getFirestore();
    const { year, semester, activeConfig } = await resolveTargetScope(db, args);
    const semesterRoot = `years/${year}/semesters/${semester}`;
    const policySnap = await db.doc(`${semesterRoot}/point_policies/current`).get();
    const rankPolicy = normalizeRankPolicy((policySnap.data() || {}).rankPolicy);
    const txCollection = db.collection(`${semesterRoot}/point_transactions`);
    const rewardSnap = await txCollection.where('type', '==', 'lesson_core_points').get();
    const candidates = rewardSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ref: docSnap.ref, data: docSnap.data() || {} }))
      .filter((item) => shouldReclaim(item.data));

    const samples = [];
    let reclaimedCount = 0;
    let reclaimedAmount = 0;
    let skippedExistingReclaimCount = 0;

    for (const candidate of candidates) {
      const amount = Math.max(0, Number(candidate.data.delta || 0));
      const uid = String(candidate.data.uid || '').trim();
      const reclaimId = `${candidate.id}_reclaim`;
      const reclaimRef = txCollection.doc(reclaimId);
      if (samples.length < 20) {
        samples.push({
          transactionId: candidate.id,
          uid,
          amount,
          sourceId: String(candidate.data.sourceId || '').trim(),
          sourceLabel: String(candidate.data.sourceLabel || '').trim(),
        });
      }
      if (!shouldWrite) continue;

      await db.runTransaction(async (transaction) => {
        const rewardTxSnap = await transaction.get(candidate.ref);
        if (!rewardTxSnap.exists) return;
        const rewardTx = rewardTxSnap.data() || {};
        if (!shouldReclaim(rewardTx)) return;

        const reclaimTxSnap = await transaction.get(reclaimRef);
        if (reclaimTxSnap.exists) {
          skippedExistingReclaimCount += 1;
          transaction.set(candidate.ref, {
            reclaimed: true,
            reclaimedAt: rewardTx.reclaimedAt || FieldValue.serverTimestamp(),
            reclaimedBy: rewardTx.reclaimedBy || 'system:migration',
            reclaimReason: rewardTx.reclaimReason || 'lesson_core_points_scope_changed',
          }, { merge: true });
          return;
        }

        const walletRef = db.doc(`${semesterRoot}/point_wallets/${uid}`);
        const walletSnap = await transaction.get(walletRef);
        const wallet = walletSnap.exists ? walletSnap.data() || {} : {};
        const safeAmount = Math.max(0, Number(rewardTx.delta || 0));
        const currentBalance = Number(wallet.balance || 0);
        const currentEarnedTotal = Number(wallet.earnedTotal || 0);
        const currentRankEarnedTotal = Number.isFinite(Number(wallet.rankEarnedTotal))
          ? Number(wallet.rankEarnedTotal || 0)
          : currentEarnedTotal;
        const nextBalance = currentBalance - safeAmount;
        const nextEarnedTotal = Math.max(0, currentEarnedTotal - safeAmount);
        const nextRankEarnedTotal = Math.max(0, currentRankEarnedTotal - safeAmount);

        transaction.set(walletRef, {
          uid,
          balance: nextBalance,
          earnedTotal: nextEarnedTotal,
          rankEarnedTotal: nextRankEarnedTotal,
          rankSnapshot: buildRankSnapshot(nextRankEarnedTotal, rankPolicy),
          spentTotal: Number(wallet.spentTotal || 0),
          adjustedTotal: Number(wallet.adjustedTotal || 0),
          lastTransactionAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        transaction.set(candidate.ref, {
          reclaimed: true,
          reclaimedAt: FieldValue.serverTimestamp(),
          reclaimedBy: 'system:migration',
          reclaimReason: 'lesson_core_points_scope_changed',
        }, { merge: true });

        transaction.set(reclaimRef, {
          uid,
          type: RECLAIM_TYPE,
          activityType: RECLAIM_TYPE,
          delta: -safeAmount,
          balanceAfter: nextBalance,
          sourceId: sanitizeReclaimText(rewardTx.sourceId),
          sourceLabel: '핵심포인트 보상 회수: 전체 완료 기준으로 변경',
          policyId: sanitizeReclaimText(rewardTx.policyId, 'current'),
          createdBy: 'system:migration',
          targetMonth: '',
          targetDate: '',
          originalTransactionId: candidate.id,
          createdAt: FieldValue.serverTimestamp(),
        });

        reclaimedCount += 1;
        reclaimedAmount += safeAmount;
      });
    }

    if (shouldWrite && reclaimedCount > 0) {
      await db.doc(`${semesterRoot}/point_public/hall_of_fame`).set({
        sourceUpdatedAt: FieldValue.serverTimestamp(),
        sourceUpdatedAtMs: Date.now(),
      }, { merge: true });
    }

    console.log(JSON.stringify({
      projectId,
      credentialSource: credentialSource.type,
      credentialEmail: credentialSource.email || '',
      activeConfig,
      target: { year, semester },
      mode: shouldWrite ? 'write' : 'dry-run',
      scannedRewardCount: rewardSnap.size,
      candidateCount: candidates.length,
      reclaimedCount: shouldWrite ? reclaimedCount : 0,
      reclaimedAmount: shouldWrite ? reclaimedAmount : 0,
      skippedExistingReclaimCount,
      samples,
    }, null, 2));
  } finally {
    credentialSource.cleanup();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
