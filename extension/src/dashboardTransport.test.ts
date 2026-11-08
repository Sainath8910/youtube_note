import { afterEach, describe, expect, it, vi } from "vitest";

const getWebAccessToken = vi.hoisted(() =>
  vi.fn(async () => ({
    success: true as const,
    data: "header.payload.signature",
  })),
);

vi.mock("./webAuth", () => ({ getWebAccessToken }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("browser dashboard API transport", () => {
  it("sends authenticated note requests directly to Django", async () => {
    vi.stubEnv("VITE_DJANGO_API_ORIGIN", "http://localhost:8000");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 8 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const { sendDashboardApiMessage } = await import("./dashboardTransport");

    const result = await sendDashboardApiMessage({
      type: "CREATE_STANDALONE_NOTE",
      data: { title: "Test", content: "", note_type: "STANDALONE" },
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe("http://localhost:8000/api/notes/");
    expect(fetcher.mock.calls[0][1]?.method).toBe("POST");
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization"))
      .toBe("Bearer header.payload.signature");
    expect(result).toMatchObject({
      success: true,
      status: 201,
      data: { id: 8 },
    });
  });

  it("maps video-list filters to the Django API contract", async () => {
    vi.stubEnv("VITE_DJANGO_API_ORIGIN", "http://localhost:8000");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ count: 0, results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const { sendDashboardApiMessage } = await import("./dashboardTransport");

    await sendDashboardApiMessage({
      type: "LIST_VIDEOS",
      page: 2,
      pageSize: 5,
      query: "biology",
      transcriptFilter: "available",
      sort: "title",
    });

    expect(String(fetcher.mock.calls[0][0])).toBe(
      "http://localhost:8000/api/videos/?page=2&page_size=5&q=biology&transcript=available&sort=title",
    );
  });
});
