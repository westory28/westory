import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Exercise the exact prepared source against synthetic memory fixtures, never production data.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const audit = path.resolve(
  root,
  process.argv[2] || "output/avatar-shop-20261114/release-audit",
);
const readJson = async (file) =>
  JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const require = createRequire(import.meta.url);
const fixture = require("../functions/scripts/verify-student-avatar.cjs");
const plans = await readJson(path.join(audit, "prepared-release.json"));
const summaries = [];
for (const plan of plans) {
  const directory = path.join(plan.directory, "functions");
  const manifest = await readJson(
    path.join(plan.directory, "release-manifest.json"),
  );
  const changes = new Map(
    manifest.changes.map((file) => [file.path, file.after]),
  );
  for (const file of manifest.baselineFiles) {
    assert.equal(
      sha(await fs.readFile(path.join(directory, file.path))),
      changes.get(file.path) || file.sha256,
      `Prepared source drift: ${plan.group}/${file.path}`,
    );
  }
  for (const file of manifest.changes) {
    assert.equal(sha(await fs.readFile(path.join(directory, file.path))), file.after,
      `Prepared changed source drift: ${file.path}`);
    if (plan.mode !== "cleanup") assert.equal(
      sha(await fs.readFile(path.join(root, "functions", file.path))),
      file.after,
      `Working patch changed after preparation: ${file.path}`,
    );
  }
  if (["event", "cleanup"].includes(plan.mode)) {
    summaries.push({ group: plan.group, verifiedFiles: manifest.baselineFiles.length + manifest.changes.filter(file => file.before === null).length,
      eventOrCleanupFunctionalVerification: "verify-avatar-event-release.mjs and prepared-source emulator" });
    continue;
  }
  const catalog = require(path.join(directory, "studentAvatarCatalog.js"));
  let combinations = 0;
  for (const item of catalog.catalog.items) {
    for (const character of item.characters) {
      const look = {
        ...catalog.defaultLook(character),
        [item.slot]: item.value,
      };
      assert.ok(
        catalog.validateLook(
          look,
          catalog.catalog.items.map((entry) => entry.id),
        ),
        `${plan.group}:${item.id}:${character}`,
      );
      assert.ok(
        catalog.sanitizePublicAvatar({
          schemaVersion: 1,
          catalogVersion: catalog.catalog.version,
          revision: 1,
          look,
          lookHash: catalog.lookHash(look),
        }),
        `Public projection dropped ${item.id}:${character}`,
      );
      combinations++;
    }
  }
  let settingsReads = 0,
    settingsWrites = 0,
    avatarSaved = false,
    genderGuardVerified = false;
  if (plan.mode !== "projection") {
    const pricingModule = require(
      path.join(directory, "avatarCatalogPricing.js"),
    );
    const state = fixture.fixture();
    const teacherUid = "avatar-bundle-teacher";
    state.documents.set(`users/${teacherUid}`, { role: "teacher" });
    const assertSession = async (request) => ({ uid: request.auth.uid });
    const pricing = pricingModule.createAvatarCatalogPricingHandlers({
      db: state.db,
      assertSession,
      now: () => 100000,
    });
    const teacher = (data) => ({
      auth: { uid: teacherUid },
      data: { _session: {}, ...data },
    });
    const original = require(
      path.join(audit, "originals", plan.targets[0], "avatarCatalog.json"),
    );
    const item = catalog.catalog.items.find(
      (entry) => !original.items.some((old) => old.id === entry.id),
    );
    assert.ok(item, "The prepared bundle must contain the new catalog items");
    const metadata = {
      label: "새 상품 검증",
      gender: "unisex",
      description: "합성 데이터",
    };
    const input = {
      expectedRevision: 0,
      prices: { [item.id]: 81 },
      metadata: { [item.id]: metadata },
    };
    await assert.rejects(
      pricing.updateAvatarCatalogPricing(fixture.req(input)),
      (error) => error.details?.reason === "AVATAR_TEACHER_REQUIRED",
    );
    const readStart = state.reads.length;
    const saved = await pricing.updateAvatarCatalogPricing(teacher(input));
    settingsReads = state.reads
      .slice(readStart)
      .filter((entry) => entry === pricingModule.PRICING_PATH).length;
    settingsWrites = state.writes.length;
    assert.equal(settingsReads, 1);
    assert.equal(settingsWrites, 1);
    assert.deepEqual(saved.metadata[item.id], metadata);
    assert.equal(saved.prices[item.id], 81);
    await pricing.updateAvatarCatalogPricing(teacher(input));
    assert.equal(
      state.writes.length,
      1,
      "Identical retry must not write again",
    );
    if (plan.mode === "avatar") {
      const { createStudentAvatarHandlers } = require(
        path.join(directory, "studentAvatar.js"),
      );
      const api = createStudentAvatarHandlers({
        db: state.db,
        bucket: state.bucket,
        assertSession,
        now: () => 100000,
      });
      const initial = await api.getAvatarStudioState(
        fixture.req({ year: "2026", semester: "2" }),
      );
      assert.deepEqual(initial.pricing.metadata[item.id], metadata);
      const purchase = await api.purchaseStudentAvatarItem(
        fixture.req({
          year: "2026",
          semester: "2",
          itemId: item.id,
          expectedPrice: 81,
          expectedPricingRevision: saved.revision,
          expectedPricingPolicyVersion: catalog.catalog.pricingPolicyVersion,
          requestId: "bundle-purchase-new-item",
        }),
      );
      assert.equal(purchase.charged, 81);
      assert.equal(purchase.wallet.balance, 919);
      assert.equal(
        state.documents.get(`semester_wis_ledger/${purchase.ledgerEntryId}`)
          .reason,
        `아바타 구매: ${metadata.label}`,
      );
      const look = { ...catalog.defaultLook(), [item.slot]: item.value };
      const avatar = await api.saveStudentAvatar(
        await fixture.save({
          look,
          expectedRevision: purchase.avatar.revision,
        }),
      );
      assert.deepEqual(avatar.look, look);
      assert.ok(avatar.ownedItemIds.includes(item.id));
      avatarSaved = true;
      if (["polish", "event"].includes(manifest.patchKind)) {
        const opposite = avatar.look.character === "girl" ? "boy" : "girl";
        const updatedPricing = await pricing.updateAvatarCatalogPricing(
          teacher({
            expectedRevision: saved.revision,
            prices: {},
            metadata: { [item.id]: { ...metadata, gender: opposite } },
          }),
        );
        const beforeWrites = state.writes.length;
        const beforeImages = state.bucket.objects.size;
        const input = await fixture.save({
          look,
          expectedRevision: avatar.revision,
          requestId: "bundle-gender-save",
        });
        await assert.rejects(
          api.saveStudentAvatar(input),
          (error) =>
            error.details?.reason === "AVATAR_GENDER_MISMATCH" &&
            error.details.pricing.revision === updatedPricing.revision,
        );
        assert.deepEqual(
          (await api.getStudentAvatar(fixture.req({}))).look,
          avatar.look,
        );
        const teacherApi = createStudentAvatarHandlers({
          db: state.db,
          bucket: state.bucket,
          assertSession,
          audience: "teacher",
          now: () => 100000,
          loadPolicy: async () => ({}),
        });
        await assert.rejects(
          teacherApi.saveStudentAvatar(
            teacher({ ...input.data, expectedRevision: 0 }),
          ),
          (error) => error.details?.reason === "AVATAR_GENDER_MISMATCH",
        );
        const teacherPage = await teacherApi.getTeacherMyPage(
          teacher({ year: "2026", semester: "2" }),
        );
        assert.equal(teacherPage.pricing.metadata[item.id].gender, opposite);
        assert.equal(state.writes.length, beforeWrites);
        assert.equal(state.bucket.objects.size, beforeImages);
        genderGuardVerified = true;
      }
    }
  }
  summaries.push({
    group: plan.group,
    verifiedFiles: manifest.baselineFiles.length,
    supportedCombinations: combinations,
    settingsReadsPerSave: settingsReads,
    settingsWritesPerSave: settingsWrites,
    savedNewItemWithMetadata: avatarSaved,
    genderGuardVerified,
  });
}
await fs.writeFile(
  path.join(audit, "prepared-verification.json"),
  JSON.stringify({ passed: true, summaries }, null, 2) + "\n",
);
console.log(JSON.stringify({ passed: true, summaries }, null, 2));
