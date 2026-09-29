/** Real-browser regression checks for numeric editing; no application services. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    process.env.PLAYWRIGHT_MODULE_PATH ||
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
      ),
  );
}
const output = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-numeric-browser-"),
);
const component = JSON.stringify(
  path
    .join(root, "src/components/common/NumericInput.tsx")
    .replaceAll("\\", "/"),
);
const harness = `
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import NumericInput from ${component};
function Fixture() {
  const [number, setNumber] = useState(35);
  const [clamped, setClamped] = useState(20);
  const [decimal, setDecimal] = useState(2.5);
  const [optional, setOptional] = useState("12");
  const [disabled, setDisabled] = useState(false);
  const [saved, setSaved] = useState("");
  const input = useRef(null);
  window.numericQa = { reset: () => setNumber(73), disable: () => setDisabled(true), focus: () => input.current.focus() };
  return <main><form onSubmit={event => { event.preventDefault(); setSaved(String(number)); }}>
    <label>Number<NumericInput aria-label="Number" ref={input} value={number} disabled={disabled} onChange={event => setNumber(Number(event.target.value))} /></label>
    <button type="submit">Save</button><output data-testid="saved">{saved}</output>
  </form>
  <label>Clamp<NumericInput aria-label="Clamp" min={5} max={100} value={clamped} onChange={event => setClamped(Math.max(5, Math.min(100, Number(event.target.value))))} /></label>
  <label>Decimal<NumericInput aria-label="Decimal" step="any" value={decimal} onChange={event => setDecimal(Number(event.target.value))} /></label>
  <label>Optional<NumericInput aria-label="Optional" allowEmpty value={optional} onChange={event => setOptional(event.target.value)} /></label>
  <output data-testid="state">{JSON.stringify({number, clamped, decimal, optional})}</output>
  <button type="button">Outside</button></main>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
`;
const result = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
await fs.writeFile(path.join(output, "fixture.js"), result.outputFiles[0].text);
const html =
  '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;font:16px sans-serif}main{max-width:500px}label{display:block;margin:12px 0}input{display:block;width:140px;max-width:100%;padding:8px}output{display:block;overflow-wrap:anywhere}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer(async (request, response) => {
  if (request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(await fs.readFile(path.join(output, "fixture.js")));
  } else {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin);
    const number = page.getByRole("spinbutton", {
      name: "Number",
      exact: true,
    });
    const state = async () =>
      JSON.parse(await page.getByTestId("state").textContent());
    const outside = () => page.getByRole("button", { name: "Outside" }).click();
    await page.evaluate(() => window.numericQa.focus());
    assert.equal(
      await number.evaluate((element) => element === document.activeElement),
      true,
      "Forwarded ref must expose the input",
    );
    await number.fill("");
    assert.equal(
      await number.inputValue(),
      "",
      "Clearing must remain editable",
    );
    assert.equal(
      (await state()).number,
      35,
      "Incomplete input must not overwrite valid state",
    );
    await number.pressSequentially("90");
    assert.equal(await number.inputValue(), "90");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    assert.equal(await page.getByTestId("saved").textContent(), "90");
    await number.fill("0");
    await number.press("Enter");
    assert.equal(
      await page.getByTestId("saved").textContent(),
      "0",
      "Enter must submit latest zero",
    );
    await number.fill("");
    await outside();
    assert.equal(
      await number.inputValue(),
      "0",
      "Required numeric blank must restore prior value on blur",
    );
    const clamp = page.getByRole("spinbutton", { name: "Clamp", exact: true });
    await clamp.fill("");
    await clamp.pressSequentially("1");
    assert.equal(
      await clamp.inputValue(),
      "1",
      "Parent minimum must not overwrite current digit",
    );
    await clamp.pressSequentially("0");
    assert.equal(await clamp.inputValue(), "10");
    assert.equal((await state()).clamped, 10);
    await clamp.fill("2");
    await outside();
    assert.equal(
      await clamp.inputValue(),
      "5",
      "Blur must display validated parent clamp",
    );
    const decimal = page.getByRole("spinbutton", {
      name: "Decimal",
      exact: true,
    });
    await decimal.fill("");
    await decimal.pressSequentially("-12.5");
    assert.equal((await state()).decimal, -12.5);
    await outside();
    assert.equal(await decimal.inputValue(), "-12.5");
    await decimal.fill("");
    await decimal.pressSequentially("-");
    assert.equal(
      (await state()).decimal,
      -12.5,
      "Incomplete sign must not publish zero or NaN",
    );
    await outside();
    assert.equal(await decimal.inputValue(), "-12.5");
    const optional = page.getByRole("spinbutton", {
      name: "Optional",
      exact: true,
    });
    await optional.fill("");
    await outside();
    assert.equal(await optional.inputValue(), "");
    assert.equal(
      (await state()).optional,
      "",
      "Optional score removal must reach parent",
    );
    await optional.fill("0");
    await outside();
    assert.equal(await optional.inputValue(), "0");
    assert.equal(
      (await state()).optional,
      "0",
      "String zero must remain distinguishable from blank",
    );
    await number.fill("");
    await page.evaluate(() => window.numericQa.reset());
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Number"]').value === "73",
    );
    await number.fill("");
    await page.evaluate(() => window.numericQa.disable());
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Number"]').disabled,
    );
    assert.equal(
      await number.inputValue(),
      "73",
      "Disabling must drop stale draft",
    );
    assert.equal(await number.isDisabled(), true);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `numeric-${width}.png`) });
    await page.close();
    console.log(
      `PASS ${width}px: clear, zero, minimum, decimal, negative, optional, blur, submit, reset, disabled`,
    );
  }
  console.log(`Browser evidence: ${output}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
