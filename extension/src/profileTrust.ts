function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTrustedProfileRequestSender(
  sender: unknown,
  extensionId: string,
  dashboardUrl: string,
  method: unknown,
): boolean {
  if (
    !isRecord(sender) ||
    sender.id !== extensionId ||
    typeof sender.url !== "string"
  ) {
    return false;
  }

  try {
    const senderUrl = new URL(sender.url);
    const trustedDashboardUrl = new URL(dashboardUrl);
    const isDashboard =
      senderUrl.origin === trustedDashboardUrl.origin &&
      senderUrl.pathname === trustedDashboardUrl.pathname &&
      senderUrl.search === "";

    if (isDashboard) return method === "GET" || method === "PATCH";
    if (method !== "GET" || !isRecord(sender.tab)) return false;

    return (
      senderUrl.protocol === "https:" &&
      (senderUrl.hostname === "www.youtube.com" ||
        senderUrl.hostname === "youtube.com") &&
      senderUrl.pathname === "/watch"
    );
  } catch {
    return false;
  }
}
