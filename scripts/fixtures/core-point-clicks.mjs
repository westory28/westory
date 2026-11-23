import assert from "node:assert/strict";

export async function verifyCorePointClicks(page, origin, evidence) {
  await page.addInitScript(() => {
    const scenario = new URLSearchParams(location.search).get("corePointCase");
    const qa = {
      calls: [],
      bursts: 0,
      claimed: scenario === "paid",
      saved: scenario ? ["first", "second"] : [],
      rootReads: 0,
      unitReads: 0,
      failOverview: scenario === "restore",
      holdOverview: false,
      lesson: {
        unitId: "unit",
        title: "핵심포인트 검사",
        worksheetPageImages: [
          {
            page: 1,
            width: 800,
            height: 600,
            imageUrl:
              "data:image/svg+xml," +
              encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"/>',
              ),
          },
        ],
        worksheetExamHighlights: ["first", "second"].map((id, index) => ({
          id,
          page: 1,
          leftRatio: 0.2 + index * 0.2,
          topRatio: 0.2,
          widthRatio: 0.08,
          heightRatio: 0.04,
        })),
      },
      getProgress(ref) {
        if (ref.path.endsWith("/lesson_progress/portal-design-fixture")) {
          qa.rootReads++;
          const snapshot = () => ({
            exists: () => qa.claimed,
            data: () => ({ corePointRewardClaimed: qa.claimed }),
          });
          if (qa.holdOverview)
            return new Promise((resolve, reject) => {
              qa.finishOverview = (fail) =>
                fail
                  ? reject(Error("synthetic overview outage"))
                  : resolve(snapshot());
            });
          if (qa.failOverview) {
            qa.failOverview = false;
            throw Error("synthetic overview outage");
          }
          return snapshot();
        }
        if (ref.path.endsWith("/units/unit"))
          return {
            exists: () => true,
            data: () => ({ corePointFinds: qa.saved }),
          };
      },
      getUnits() {
        qa.unitReads++;
        return {
          docs: [{ id: "unit", data: () => ({ corePointFinds: qa.saved }) }],
        };
      },
      find: (_config, _unitId, id) =>
        request(id, (mode) => {
          qa.saved = [...new Set([...qa.saved, id])];
          return { result: { duplicate: mode === "duplicate" } };
        }),
      claim: () =>
        request("reward", (mode) => {
          if (mode === "blocked")
            return { awarded: false, duplicate: false, totalAwarded: 0 };
          qa.claimed = true;
          return mode === "duplicate"
            ? {
                awarded: false,
                duplicate: true,
                totalAwarded: 0,
                settled: true,
              }
            : {
                awarded: true,
                duplicate: false,
                totalAwarded: 500,
                settled: true,
              };
        }),
    };
    window.corePointQa = qa;
    function request(key, result) {
      qa.calls.push(key);
      return new Promise((resolve, reject) => {
        qa.finish = (mode) =>
          mode === "fail"
            ? reject(Error("synthetic outage"))
            : resolve(result(mode));
      });
    }
    new MutationObserver((entries) => {
      for (const entry of entries)
        for (const node of entry.addedNodes) {
          if (node.matches?.(".lesson-core-burst")) qa.bursts++;
        }
    }).observe(document, { subtree: true, childList: true });
  });
  await page.goto(
    `${origin}/?kind=learning&page=note#/student/lesson/note?id=unit`,
  );
  const points = page.locator("button[data-exam-highlight]");
  const first = points.nth(0),
    second = points.nth(1);
  const repeat = (button) =>
    button.evaluate((el) => {
      for (let i = 0; i < 30; i++) el.click();
    });
  const finish = (mode) =>
    page.evaluate((response) => window.corePointQa.finish(response), mode);
  const calls = () => page.evaluate(() => window.corePointQa.calls);
  const bursts = () => page.evaluate(() => window.corePointQa.bursts);

  await repeat(first);
  assert.equal(
    await bursts(),
    0,
    "rapid clicks must not animate before a find is confirmed",
  );
  assert(
    await first.isDisabled(),
    "the same highlight stays locked until the response",
  );
  assert(await second.isEnabled());
  assert.deepEqual(await calls(), ["first"]);
  await finish("fail");
  await page.waitForFunction(
    () => !document.querySelector("button[data-exam-highlight]").disabled,
  );
  await first.press("Enter");
  await repeat(first);
  await finish("success");
  await page.waitForFunction(() => window.corePointQa.bursts === 1);
  await repeat(first);
  assert.equal(await first.getAttribute("aria-pressed"), "true");
  await repeat(second);
  await finish("duplicate");
  const reward = page.getByRole("button", { name: /핵심포인트 완주 보상/ });
  await reward.waitFor();
  assert.equal(await bursts(), 1, "an already recorded find has no new burst");
  await repeat(reward);
  const pending = page.getByRole("button", { name: "핵심포인트 보상 반영 중" });
  assert(await pending.isDisabled());
  assert(
    !(await pending.evaluate((el) => el.classList.contains("is-claimable"))),
  );
  await finish("fail");
  await repeat(reward);
  const readsBeforeClaim = await page.evaluate(
    () => window.corePointQa.rootReads,
  );
  await page.evaluate(() => {
    window.corePointQa.failOverview = true;
  });
  await finish("blocked");
  await reward.waitFor();
  assert(await reward.isEnabled(), "an unconfirmed reward remains retryable");
  await repeat(reward);
  await finish("success");
  await pending.waitFor({ state: "detached" });
  assert.equal(await reward.count(), 0);
  assert.deepEqual(await calls(), [
    "first",
    "first",
    "second",
    "reward",
    "reward",
    "reward",
  ]);
  assert.equal(
    await page.evaluate(() => window.corePointQa.rootReads),
    readsBeforeClaim,
    "confirmed receipt avoids another whole-progress read",
  );

  await page.goto(
    `${origin}/?kind=learning&page=note&corePointCase=restore#/student/lesson/note?id=unit`,
  );
  const retry = page.getByRole("button", { name: "핵심포인트 다시 확인" });
  await retry.waitFor();
  assert.equal(
    await reward.count(),
    0,
    "failed totals must not imply eligibility",
  );
  assert.deepEqual(
    await calls(),
    [],
    "restoring completed points does not auto-claim",
  );
  const buttonLayout = await retry.evaluate((element) => {
    const rect = element.getBoundingClientRect(),
      style = getComputedStyle(element);
    return {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      visibility: style.visibility,
      display: style.display,
    };
  });
  assert(buttonLayout.width >= 44 && buttonLayout.height >= 44);
  assert(
    buttonLayout.left >= 0 && buttonLayout.right <= buttonLayout.viewportWidth,
  );
  assert(
    buttonLayout.top >= 0 && buttonLayout.bottom <= buttonLayout.viewportHeight,
  );
  assert.equal(buttonLayout.visibility, "visible");
  assert.notEqual(buttonLayout.display, "none");
  await page.screenshot({
    path: `${evidence}/core-points-retry-${page.viewportSize().width}.png`,
  });
  const initialReads = await page.evaluate(() => window.corePointQa.rootReads);
  await page.evaluate(() => {
    window.corePointQa.holdOverview = true;
  });
  await repeat(retry);
  assert(await retry.isDisabled());
  assert.equal(
    await page.evaluate(() => window.corePointQa.rootReads),
    initialReads + 1,
    "30 retry clicks issue only one overview request",
  );
  await page.evaluate(() => window.corePointQa.finishOverview(true));
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="핵심포인트 다시 확인"]').disabled,
  );
  await repeat(retry);
  await page.evaluate(() => window.corePointQa.finishOverview(false));
  await reward.waitFor();
  assert.deepEqual(await calls(), []);
  const recoveredReads = await page.evaluate(
    () => window.corePointQa.rootReads,
  );
  await repeat(reward);
  await finish("duplicate");
  await pending.waitFor({ state: "detached" });
  assert.equal(await reward.count(), 0);
  assert.deepEqual(await calls(), ["reward"]);
  assert.equal(
    await page.evaluate(() => window.corePointQa.rootReads),
    recoveredReads,
  );

  await page.goto(
    `${origin}/?kind=learning&page=note&corePointCase=paid#/student/lesson/note?id=unit`,
  );
  await points.first().waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-exam-highlight]")
        ?.getAttribute("aria-pressed") === "true",
  );
  assert.equal(
    await reward.count(),
    0,
    "a previously paid completion stays settled",
  );
  assert.equal(await retry.count(), 0);
  assert.deepEqual(await calls(), []);
}
