import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { accessToken } from './prepare-wis-stock-schedule-release.mjs';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { OAuth2Client } = require('google-auth-library');
const apply = process.argv.includes('--apply');
assert(process.argv.slice(2).every(arg => ['--apply', '--dry-run'].includes(arg)));
assert(!process.env.FIRESTORE_EMULATOR_HOST);
const auth = new OAuth2Client();
auth.setCredentials({ access_token: await accessToken(), expiry_date: Date.now() + 600000 });
const db = new Firestore({ projectId: 'history-quiz-yongsin', preferRest: true, auth });
const postPath = 'site_settings/developer_logs/items/wispi-deposit-500-20261117';
const paragraph = '<p><strong>이벤트 지원금 500위스는 위스피에서만 사용할 수 있으며, 일반 지갑으로 출금할 수 없습니다.</strong> 지원금으로 투자해 손실을 만회한 뒤 생긴 수익은 출금할 수 있습니다.</p>';
try {
  const result = await db.runTransaction(async tx => {
    const ref = db.doc(postPath), snapshot = await tx.get(ref);
    assert(snapshot.exists);
    const post = snapshot.data();
    assert.equal(post.title, '[이벤트] 위스피, 500 넣고 500 더.');
    assert.equal(post.action, 'wispi');
    assert(typeof post.bodyHtml === 'string' && post.bodyHtml.includes('누적 500위스 이상'));
    const changed = !post.bodyHtml.includes(paragraph);
    if (changed && apply) tx.update(ref, { bodyHtml: post.bodyHtml + paragraph, updatedAt: FieldValue.serverTimestamp() });
    return { mode: apply ? 'APPLIED' : 'DRY_RUN', changed: changed && apply,
      postPath, addition: paragraph, preservedAction: post.action };
  }, apply ? undefined : { readOnly: true });
  console.log(JSON.stringify(result));
} finally { await db.terminate(); }
