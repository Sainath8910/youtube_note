import { djangoApiUrl, fetchDjangoApi } from "./djangoApiRequest";
import { isExtensionRuntime } from "./extensionRuntime";

type DashboardApiResponse = {
  success: boolean;
  status: number;
  data: unknown;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extensionMessage(
  message: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!isExtensionRuntime()) {
      reject(new Error("The browser extension runtime is unavailable."));
      return;
    }
    chrome.runtime.sendMessage(message, (response: unknown) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message || "Extension request failed."));
        return;
      }
      resolve(response);
    });
  });
}

function requestForMessage(
  message: Record<string, unknown>,
): { path: string; method: string; body?: unknown } | null {
  const type = message.type;
  const id =
    typeof message.noteId === "number" || typeof message.folderId === "number"
      ? String(message.noteId ?? message.folderId)
      : "";
  const videoId =
    typeof message.videoId === "string" ? message.videoId.trim() : "";

  switch (type) {
    case "GET_NOTES":
      return { path: "/api/notes/", method: "GET" };
    case "CREATE_STANDALONE_NOTE":
      return { path: "/api/notes/", method: "POST", body: message.data };
    case "CREATE_NOTE":
      return {
        path: "/api/notes/video/",
        method: "POST",
        body: message.data,
      };
    case "UPDATE_NOTE":
      return {
        path: `/api/notes/${encodeURIComponent(id)}/`,
        method: "PATCH",
        body: message.data,
      };
    case "DELETE_NOTE":
      return {
        path: `/api/notes/${encodeURIComponent(id)}/`,
        method: "DELETE",
      };
    case "GET_VIDEO_CONTEXT":
      return {
        path: `/api/videos/${encodeURIComponent(videoId)}/`,
        method: "GET",
      };
    case "LIST_VIDEOS": {
      const query = new URLSearchParams();
      const params = [
        ["page", message.page],
        ["page_size", message.pageSize],
        ["q", message.query],
        ["transcript", message.transcriptFilter],
        ["sort", message.sort],
      ] as const;
      for (const [name, value] of params) {
        if (
          (typeof value === "string" && value !== "") ||
          (typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value > 0)
        ) {
          query.set(name, String(value));
        }
      }
      const suffix = query.toString();
      return {
        path: `/api/videos/${suffix ? `?${suffix}` : ""}`,
        method: "GET",
      };
    }
    case "GET_VIDEO_DETAILS":
      return {
        path: `/api/videos/${encodeURIComponent(videoId)}/details/`,
        method: "GET",
      };
    case "GET_VIDEO_TRANSCRIPT":
      return {
        path: `/api/videos/${encodeURIComponent(videoId)}/transcript/`,
        method: "GET",
      };
    case "FETCH_TRANSCRIPT":
      return {
        path: `/api/videos/${encodeURIComponent(videoId)}/transcript/`,
        method: "POST",
        body: {},
      };
    case "SEARCH_FOLDERS":
      return {
        path: `/api/folders/search/?q=${encodeURIComponent(
          typeof message.query === "string" ? message.query.trim() : "",
        )}`,
        method: "GET",
      };
    case "LIST_FOLDERS": {
      const parent = message.parent;
      const query =
        Object.prototype.hasOwnProperty.call(message, "parent") &&
        (parent === null ||
          (typeof parent === "number" &&
            Number.isSafeInteger(parent) &&
            parent > 0))
          ? `?parent=${encodeURIComponent(parent === null ? "null" : String(parent))}`
          : "";
      return { path: `/api/folders/${query}`, method: "GET" };
    }
    case "CREATE_FOLDER":
      return {
        path: "/api/folders/",
        method: "POST",
        body: message.data,
      };
    case "GET_FOLDER":
      return {
        path: `/api/folders/${encodeURIComponent(id)}/`,
        method: "GET",
      };
    case "GET_FOLDER_NOTES":
      return {
        path: `/api/folders/${encodeURIComponent(id)}/notes/`,
        method: "GET",
      };
    case "UPDATE_FOLDER":
      return {
        path: `/api/folders/${encodeURIComponent(id)}/`,
        method: "PATCH",
        body: message.data,
      };
    case "DELETE_FOLDER":
      return {
        path: `/api/folders/${encodeURIComponent(id)}/`,
        method: "DELETE",
      };
    case "PROFILE_API_REQUEST":
      if (message.method !== "GET" && message.method !== "PATCH") return null;
      return {
        path: "/api/users/profile/",
        method: message.method,
        ...(message.data === undefined ? {} : { body: message.data }),
      };
    default:
      return null;
  }
}

async function requestWebApi(
  message: Record<string, unknown>,
): Promise<DashboardApiResponse> {
  const request = requestForMessage(message);
  if (!request) {
    return {
      success: false,
      status: 400,
      data: { detail: "The dashboard API request is not supported." },
    };
  }

  try {
    const { getWebAccessToken } = await import("./webAuth");
    const response = await fetchDjangoApi(getWebAccessToken)(
      djangoApiUrl(request.path),
      {
        method: request.method,
        ...(request.body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(request.body),
            }),
      },
    );
    const responseText = await response.text();
    let data: unknown = null;
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        return {
          success: false,
          status: response.ok ? 502 : response.status,
          data: { detail: "The API returned invalid JSON." },
        };
      }
    }
    return {
      success: response.ok,
      status: response.status,
      data,
      ...(!response.ok && {
        error:
          isRecord(data) && typeof data.detail === "string"
            ? data.detail
            : `API request failed with status ${response.status}.`,
      }),
    };
  } catch (error) {
    return {
      success: false,
      status: 0,
      data: {
        detail:
          error instanceof Error ? error.message : "Could not reach the API.",
      },
    };
  }
}

export async function sendDashboardApiMessage(
  message: Record<string, unknown>,
): Promise<unknown> {
  if (isExtensionRuntime()) return extensionMessage(message);
  return requestWebApi(message);
}
