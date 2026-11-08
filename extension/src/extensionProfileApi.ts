import {
  isDashboardProfile,
  profileErrorMessage,
} from "./profileContract";
import type { DashboardProfile } from "./profileContract";

export async function getExtensionDashboardProfile(): Promise<DashboardProfile> {
  if (typeof chrome === "undefined" || !chrome.runtime?.id) {
    throw new Error("Open this page from the YouTube Notes extension.");
  }

  const response = await new Promise<unknown>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "PROFILE_API_REQUEST", method: "GET" },
      (result: unknown) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error("Could not reach the profile service."));
          return;
        }
        resolve(result);
      },
    );
  });

  if (
    typeof response !== "object" ||
    response === null ||
    !("success" in response) ||
    typeof response.success !== "boolean" ||
    !("data" in response)
  ) {
    throw new Error("The profile service returned an invalid response.");
  }
  if (!response.success) {
    throw new Error(
      profileErrorMessage(response.data) ?? "Could not load your profile.",
    );
  }
  if (!isDashboardProfile(response.data)) {
    throw new Error("The profile service returned invalid profile data.");
  }
  return response.data;
}
