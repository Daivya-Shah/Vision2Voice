import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import Index from "@/pages/Index";

afterEach(() => {
  window.localStorage.clear();
});

describe("Index", () => {
  it("restores generated analysis from persistent storage", () => {
    window.localStorage.setItem(
      "vision2voice.offlineAnalysis.v1",
      JSON.stringify({
        step: "complete",
        clipId: "clip-12345678",
        fileUrl: "https://example.test/clip.mp4",
        result: {
          event_type: "made_shot",
          player_name: "Test Player",
          team_name: "Washington Wizards",
          confidence: 0.91,
          visual_summary: "A guard attacks the lane.",
          commentary_text: "The Wizards keep pressure on the rim with a decisive finish.",
          model_name: "test",
        },
      }),
    );

    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>,
    );

    expect(screen.getByText("The Wizards keep pressure on the rim with a decisive finish.")).toBeInTheDocument();
    expect(screen.getByText(/FILE A NEW CLIP/i)).toBeInTheDocument();
  });
});
