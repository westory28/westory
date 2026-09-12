const KASI_ENDPOINT =
  "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
const UPSTREAM_TIMEOUT_MS = 8_000;

const xmlValue = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].trim() : "";
};

const parseKasiResponse = (text) => {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const payload = JSON.parse(trimmed);
    if (
      payload?.response?.header?.resultCode !== "00" ||
      !payload?.response?.body ||
      typeof payload.response.body !== "object"
    ) {
      throw new Error("Invalid KASI response");
    }
    const items = payload?.response?.body?.items?.item;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }

  const resultCode = xmlValue(trimmed, "resultCode");
  if (
    resultCode !== "00" ||
    !/<body(?:\s[^>]*)?>[\s\S]*?<\/body>/u.test(trimmed)
  ) {
    throw new Error("Invalid KASI response");
  }

  return Array.from(trimmed.matchAll(/<item>([\s\S]*?)<\/item>/g)).map(
    ([, itemXml]) => ({
      dateName: xmlValue(itemXml, "dateName"),
      isHoliday: xmlValue(itemXml, "isHoliday"),
      locdate: xmlValue(itemXml, "locdate"),
    }),
  );
};

const normalizeHoliday = (item) => {
  const rawDate = String(item?.locdate || "");
  if (item?.isHoliday !== "Y" || rawDate.length !== 8 || !item?.dateName) {
    return null;
  }

  return {
    title: String(item.dateName).trim(),
    start: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
    source: "kasi",
  };
};

export default async function handler(request, response) {
  const year = Number(request.query.year);
  const serviceKey = String(
    process.env.KASI_HOLIDAY_SERVICE_KEY ||
      process.env.VITE_KASI_HOLIDAY_SERVICE_KEY ||
      process.env.VITE_KOREA_HOLIDAY_SERVICE_KEY ||
      "",
  ).trim();

  response.setHeader("Cache-Control", "no-store");

  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    response.status(400).json({ error: "Invalid year" });
    return;
  }

  if (!serviceKey) {
    response
      .status(503)
      .json({ error: "KASI holiday service key is not configured" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const monthlyResponses = await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const params = new URLSearchParams({
          pageNo: "1",
          numOfRows: "100",
          solYear: String(year),
          solMonth: String(index + 1).padStart(2, "0"),
          _type: "json",
        });
        const apiResponse = await fetch(
          `${KASI_ENDPOINT}?ServiceKey=${serviceKey}&${params}`,
          { signal: controller.signal },
        );

        if (!apiResponse.ok) {
          throw new Error(`KASI API failed: ${apiResponse.status}`);
        }

        return parseKasiResponse(await apiResponse.text());
      }),
    );

    const holidays = monthlyResponses
      .flat()
      .map(normalizeHoliday)
      .filter(Boolean)
      .sort((left, right) => left.start.localeCompare(right.start));

    response.setHeader(
      "Cache-Control",
      "s-maxage=86400, stale-while-revalidate=604800",
    );
    response.status(200).json({ holidays });
  } catch {
    response.status(502).json({
      error: controller.signal.aborted
        ? "Holiday service request timed out"
        : "Failed to fetch holidays",
    });
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
