import { describe, expect, it, vi } from "vitest";
import { openDashboardTab } from "./openDashboardTab";

function createBrowserApi(tabs: Array<{ id?: number; windowId?: number; url?: string }> = []) {
  let runtimeError: { message: string } | null = null;
  const api = {
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://extension-id/${path}`),
      get lastError() {
        return runtimeError;
      },
    },
    tabs: {
      query: vi.fn(
        (
          _query: { url: string },
          callback: (tabs: Array<{ id?: number; windowId?: number; url?: string }>) => void,
        ) => callback(tabs),
      ),
      update: vi.fn(
        (
          _tabId: number,
          _properties: { active: boolean; url: string },
          callback: () => void,
        ) => callback(),
      ),
      create: vi.fn(
        (_properties: { url: string }, callback: () => void) => callback(),
      ),
    },
    windows: {
      update: vi.fn(
        (
          _windowId: number,
          _properties: { focused: boolean },
          callback: () => void,
        ) => callback(),
      ),
    },
  };
  return { api, setRuntimeError: (value: { message: string } | null) => { runtimeError = value; } };
}

describe("extension dashboard tab opening", () => {
  it("focuses an existing dashboard tab and navigates to its dashboard route", () => {
    const { api } = createBrowserApi([
      {
        id: 4,
        windowId: 2,
        url: "chrome-extension://extension-id/index.html",
      },
    ]);

    openDashboardTab(api);

    expect(api.runtime.getURL).toHaveBeenCalledWith("index.html");
    expect(api.windows.update).toHaveBeenCalledWith(
      2,
      { focused: true },
      expect.any(Function),
    );
    expect(api.tabs.update).toHaveBeenCalledWith(
      4,
      {
        active: true,
        url: "chrome-extension://extension-id/index.html#/dashboard",
      },
      expect.any(Function),
    );
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it("creates a dashboard tab when one does not exist", () => {
    const { api } = createBrowserApi();

    openDashboardTab(api);

    expect(api.tabs.create).toHaveBeenCalledWith(
      { url: "chrome-extension://extension-id/index.html#/dashboard" },
      expect.any(Function),
    );
  });

  it("does not create another tab when querying dashboard tabs fails", () => {
    const { api, setRuntimeError } = createBrowserApi();
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    setRuntimeError({ message: "tabs query failed" });

    openDashboardTab(api);

    expect(api.tabs.create).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledOnce();
    logError.mockRestore();
  });
});
