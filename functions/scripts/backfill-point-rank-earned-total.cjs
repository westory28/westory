const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeApp, applicationDefault, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const DEFAULT_PROJECT_ID = 'history-quiz-yongsin';
const DEFAULT_SAMPLE_LIMIT = 5;
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

const summarizeSnapshot = (snapshot) => ({
  tierCode: String(snapshot?.tierCode || ''),
  metricValue: Math.max(0, Number(snapshot?.metricValue || 0)),
  basedOn: String(snapshot?.basedOn || ''),
});

const isSnapshotEqual = (currentSnapshot, nextSnapshot) => (
  String(currentSnapshot?.tierCode || '') === String(nextSnapshot?.tierCode || '')
  && Number(currentSnapshot?.metricValue || 0) === Number(nextSnapshot?.metricValue || 0)
  && String(currentSnapshot?.basedOn || '') === String(nextSnapshot?.basedOn || '')
);

const resolveProjectId = (args) => (
  String(args.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || DEFAULT_PROJECT_ID).trim()
  || DEFAULT_PROJECT_ID
);

const resolveSampleLimit = (args) => {
  const raw = Number(args['sample-limit'] || DEFAULT_SAMPLE_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.min(20, raw) : DEFAULT_SAMPLE_LIMIT;
};

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
  const payload = {
    type: 'authorized_user',
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET,
    refresh_token: cliAuth.refreshToken,
  };
  fs.writeFileSync(credentialPath, JSON.stringify(payload, null, 2));
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

const usage = () => {
  console.error(
    'Usage: node scripts/backfill-point-rank-earned-total.cjs --year=2026 --semester=1 [--uid=studentUid] [--write=true] [--project=history-quiz-yongsin] [--allow-non-active=true] [--sample-limit=5]',
  );
  process.exit(1);
};

const loadUserSummaryMap = async (db, uids) => {
  const uniqueUids = Array.from(new Set(
    (uids || []).map((uid) => String(uid || '').trim()).filter(Boolean),
  ));
  const entries = await Promise.all(uniqueUids.map(async (uid) => {
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) return [uid, null];
    const data = userSnap.data() || {};
    return [uid, {
      studentName: String(data.studentName || data.name || data.displayName || '').trim(),
      grade: String(data.studentGrade || data.grade || '').trim(),
      class: String(data.studentClass || data.class || '').trim(),
      number: String(data.studentNumber || data.number || '').trim(),
    }];
  }));
  return Object.fromEntries(entries);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const year = String(args.year || '').trim();
  const semester = String(args.semester || '').trim();
  const targetUid = String(args.uid || '').trim();
  const shouldWrite = args.write === 'true';
  const allowNonActive = args['allow-non-active'] === 'true';
  const sampleLimit = resolveSampleLimit(args);
  const projectId = resolveProjectId(args);

  if (!year || !semester) usage();

  const credentialSource = ensureCredentialSource();

  try {
    if (!getApps().length) {
      initializeApp({
        credential: applicationDefault(),
        projectId,
      });
    }

    const db = getFirestore();
    const semesterRoot = `years/${year}/semesters/${semester}`;
    const walletCollection = db.collection(`${semesterRoot}/point_wallets`);

    const activeConfigSnap = await db.doc('site_settings/config').get();
    const activeConfig = activeConfigSnap.exists
      ? {
        year: String(activeConfigSnap.get('year') || '').trim(),
        semester: String(activeConfigSnap.get('semester') || '').trim(),
      }
      : null;

    const matchesActiveConfig = Boolean(
      activeConfig?.year
      && activeConfig?.semester
      && activeConfig.year === year
      && activeConfig.semester === semester,
    );

    if (activeConfig?.year && activeConfig?.semester && !matchesActiveConfig && !allowNonActive) {
      throw new Error(
        [
          `Refusing to backfill non-active semester ${year}/${semester}.`,
          `Active semester is ${activeConfig.year}/${activeConfig.semester}.`,
          'Pass --allow-non-active=true only if you intentionally want a different semester.',
        ].join(' '),
      );
    }

    const [policySnap, walletSnap, manualAdjustSnap] = await Promise.all([
      db.doc(`${semesterRoot}/point_policies/current`).get(),
      targetUid ? walletCollection.where('uid', '==', targetUid).get() : walletCollection.get(),
      targetUid
        ? db.collection(`${semesterRoot}/point_transactions`).where('uid', '==', targetUid).where('type', '==', 'manual_adjust').get()
        : db.collection(`${semesterRoot}/point_transactions`).where('type', '==', 'manual_adjust').get(),
    ]);

    const rawPolicy = policySnap.data() || {};
    const hasStoredRankPolicy = Boolean(rawPolicy.rankPolicy);
    const rankPolicy = normalizeRankPolicy(rawPolicy.rankPolicy);
    const warnings = [];

    if (!policySnap.exists) {
      warnings.push('point_policies/current does not exist for the target semester. Default rank tiers were used.');
    } else if (!hasStoredRankPolicy) {
      warnings.push('point_policies/current.rankPolicy is missing. Default rank tiers were used for backfill.');
    }

    const positiveManualAdjustByUid = {};
    manualAdjustSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const uid = String(data.uid || '').trim();
      const delta = Number(data.delta || 0);
      if (!uid || delta <= 0) return;
      positiveManualAdjustByUid[uid] = Number(positiveManualAdjustByUid[uid] || 0) + delta;
    });

    let changedCount = 0;
    let skippedCount = 0;
    let pendingBatch = db.batch();
    let pendingWrites = 0;
    const samples = [];
    const tierBreakdown = {};

    for (const docSnap of walletSnap.docs) {
      const data = docSnap.data() || {};
      const uid = String(data.uid || docSnap.id).trim();
      const rankEarnedTotal = Math.max(0, Number(data.earnedTotal || 0) + Number(positiveManualAdjustByUid[uid] || 0));
      const nextSnapshot = buildRankSnapshot(rankEarnedTotal, rankPolicy);
      const sameRankEarnedTotal = Number(data.rankEarnedTotal || 0) === rankEarnedTotal;
      const sameSnapshot = isSnapshotEqual(data.rankSnapshot, nextSnapshot);

      if (sameRankEarnedTotal && sameSnapshot) {
        skippedCount += 1;
        continue;
      }

      changedCount += 1;
      tierBreakdown[nextSnapshot.tierCode] = Number(tierBreakdown[nextSnapshot.tierCode] || 0) + 1;

      if (samples.length < sampleLimit) {
        samples.push({
          uid,
          studentName: String(data.studentName || '').trim(),
          grade: String(data.grade || '').trim(),
          class: String(data.class || '').trim(),
          number: String(data.number || '').trim(),
          earnedTotal: Number(data.earnedTotal || 0),
          positiveManualAdjust: Number(positiveManualAdjustByUid[uid] || 0),
          previousRankEarnedTotal: Number(data.rankEarnedTotal || 0),
          previousRankSnapshot: data.rankSnapshot ? summarizeSnapshot(data.rankSnapshot) : null,
          rankEarnedTotal,
          rankSnapshot: summarizeSnapshot(nextSnapshot),
          tierCode: nextSnapshot.tierCode,
        });
      }

      if (shouldWrite) {
        pendingBatch.set(docSnap.ref, {
          rankEarnedTotal,
          rankSnapshot: nextSnapshot,
        }, { merge: true });
        pendingWrites += 1;

        if (pendingWrites >= 400) {
          await pendingBatch.commit();
          pendingBatch = db.batch();
          pendingWrites = 0;
        }
      }
    }

    if (shouldWrite && pendingWrites > 0) {
      await pendingBatch.commit();
    }

    const userSummaryMap = await loadUserSummaryMap(db, samples.map((sample) => sample.uid));
    const hydratedSamples = samples.map((sample) => {
      const userSummary = userSummaryMap[sample.uid] || {};
      return {
        ...sample,
        studentName: sample.studentName || userSummary.studentName || '',
        grade: sample.grade || userSummary.grade || '',
        class: sample.class || userSummary.class || '',
        number: sample.number || userSummary.number || '',
      };
    });

    console.log(JSON.stringify({
      projectId,
      credentialSource: credentialSource.type,
      credentialEmail: credentialSource.email || '',
      activeConfig,
      target: {
        year,
        semester,
        matchesActiveConfig,
      },
      targetUid: targetUid || null,
      mode: shouldWrite ? 'write' : 'dry-run',
      walletCount: walletSnap.size,
      changedCount,
      skippedCount,
      policyDocExists: policySnap.exists,
      hasStoredRankPolicy,
      effectiveRankPolicy: rankPolicy,
      tierBreakdown,
      warnings,
      samples: hydratedSamples,
    }, null, 2));
  } finally {
    credentialSource.cleanup();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
