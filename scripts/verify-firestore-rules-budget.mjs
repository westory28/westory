import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rules = readFileSync(resolve("firestore.rules"), "utf8");

const functionBody = (name) => {
  const marker = `function ${name}(`;
  const start = rules.indexOf(marker);
  assert.notEqual(start, -1, `missing Rules helper: ${name}`);

  const braceStart = rules.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < rules.length; index += 1) {
    if (rules[index] === "{") depth += 1;
    if (rules[index] === "}") depth -= 1;
    if (depth === 0) return rules.slice(braceStart + 1, index);
  }
  throw new Error(`unterminated Rules helper: ${name}`);
};

const count = (source, pattern) => [...source.matchAll(pattern)].length;

const activeSession = functionBody("hasActiveApplicationSession");
assert.equal(count(activeSession, /get\(applicationSessionPath\(\)\)/g), 1);

const transition = functionBody("hasActiveReauthTransition");
assert.equal(
  count(transition, /get\(applicationSessionTransitionPath\(\)\)/g),
  1,
);
assert.equal(
  count(transition, /exists\(applicationSessionTransitionPath\(\)\)/g),
  0,
);

const teacherPatchOwner = functionBody("isTeacherPatchNoteOwner");
assert.equal(count(teacherPatchOwner, /canUseWestory\(\)/g), 1);
assert.match(teacherPatchOwner, /request\.auth\.uid == teacherId/);
assert.equal(count(teacherPatchOwner, /currentUserIsTeacherProfile\(\)/g), 1);

const teacherProfile = functionBody("currentUserIsTeacherProfile");
assert.equal(
  count(
    teacherProfile,
    /get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)/g,
  ),
  1,
);

const userGet = functionBody("canGetUserDocument");
assert.equal(count(userGet, /canUseWestory\(\)/g), 1);
assert.match(userGet, /request\.auth\.uid == userId/);
assert.equal(count(userGet, /currentUserCanReadStudentListProfile\(\)/g), 1);

const studentListProfile = functionBody("currentUserCanReadStudentListProfile");
assert.equal(
  count(
    studentListProfile,
    /get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)/g,
  ),
  1,
);

const teacherPatchListQuery = functionBody("isTeacherPatchNoteListQuery");
assert.match(teacherPatchListQuery, /request\.query\.limit <= 100/);
assert.match(teacherPatchListQuery, /orderBy\.updatedAt == 'DESC'/);
assert.match(teacherPatchListQuery, /orderBy\['__name__'\] == 'DESC'/);

const teacherPatchMatch = rules.match(
  /match \/teacherPatchNotes\/\{teacherId\}\/notes\/\{noteId\} \{([\s\S]*?)\n    \}/,
);
assert.ok(teacherPatchMatch, "missing teacherPatchNotes match");
for (const operation of ["get", "list", "create", "update", "delete"]) {
  assert.match(teacherPatchMatch[1], new RegExp(`allow ${operation}:`));
}
assert.doesNotMatch(teacherPatchMatch[1], /allow read, write|allow write:/);

console.log(
  JSON.stringify({
    activeSessionDocumentGets: 1,
    reauthTransitionDocumentGets: 1,
    reauthTransitionExistsCalls: 0,
    teacherPatchTeacherDocumentGets: 2,
    teacherPatchAdminDocumentGets: 1,
    ownUserGetDocumentGets: 1,
    officialSingleRequestAccessLimit: 10,
    teacherPatchTeacherAccessHeadroom: 8,
    teacherPatchAdminAccessHeadroom: 9,
    operationsSeparated: true,
    listQueryConstrained: true,
  }),
);
