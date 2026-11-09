// Public presentation fields only; correctness stays in the existing grading snapshot.
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const signature = set => JSON.stringify([set.instruction || "", set.passage || "", set.image || ""]);
// Legacy blanks retained their sizing text in the stored source. Public data
// needs only the existing 4..14ch width, never that hidden text itself.
const redactLegacyBlankText = value => typeof value === "string"
  ? value.replace(/\{\{blank:([\s\S]*?)\}\}/g, (_token, text) =>
    `{{blank:${"_".repeat(Math.min(Math.max(text.length, 4), 14))}}}`)
  : value;
const normalizeMockExamMaterials = (question, fail) => {
  if (question.examplePassage !== undefined && question.examplePassage !== null
    && (typeof question.examplePassage !== "string" || question.examplePassage.length > 20_000))
    fail("invalid-argument", "보기는 20,000자 이내로 입력해 주세요.", "ASSESSMENT_PAPER_MATERIAL_INVALID");
  const value = question.passageSet;
  if (value === undefined || value === null) return;
  if (question.category !== "exam_prep" || !question.examRound || !object(value)
    || Object.keys(value).some(key => !["id", "instruction", "passage", "image"].includes(key))
    || typeof value.id !== "string" || !/^[\w-]{1,160}$/.test(value.id)
    || typeof value.instruction !== "string" || value.instruction.length > 300
    || typeof value.passage !== "string" || value.passage.length > 40_000
    || (!value.passage.trim() && !value.image)
    || (value.image != null && (typeof value.image !== "string" || !/^(https:\/\/\S+|data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+)$/.test(value.image))))
    fail("invalid-argument", "공통 지문·세트 발문·자료 이미지를 확인해 주세요.", "ASSESSMENT_PAPER_MATERIAL_INVALID");
  question.passageSet = { id: value.id, instruction: value.instruction, passage: value.passage, image: value.image || null };
};

const validateMockExamSets = (questions, fail) => {
  const groups = new Map();
  for (const question of questions) {
    normalizeMockExamMaterials(question, fail);
    if (!question.passageSet) continue;
    const key = `${question.examRound}\n${question.passageSet.id}`;
    groups.set(key, [...(groups.get(key) || []), question]);
  }
  for (const group of groups.values()) {
    if (new Set(group.map(question => signature(question.passageSet))).size !== 1)
      fail("failed-precondition", "같은 세트의 공통 지문은 동일해야 합니다. 기존 지문을 연결하거나 새 세트로 분리해 주세요.", "ASSESSMENT_PAPER_SET_CONFLICT");
    const orders = group.map(question => question.paperOrder).sort((a, b) => a - b);
    if (orders.some((order, index) => !Number.isInteger(order) || (index && order !== orders[index - 1] + 1)))
      fail("failed-precondition", "세트 문항의 번호는 연속되게 지정해 주세요.", "ASSESSMENT_PAPER_SET_ORDER_INVALID");
  }
};

const buildPreparedAssets = (source) => {
  const images = new Set(), visible = [];
  for (const document of source.quizDocuments || []) {
    const question = document.data || {};
    for (const image of [question.image, question.passageSet?.image, ...(question.choiceOptionImages || [])])
      if (typeof image === "string" && image) images.add(image);
    for (const value of [question.question, question.passage, question.examplePassage,
      question.passageSet?.instruction, question.passageSet?.passage, ...(question.options || [])])
      if (typeof value === "string") visible.push(redactLegacyBlankText(value));
  }
  return { sourceHash: source.sourceHash, imageUrls: [...images],
    // Unordered unique glyphs load font subsets without releasing stems/options.
    fontCharacters: [...new Set(visible.join(""))].sort().join("") };
};

module.exports = { normalizeMockExamMaterials, validateMockExamSets, mockExamSetSignature: signature, buildPreparedAssets, redactLegacyBlankText };
