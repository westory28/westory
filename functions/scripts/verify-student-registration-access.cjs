const assert = require("node:assert/strict");
const { assertStudentRegistrationAccess } = require("../studentRegistrationAccess");
const { createStudentMaintenanceService, withStudentMaintenanceGuard } = require("../studentMaintenance");

async function main() {
  let checks = 0;
  for (const status of ["PENDING", "APPROVED_PENDING_ACCOUNT", "", null, false, "approved"]) {
    assert.throws(() => assertStudentRegistrationAccess({ role: "student", registrationApprovalStatus: status }, true),
      error => error.details?.reason === "STUDENT_REGISTRATION_APPROVAL_REQUIRED"); checks++;
  }
  assert.throws(() => assertStudentRegistrationAccess(undefined, false)); checks++;
  assert.throws(() => assertStudentRegistrationAccess({ role: "admin" }, true)); checks++;
  for (const role of ["student", "teacher", "staff"]) for (const state of [{}, { registrationApprovalStatus: "APPROVED" }]) {
    assert.doesNotThrow(() => assertStudentRegistrationAccess({ role, ...state }, true)); checks++;
  }
  let profile = { role: "student", registrationApprovalStatus: "PENDING" }, calls = 0;
  const service = createStudentMaintenanceService({ db: { doc: path => ({ get: async () => path.startsWith("users/")
    ? { exists: true, data: () => profile } : { exists: false } }) } });
  const request = { auth: { uid: "synthetic-student", token: { email: "student@yongshin-ms.ms.kr" } } };
  const business = withStudentMaintenanceGuard(async () => ++calls, { service });
  await assert.rejects(business(request), error => error.details?.reason === "STUDENT_REGISTRATION_APPROVAL_REQUIRED");
  assert.equal(calls, 0); checks += 2;
  const bootstrap = withStudentMaintenanceGuard(async () => "session-only", { service, registrationBootstrap: true });
  assert.equal(await bootstrap(request), "session-only"); checks++;
  profile = { role: "student", registrationApprovalStatus: "APPROVED" };
  assert.equal(await business(request), 1); checks++;
  profile = { role: "student" };
  assert.equal(await business(request), 2); checks++;
  console.log(JSON.stringify({ passed: true, checks, network: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
