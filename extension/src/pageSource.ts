const SENSITIVE_QUERY_PARAMETER =
  /^(utm_.+|gclid|fbclid|mc_cid|mc_eid|access_token|auth|token|key|api_key|secret|password|session|code|state)$/i;

export interface PageSource {
  url: string;
  title: string;
}

export function normalizePageSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase();
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be" ||
      host === "youtube-nocookie.com" ||
      url.username ||
      url.password
    ) {
      return null;
    }

    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAMETER.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function getCurrentPageSource(): PageSource | null {
  const url = normalizePageSourceUrl(window.location.href);
  if (!url) return null;

  const parsedUrl = new URL(url);
  return {
    url,
    title: window.document.title.trim() || parsedUrl.hostname,
  };
}
