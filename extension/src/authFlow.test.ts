import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthFlow, sendAuthRuntimeMessage } from "./authFlow";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared authentication flow", () => {
  it("uses Chrome runtime messaging in extension mode", async () => {
    const sendMessage = vi.fn(
      (
        _request: unknown,
        callback: (response: unknown) => void,
      ) => {
        callback({
          type: "AUTH_GET_STATUS",
          result: {
            success: true,
            data: {
              configured: true,
              authenticated: false,
            },
          },
        });
      },
    );
    vi.stubGlobal("chrome", {
      runtime: {
        id: "extension-id",
        lastError: null,
        sendMessage,
      },
    });

    await expect(
      sendAuthRuntimeMessage({ type: "AUTH_GET_STATUS" }),
    ).resolves.toMatchObject({
      type: "AUTH_GET_STATUS",
      result: { success: true },
    });
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("restores shared UI state from the selected authentication provider", async () => {
    const flow = createAuthFlow(async () => ({
      type: "AUTH_GET_STATUS",
      result: {
        success: true,
        data: {
          configured: true,
          authenticated: true,
          user: { id: "supabase-user-uuid", email: "reader@example.test" },
        },
      },
    }));

    await flow.refreshStatus();

    expect(flow.getSnapshot()).toMatchObject({
      status: "signed_in",
      user: { id: "supabase-user-uuid" },
    });
  });

  it("shows a safe authentication configuration error when status lookup fails", async () => {
    const flow = createAuthFlow(async () => ({
      type: "AUTH_GET_STATUS",
      result: {
        success: false,
        error: {
          code: "AUTH_NOT_CONFIGURED",
          message: "Supabase authentication is not configured.",
          diagnosticCode: "AUTH_NOT_CONFIGURED",
        },
      },
    }));

    await flow.refreshStatus();

    expect(flow.getSnapshot()).toMatchObject({
      status: "status_error",
      message: "Supabase authentication is not configured.",
    });
  });
});
