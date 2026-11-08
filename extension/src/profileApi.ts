import { sendDashboardApiMessage } from "./dashboardTransport";
import {
  isDashboardProfile,
  profileErrorMessage,
  type DashboardProfile,
} from "./profileContract";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestProfile(
  method: "GET" | "PATCH",
  data?: { username: string },
): Promise<DashboardProfile> {
  const response = await sendDashboardApiMessage({
    type: "PROFILE_API_REQUEST",
    method,
    ...(data ? { data } : {}),
  });

  if (
    !isRecord(response) ||
    typeof response.success !== "boolean" ||
    !("data" in response)
  ) {
    throw new Error("The profile service returned an invalid response.");
  }
  if (!response.success) {
    throw new Error(
      profileErrorMessage(response.data) ?? "Could not update your profile.",
    );
  }
  if (!isDashboardProfile(response.data)) {
    throw new Error("The profile service returned invalid profile data.");
  }
  return response.data;
}

export function getDashboardProfile(): Promise<DashboardProfile> {
  return requestProfile("GET");
}

export function updateDashboardUsername(
  username: string,
): Promise<DashboardProfile> {
  return requestProfile("PATCH", { username });
}
