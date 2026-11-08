export interface DashboardProfile {
  email: string;
  username: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDashboardProfile(value: unknown): value is DashboardProfile {
  return (
    isRecord(value) &&
    typeof value.email === "string" &&
    typeof value.username === "string"
  );
}

export function profileErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.detail === "string") return value.detail;
  const username = value.username;
  if (Array.isArray(username) && typeof username[0] === "string") {
    return username[0];
  }
  return null;
}
