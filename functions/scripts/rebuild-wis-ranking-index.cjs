const { execFileSync } = require('node:child_process');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createWisRankingIndexService } = require('../wisRankingIndex');

const parseArgs = args => {
  const options = { apply: false, project: 'history-quiz-yongsin', semesterId: '' };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--apply') { options.apply = true; continue; }
    if (argument === '--help') { options.help = true; continue; }
    const [key, inline] = argument.split('=', 2);
    if (!['--project', '--semester-id'].includes(key)) throw new Error('Unsupported argument.');
    const value = inline === undefined ? args[++index] : inline;
    if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('An argument value is required.');
    options[key === '--project' ? 'project' : 'semesterId'] = value;
  }
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(options.project)) throw new Error('Invalid project ID.');
  if (options.semesterId && !/^\d{4}-[12]$/.test(options.semesterId)) throw new Error('Invalid semester ID.');
  return options;
};

// ADC is preferred. A gcloud login can supply a short-lived credential entirely
// in memory; neither access tokens nor credential files are written or logged.
const readGcloudToken = () => {
  const output = process.platform === 'win32'
    ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud.cmd auth print-access-token'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    : execFileSync('gcloud', ['auth', 'print-access-token'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const token = String(output).trim();
  if (!token || /\s/.test(token)) throw new Error('A gcloud access token is unavailable.');
  return token;
};
const resolveCredential = async ({ createDefault = applicationDefault, tokenProvider = readGcloudToken,
  now = Date.now } = {}) => {
  try {
    const credential = createDefault();
    await credential.getAccessToken();
    return credential;
  } catch (_error) {
    let token, expiresAt = 0;
    const credential = { getAccessToken: async () => {
      if (!token || expiresAt <= now()) { token = tokenProvider(); expiresAt = now() + 3_000_000; }
      return { access_token: token, expires_in: Math.max(1, Math.floor((expiresAt - now()) / 1000)) };
    } };
    try { await credential.getAccessToken(); return credential; }
    catch (_tokenError) { throw new Error('ADC or an authenticated gcloud session is required.'); }
  }
};

const runBackfill = async ({ db, options }) => {
  let semesterId = options.semesterId;
  if (!semesterId) {
    const pointer = await db.doc('site_settings/semester_active').get();
    semesterId = pointer.data()?.semesterId;
    if (!pointer.exists || !/^\d{4}-[12]$/.test(semesterId || '')) throw new Error('The current semester pointer is unavailable.');
  }
  const totals = await createWisRankingIndexService({ db }).rebuildSemester({ semesterId, apply: options.apply });
  return { mode: options.apply ? 'apply' : 'dry-run', project: options.project, semesterId, ...totals };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('node functions/scripts/rebuild-wis-ranking-index.cjs --project history-quiz-yongsin [--semester-id YYYY-S] [--apply]');
    return;
  }
  const credential = await resolveCredential();
  const app = initializeApp({ projectId: options.project, credential }, 'wis-ranking-index-backfill');
  try { console.log(JSON.stringify(await runBackfill({ db: getFirestore(app), options }))); }
  finally { await deleteApp(app); }
};

if (require.main === module) main().catch(() => {
  // SDK errors can embed source paths or request data. Keep the operational
  // failure output generic and never print students, documents or credentials.
  console.error('Wis ranking index backfill failed. Check arguments, credentials, and the 2000-account bound.');
  process.exitCode = 1;
});
module.exports = { parseArgs, resolveCredential, runBackfill };
