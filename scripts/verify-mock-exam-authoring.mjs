import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/pages/teacher/components/mockExamAuthoring.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { parseMockExamFile, createMockExamFile, sortMockExamChoices, validateMockExamPlacement } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const question = {
  id: 1001, type: 'choice', examRound: 'round_1', paperOrder: 1, points: 3.5,
  question: '다음 설명으로 옳은 것은?', passage: '{{box:(가)}} 제시 자료',
  options: ['긴 선지입니다', '나', '가', '두 글자', '마지막으로 가장 긴 선지입니다'], answer: '나',
  choiceOptionImages: [null, 'data:image/png;base64,aA==', null, null, null],
  concepts: ['왕권 강화'], cognitiveProcess: '사료 해석', familyId: 'family-1', derivedFromQuestionId: 'previous-1', reviewLessonId: 'lesson-1', misconceptionTags: { '가': '혼동 지점' },
};
const file = (questions) => JSON.stringify({ version: 1, questions });
const [parsed] = parseMockExamFile(file([question]));
assert.deepEqual(parsed.options, ['가', '나', '두 글자', '긴 선지입니다', '마지막으로 가장 긴 선지입니다']);
assert.equal(parsed.answer, '나');
assert.equal(parsed.choiceOptionImages[1], question.choiceOptionImages[1]);
assert.equal(parsed.points, 3.5);
assert.equal(parsed.unitId, 'exam_prep');
assert.deepEqual(parseMockExamFile(createMockExamFile([parsed]))[0], parsed, 'export/import preserves authoring and learning metadata');
assert.deepEqual(sortMockExamChoices([{text:'가', index:1}, {text:'나', index:2}]).map(q=>q.index), [1,2]);
assert.equal(validateMockExamPlacement({examRound:'round_1',paperOrder:1,points:0}), '배점은 0보다 크고 100 이하인 수로 입력해 주세요.');
for (const change of [
  { id: true }, { id: -1 }, { paperOrder: 0 }, { paperOrder: 1.5 }, { paperOrder: true },
  { points: 0 }, { points: 101 }, { points: '4' }, { points: 3.333 }, { examRound:'other_1' }, { examRound:'round_4' },
  { question: '' }, { answer:'없는 정답' }, { options: ['가','가','다','라','마'] },
  { options: ['가','나'] }, { type:'essay' }, { paperBreakBefore:1 },
  { choiceOptionImages:['data:image/svg+xml;base64,aA==',null,null,null,null] },
  { image:'http://external.invalid/image.jpg' }, { image: 'data:image/png;base64,'+'a'.repeat(100000) },
  { cognitiveProcess:'가'.repeat(61) }, { misconceptionTags:{'없는 선지':'오개념'} },
]) assert.throws(() => parseMockExamFile(file([{...question,...change}])), JSON.stringify(change));
assert.throws(() => parseMockExamFile(file([question,question])), /고유한/);
assert.throws(() => parseMockExamFile(file([question,{...question,id:1002}])), /문항 번호가 중복/);
assert.throws(() => parseMockExamFile(file(Array.from({length:201},()=>question))), /1~200/);
assert.throws(() => parseMockExamFile(file([{...question,type:'word',answer:'가'.repeat(21),options:[],choiceOptionImages:[]}])), /20자/);
const word = parseMockExamFile(file([{...question,type:'word',answer:'첨성대',options:[],choiceOptionImages:[],misconceptionTags:{},paperBreakBefore:true}]))[0];
assert.equal(word.paperBreakBefore,true);
assert.equal(word.answer,'첨성대');
console.log('Mock exam authoring: validated 5-option ordering, answer/image identity, decimal points, metadata round trip and malformed imports.');
