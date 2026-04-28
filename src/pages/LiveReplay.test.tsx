import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import LiveReplay from "@/pages/LiveReplay";

describe("LiveReplay", () => {
  it("renders the setup controls", () => {
    render(
      <MemoryRouter>
        <LiveReplay />
      </MemoryRouter>,
    );

    expect(screen.getByText("Live Replay")).toBeInTheDocument();
    expect(screen.getByLabelText("NBA game id")).toBeInTheDocument();
    expect(screen.getByLabelText("Start period")).toBeInTheDocument();
    expect(screen.getByLabelText("Start clock")).toBeInTheDocument();
    expect(screen.getByText("Caption Feed")).toBeInTheDocument();
  });
});
