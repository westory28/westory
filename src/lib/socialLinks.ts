const INSTAGRAM_HANDLE_PATTERN = /^@?([A-Za-z0-9._]{1,30})\/?$/;

const isInstagramHost = (host: string) =>
  host === "instagram.com" || host.endsWith(".instagram.com");

export const normalizeInstagramUrl = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const handleMatch = raw.match(INSTAGRAM_HANDLE_PATTERN);
  let candidate = handleMatch
    ? `https://www.instagram.com/${handleMatch[1]}/`
    : raw;

  if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !isInstagramHost(host)
    ) {
      return "";
    }

    url.protocol = "https:";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "";
  }
};
