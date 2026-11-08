import { afterEach, describe, expect, it, vi } from "vitest";
import { djangoApiUrl, fetchDjangoApi } from "./djangoApiRequest";

const accessToken = async () => ({
  success: true as const,
  data: "header.payload.signature",
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Django API origin configuration", () => {
  it("uses localhost when no API origin is configured", () => {
    vi.stubEnv("VITE_DJANGO_API_ORIGIN", "");
    vi.stubEnv("DEV", true);

    expect(djangoApiUrl("/api/notes/")).toBe(
      "http://localhost:8000/api/notes/",
    );
  });

  it("rejects a missing API origin outside development mode", () => {
    vi.stubEnv("VITE_DJANGO_API_ORIGIN", "");
    vi.stubEnv("DEV", false);

    expect(() => djangoApiUrl("/api/notes/")).toThrow(
      "VITE_DJANGO_API_ORIGIN must be configured",
    );
  });

  it("accepts a configured production API origin", async () => {
    vi.stubEnv("VITE_DJANGO_API_ORIGIN", "https://youtube-notes.onrender.com");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const request = fetchDjangoApi(accessToken, fetcher);

    await request(djangoApiUrl("/api/notes/"));

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://youtube-notes.onrender.com/api/notes/",
    );
  });

  it("uses the current page origin for the web dashboard", () => {
    vi.stubEnv("VITE_APP_TARGET", "web");
    vi.stubEnv("VITE_DJANGO_API_ORIGIN", "http://localhost:8000");
    vi.stubGlobal("window", {
      location: { origin: "http://127.0.0.1:8000" },
    });

    expect(djangoApiUrl("/api/notes/")).toBe(
      "http://127.0.0.1:8000/api/notes/",
    );
  });

  it("rejects requests sent to an unconfigured origin", async () => {
    vi.stubEnv("VITE_DJANGO_API_ORIGIN", "https://youtube-notes.onrender.com");
    const fetcher = vi.fn<typeof fetch>();
    const request = fetchDjangoApi(accessToken, fetcher);

    await expect(
      request("https://unexpected.example/api/notes/"),
    ).rejects.toThrow("configured API origin");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects requests outside the API path", async () => {
    vi.stubEnv("VITE_DJANGO_API_ORIGIN", "https://youtube-notes.onrender.com");
    const fetcher = vi.fn<typeof fetch>();
    const request = fetchDjangoApi(accessToken, fetcher);

    await expect(
      request("https://youtube-notes.onrender.com/notes/"),
    ).rejects.toThrow("configured API origin");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a configured value that is not an origin", () => {
    vi.stubEnv(
      "VITE_DJANGO_API_ORIGIN",
      "https://youtube-notes.onrender.com/api",
    );

    expect(() => djangoApiUrl("/api/notes/")).toThrow(
      "VITE_DJANGO_API_ORIGIN must be a valid origin",
    );
  });

  it("preserves bearer auth and strips the development auth header", async () => {
    vi.stubEnv("VITE_DJANGO_API_ORIGIN", "http://localhost:8000");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const request = fetchDjangoApi(accessToken, fetcher);

    await request(djangoApiUrl("/api/notes/"), {
      headers: { "X-Dev-User": "ignored" },
    });

    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get("Authorization")).toBe(
      "Bearer header.payload.signature",
    );
    expect(headers.has("X-Dev-User")).toBe(false);
  });
});
