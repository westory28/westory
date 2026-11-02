const path = require('node:path');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { Firestore } = require('@google-cloud/firestore');
const { OAuth2Client } = require('google-auth-library');
const { createStudentRegistrationNotificationService } = require('../studentRegistrationNotifications');

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const credential = async () => {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return applicationDefault();
  let cliAuth;
  try { cliAuth = require('firebase-tools/lib/auth'); }
  catch {
    if (!process.env.APPDATA) throw new Error('FIREBASE_CLI_CREDENTIAL_REQUIRED');
    cliAuth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'));
  }
  const account = cliAuth.getProjectDefaultAccount(process.cwd());
  if (!account?.tokens?.refresh_token) throw new Error('FIREBASE_CLI_CREDENTIAL_REQUIRED');
  let cached = account.tokens;
  // Reuse the CLI's active account and token refresh entirely in memory.
  return { getAccessToken: async () => {
    if (!cached?.access_token || !cached.expires_at || cached.expires_at <= Date.now() + 60000) {
      cached = await cliAuth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
    }
    return { access_token: cached.access_token,
      expires_in: Math.max(1, Math.floor((cached.expires_at - Date.now()) / 1000)) };
  } };
};

(async () => {
  const projectId = arg('project') || 'history-quiz-yongsin', semesterId = arg('semester');
  if (!/^\d{4}-[12]$/.test(semesterId || '')) throw new Error('EXPECTED_SEMESTER_REQUIRED');
  const apply = process.argv.includes('--apply');
  const resolvedCredential = await credential();
  const authClient = new OAuth2Client();
  const refresh = async () => {
    const token = await resolvedCredential.getAccessToken();
    return { access_token: token.access_token, expiry_date: Date.now() + token.expires_in * 1000 };
  };
  authClient.refreshHandler = refresh;
  authClient.setCredentials(await refresh());
  const app = initializeApp({ projectId, credential: resolvedCredential });
  const db = new Firestore({ projectId, authClient });
  try {
    const auth = getAuth(app);
    const pointer = (await db.doc('site_settings/semester_active').get()).data();
    if (pointer?.semesterId !== semesterId) throw new Error('ACTIVE_SEMESTER_CHANGED');
    const admin = await auth.getUserByEmail('westoria28@gmail.com');
    if (admin.disabled || !admin.emailVerified) throw new Error('ACTIVE_ADMIN_REQUIRED');
    const service = createStudentRegistrationNotificationService({ db, resolveAdminUid: async () => admin.uid });
    const result = await service.reconcilePending({ apply, expectedSemesterId: semesterId });
    console.log(JSON.stringify({ projectId, semesterId, ...result }));
  } finally { await db.terminate(); await deleteApp(app); }
})().catch(error => {
  // Never print applicant profiles, IDs or SDK request details in a release log.
  console.error(error.code || (/^[A-Z_]+$/.test(error.message || '') ? error.message : 'REGISTRATION_NOTIFICATION_BACKFILL_FAILED'));
  process.exitCode = 1;
});
