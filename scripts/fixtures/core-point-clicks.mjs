import assert from "node:assert/strict";

export async function verifyCorePointClicks(page, origin) {
  await page.addInitScript(() => {
    const qa = {
      calls: [],
      bursts: 0,
      claimed: false,
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
        if (
          qa.claimed &&
          ref.path.endsWith("/lesson_progress/portal-design-fixture")
        ) {
          return {
            exists: () => true,
            data: () => ({ corePointRewardClaimed: true }),
          };
        }
      },
      find: (_config, _unitId, id) =>
        request(id, (duplicate) => ({ result: { duplicate } })),
      claim: () =>
        request("reward", () => {
          qa.claimed = true;
          return { awarded: true, totalAwarded: 500 };
        }),
    };
    window.corePointQa = qa;
    function request(key, result) {
      qa.calls.push(key);
      return new Promise((resolve, reject) => {
        qa.finish = (mode) =>
          mode === "fail"
            ? reject(Error("synthetic outage"))
            : resolve(result(mode === "duplicate"));
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
  await finish("success");
  await pending.waitFor({ state: "detached" });
  assert.equal(await reward.count(), 0);
  assert.deepEqual(await calls(), [
    "first",
    "first",
    "second",
    "reward",
    "reward",
  ]);
}
