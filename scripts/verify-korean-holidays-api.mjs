import assert from "node:assert/strict";
import handler from "../api/korean-holidays.js";

const keyNames = [
  "KASI_HOLIDAY_SERVICE_KEY",
  "VITE_KASI_HOLIDAY_SERVICE_KEY",
  "VITE_KOREA_HOLIDAY_SERVICE_KEY",
];
const savedKeys = keyNames.map((name) => process.env[name]);
const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const secret = "private%2Bholiday%2Fkey%3D";
const cases = [];
const payload = (items = []) => ({
  response: {
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE" },
    body: { items: { item: items } },
  },
});
const upstream = (value) => ({
  ok: true,
  text: async () => (typeof value === "string" ? value : JSON.stringify(value)),
});
const request = async (fetch, year = "2026") => {
  const calls = [];
  globalThis.fetch = (url, options) => {
    calls.push({ url, options });
    return fetch(url, options);
  };
  const response = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  await handler({ query: { year } }, response);
  return { response, calls };
};
const failure = (result, code = 502) => {
  assert.equal(result.response.statusCode, code);
  assert.equal(result.response.headers["Cache-Control"], "no-store");
  assert.equal(typeof result.response.body.error, "string");
  assert.equal(JSON.stringify(result.response).includes(secret), false);
};

try {
  keyNames.forEach((name) => delete process.env[name]);
  process.env.KASI_HOLIDAY_SERVICE_KEY = secret;
  const json = await request(async (url) => {
    const month = new URL(url).searchParams.get("solMonth");
    return upstream(
      payload([
        {
          locdate: `2026${month}01`,
          isHoliday: "Y",
          dateName: `휴일 ${month}`,
        },
        { locdate: `2026${month}02`, isHoliday: "N", dateName: "일반일" },
      ]),
    );
  });
  assert.equal(json.response.statusCode, 200);
  assert.deepEqual(
    json.response.body.holidays,
    Array.from({ length: 12 }, (_, i) => {
      const month = String(i + 1).padStart(2, "0");
      return {
        title: `휴일 ${month}`,
        start: `2026-${month}-01`,
        source: "kasi",
      };
    }),
  );
  assert.equal(
    json.response.headers["Cache-Control"],
    "s-maxage=86400, stale-while-revalidate=604800",
  );
  assert.equal(json.calls.length, 12);
  assert.ok(
    json.calls.every(
      ({ url, options }) =>
        url.includes(`?ServiceKey=${secret}&`) &&
        options.signal instanceof AbortSignal,
    ),
  );
  cases.push("JSON_SUCCESS_SHAPE_SORT_ENCODING_AND_SUCCESS_CACHE");

  const empty = await request(async () => upstream(payload()));
  assert.equal(empty.response.statusCode, 200);
  assert.deepEqual(empty.response.body, { holidays: [] });
  cases.push("VALID_EMPTY_RESPONSE");

  const xml = await request(async (url) =>
    upstream(
      `<response><header><resultCode>00</resultCode></header><body><items><item><dateName>공휴일</dateName><isHoliday>Y</isHoliday><locdate>2026${new URL(url).searchParams.get("solMonth")}01</locdate></item></items></body></response>`,
    ),
  );
  assert.equal(xml.response.statusCode, 200);
  assert.equal(xml.response.body.holidays.length, 12);
  assert.equal(xml.response.body.holidays[0].title, "공휴일");
  cases.push("XML_SUCCESS");

  for (const year of ["invalid", "1899", "2101", "2026.5"]) {
    const result = await request(() => {
      throw new Error("Fetch must not run");
    }, year);
    failure(result, 400);
    assert.equal(result.calls.length, 0);
  }
  cases.push("INVALID_YEAR_NO_NETWORK_NO_CACHE");
  delete process.env.KASI_HOLIDAY_SERVICE_KEY;
  const missing = await request(() => {
    throw new Error("Fetch must not run");
  });
  failure(missing, 503);
  assert.equal(missing.calls.length, 0);
  cases.push("MISSING_KEY_NO_NETWORK_NO_CACHE");
  process.env.KASI_HOLIDAY_SERVICE_KEY = secret;

  for (const [name, text] of [
    [
      "JSON_UPSTREAM_ERROR",
      {
        response: {
          header: { resultCode: "22", resultMsg: secret },
          body: { items: { item: [] } },
        },
      },
    ],
    [
      "XML_UPSTREAM_ERROR",
      `<response><header><resultCode>22</resultCode><resultMsg>${secret}</resultMsg></header><body></body></response>`,
    ],
    [
      "XML_GATEWAY_ERROR",
      `<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>${secret}</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`,
    ],
    ["MISSING_JSON_RESULT_CODE", { response: { body: { items: [] } } }],
    ["MALFORMED_JSON", "{invalid"],
    [
      "INCOMPLETE_XML",
      "<response><header><resultCode>00</resultCode></header>",
    ],
  ]) {
    failure(await request(async () => upstream(text)));
    cases.push(name);
  }
  failure(
    await request(async () => ({
      ok: false,
      status: 503,
      text: async () => secret,
    })),
  );
  cases.push("HTTP_FAILURE");
  failure(
    await request(async () => {
      throw new Error(`Request URL exposes ${secret}`);
    }),
  );
  cases.push("TRANSPORT_SECRET_REDACTED");

  const pending = (signal) =>
    new Promise((_, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new Error(`Aborted ${secret}`)),
        { once: true },
      );
    });
  for (const bodyOnly of [false, true]) {
    let deadline;
    globalThis.setTimeout = (callback, ms) => {
      deadline = ms;
      return originalSetTimeout(callback, 5);
    };
    const result = await request(async (_, { signal }) =>
      bodyOnly ? { ok: true, text: () => pending(signal) } : pending(signal),
    );
    globalThis.setTimeout = originalSetTimeout;
    failure(result);
    assert.equal(deadline, 8000);
    assert.match(result.response.body.error, /timed out/);
    assert.ok(result.calls.every(({ options }) => options.signal.aborted));
    cases.push(bodyOnly ? "BODY_TIMEOUT" : "FETCH_TIMEOUT");
  }
  const cancelled = await request(async (url, { signal }) =>
    new URL(url).searchParams.get("solMonth") === "01"
      ? upstream({ response: { header: { resultCode: "22" } } })
      : pending(signal),
  );
  failure(cancelled);
  assert.ok(cancelled.calls.every(({ options }) => options.signal.aborted));
  cases.push("FAILURE_CANCELS_SIBLING_REQUESTS");
  console.log(
    JSON.stringify({
      suite: "korean-holidays-api",
      passed: true,
      cases,
      liveNetworkRequests: 0,
    }),
  );
} finally {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  keyNames.forEach((name, index) => {
    if (savedKeys[index] === undefined) delete process.env[name];
    else process.env[name] = savedKeys[index];
  });
}
