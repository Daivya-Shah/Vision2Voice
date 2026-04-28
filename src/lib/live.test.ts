import { describe, expect, it } from "vitest";

import { formatLatency, formatReplayTime } from "@/lib/live";

describe("live utilities", () => {
  it("formats live latency", () => {
    expect(formatLatency(420)).toBe("420 ms");
    expect(formatLatency(1420)).toBe("1.4 s");
  });

  it("formats replay time", () => {
    expect(formatReplayTime(0)).toBe("0:00");
    expect(formatReplayTime(125)).toBe("2:05");
  });
});
