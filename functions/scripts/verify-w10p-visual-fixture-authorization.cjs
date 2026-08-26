const assert = require("node:assert/strict");

const {
  GET_SEMESTER_CORE_STATE_COMMAND_TYPE,
  W10P_VISUAL_FIXTURE_ADMIN_CONTRACT,
  isTrustedW10PVisualFixtureAdmin,
} = require("../commandGateway");

const contract = W10P_VISUAL_FIXTURE_ADMIN_CONTRACT;
const validInput = {
  projectId: contract.projectId,
  commandType: GET_SEMESTER_CORE_STATE_COMMAND_TYPE,
  request: {
    auth: {
      uid: contract.uid,
      token: {
        email: contract.email,
        email_verified: true,
        firebase: { sign_in_provider: "password" },
        fixtureOwner: contract.fixtureOwner,
        fixtureId: contract.fixtureId,
        fixtureRole: contract.fixtureRole,
      },
    },
  },
  identity: { uid: contract.uid, email: contract.email },
  profile: {
    uid: contract.uid,
    email: contract.email,
    role: "teacher",
    teacherPortalEnabled: true,
    staffPermissions: [],
    fixtureOwner: contract.fixtureOwner,
    fixtureId: contract.fixtureId,
  },
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const rejectCases = [
  ["production-project", (input) => (input.projectId = "history-quiz-yongsin")],
  ["different-command", (input) => (input.commandType = "activateSemester")],
  ["request-uid", (input) => (input.request.auth.uid = "another-admin")],
  ["identity-uid", (input) => (input.identity.uid = "another-admin")],
  [
    "token-email",
    (input) =>
      (input.request.auth.token.email = "another-admin@yongshin-ms.ms.kr"),
  ],
  [
    "identity-email",
    (input) => (input.identity.email = "another-admin@yongshin-ms.ms.kr"),
  ],
  [
    "email-unverified",
    (input) => (input.request.auth.token.email_verified = false),
  ],
  [
    "non-password-provider",
    (input) => (input.request.auth.token.firebase.sign_in_provider = "custom"),
  ],
  [
    "token-owner",
    (input) => (input.request.auth.token.fixtureOwner = "another-owner"),
  ],
  [
    "token-fixture",
    (input) => (input.request.auth.token.fixtureId = "another-fixture"),
  ],
  ["token-role", (input) => (input.request.auth.token.fixtureRole = "teacher")],
  ["profile-uid", (input) => (input.profile.uid = "another-admin")],
  [
    "profile-email",
    (input) => (input.profile.email = "another-admin@yongshin-ms.ms.kr"),
  ],
  ["profile-role", (input) => (input.profile.role = "admin")],
  [
    "profile-portal-disabled",
    (input) => (input.profile.teacherPortalEnabled = false),
  ],
  [
    "profile-permission-present",
    (input) => input.profile.staffPermissions.push("lesson_read"),
  ],
  ["profile-owner", (input) => (input.profile.fixtureOwner = "another-owner")],
  ["profile-fixture", (input) => (input.profile.fixtureId = "another-fixture")],
  ["profile-missing", (input) => (input.profile = null)],
];

assert.equal(Object.isFrozen(contract), true);
assert.equal(isTrustedW10PVisualFixtureAdmin(validInput), true);
for (const [label, mutate] of rejectCases) {
  const input = clone(validInput);
  mutate(input);
  assert.equal(
    isTrustedW10PVisualFixtureAdmin(input),
    false,
    `${label} must be rejected`,
  );
}

console.log(
  JSON.stringify({
    suite: "w10p-visual-fixture-authorization",
    passed: true,
    positiveCases: 1,
    negativeCases: rejectCases.length,
    projectScope: contract.projectId,
    commandScope: GET_SEMESTER_CORE_STATE_COMMAND_TYPE,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
