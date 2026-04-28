import { afterEach, describe, expect, it, vi } from "vitest";

import { formatLatency, formatReplayTime, uploadLiveReplayFile } from "@/lib/live";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("live utilities", () => {
  it("formats live latency", () => {
    expect(formatLatency(420)).toBe("420 ms");
    expect(formatLatency(1420)).toBe("1.4 s");
  });

  it("formats replay time", () => {
    expect(formatReplayTime(0)).toBe("0:00");
    expect(formatReplayTime(125)).toBe("2:05");
  });

  it("uploads replay files to the local backend", async () => {
    vi.stubEnv("VITE_BACKEND_URL", "http://127.0.0.1:8000");
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:8000/live/uploads?filename=wizards.mp4");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(File);
      return new Response(
        JSON.stringify({
          upload_id: "abc",
          file_url: "http://127.0.0.1:8000/live/uploads/abc",
          filename: "wizards.mp4",
          size_bytes: 123,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const file = new File(["video"], "wizards.mp4", { type: "video/mp4" });
    await expect(uploadLiveReplayFile(file)).resolves.toMatchObject({
      file_url: "http://127.0.0.1:8000/live/uploads/abc",
      size_bytes: 123,
    });
  });
});
