const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { createWisStockReportAccess, scopeFor, weekRange } = require('./wisStockReportAccess');

const PART_BYTES = 512 * 1024;
const MAX_BYTES = 6 * PART_BYTES;
const PAGE_SIZE = 12;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = message => { throw new HttpsError('invalid-argument', message); };

function uploadedFile(input) {
  const { fileName, contentBase64 } = input;
  if (typeof fileName !== 'string' || fileName.length > 160 || /[\\/\x00-\x1f\x7f]/.test(fileName))
    invalid('보고서 파일 이름을 확인해 주세요.');
  const format = /\.(pdf|md|txt)$/i.exec(fileName)?.[1].toLowerCase();
  if (!format) invalid('PDF, Markdown 또는 텍스트 파일을 선택해 주세요.');
  if (typeof contentBase64 !== 'string' || !contentBase64.length || contentBase64.length > 4 * Math.ceil(MAX_BYTES / 3))
    invalid('3MB 이하의 보고서 파일을 선택해 주세요.');
  const bytes = Buffer.from(contentBase64, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== contentBase64)
    invalid('보고서 파일을 읽을 수 없습니다.');
  if (format === 'pdf') {
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || !bytes.subarray(-4096).includes('%%EOF'))
      invalid('PDF 형식을 확인해 주세요.');
  } else {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { invalid('텍스트 파일을 UTF-8 형식으로 저장해 주세요.'); }
    if (!text.trim() || text.includes('\u0000')) invalid('보고서 본문을 확인해 주세요.');
  }
  return { bytes, format, hash: digest(bytes) };
}

function summary(data) {
  const { weekStart, title, revision, publishedAtMs, fileName, format, byteLength } = data;
  return { weekStart, title, revision, publishedAtMs, fileName, format, byteLength };
}

function createWisStockWeeklyReport({ db, assertSession, now = Date.now }) {
  const { actorFor, assertAccess } = createWisStockReportAccess({ db, assertSession });
  return async request => {
    const input = request.data;
    const action = input?.action;
    if (!['read', 'list', 'publish'].includes(action)) invalid('보고서 작업을 확인해 주세요.');
    const uid = await actorFor(request, action === 'publish');
    const scope = scopeFor(input);
    const collection = db.collection(`years/${scope.year}/semesters/${scope.semester}/wis_stock_weekly_reports`);

    if (action === 'list') {
      if (input.before !== undefined) weekRange(input.before);
      return db.runTransaction(async tx => {
        await assertAccess(tx, uid, scope);
        let query = collection.orderBy('weekStart', 'desc');
        if (input.before) query = query.startAfter(input.before);
        const page = await tx.get(query.limit(PAGE_SIZE + 1));
        const reports = page.docs.slice(0, PAGE_SIZE).map(doc => summary(doc.data()));
        return { reports, nextBefore: page.size > PAGE_SIZE ? reports.at(-1).weekStart : null };
      }, { readOnly: true });
    }

    const { weekStart } = weekRange(input.weekStart);
    const ref = collection.doc(weekStart);
    const part = index => ref.collection('parts').doc(String(index));
    if (action === 'read') return db.runTransaction(async tx => {
      await assertAccess(tx, uid, scope);
      const report = (await tx.get(ref)).data();
      if (!report) return { report: null };
      if (!Number.isInteger(report.partCount) || report.partCount < 1 || report.partCount > 6)
        throw new HttpsError('data-loss', '보고서 저장 정보를 확인해 주세요.');
      const docs = await tx.getAll(...Array.from({ length: report.partCount }, (_, index) => part(index)));
      const parts = docs.map(doc => doc.data()?.bytes);
      if (!parts.every(Buffer.isBuffer)) throw new HttpsError('data-loss', '보고서 파일 일부를 찾을 수 없습니다.');
      const bytes = Buffer.concat(parts);
      if (bytes.length !== report.byteLength || digest(bytes) !== report.hash)
        throw new HttpsError('data-loss', '보고서 파일을 확인해 주세요.');
      return { report: { ...summary(report), contentBase64: bytes.toString('base64') } };
    }, { readOnly: true });

    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > 100 || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
      invalid('보고서 제목과 발행본을 확인해 주세요.');
    return db.runTransaction(async tx => {
      await assertAccess(tx, uid, scope);
      const old = (await tx.get(ref)).data();
      const { bytes, format, hash } = uploadedFile(input);
      if (old?.hash === hash && old.title === title && old.fileName === input.fileName)
        return { report: summary(old) };
      if ((old?.revision ?? 0) !== input.expectedRevision)
        throw new HttpsError('aborted', '다른 교사가 이 주차의 보고서를 변경했습니다. 최신 발행본을 확인해 주세요.');
      const partCount = Math.ceil(bytes.length / PART_BYTES);
      const report = { weekStart, title, fileName: input.fileName, format, byteLength: bytes.length, hash, partCount,
        revision: input.expectedRevision + 1, publishedAtMs: now(), publishedBy: uid };
      if (old?.hash !== hash) {
        for (let i = 0; i < partCount; i++) tx.set(part(i), { bytes: bytes.subarray(i * PART_BYTES, (i + 1) * PART_BYTES) });
        for (let i = partCount; i < (old?.partCount ?? 0); i++) tx.delete(part(i));
      }
      tx.set(ref, report);
      return { report: summary(report) };
    });
  };
}

module.exports = { createWisStockWeeklyReport };
