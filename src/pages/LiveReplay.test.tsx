import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import LiveReplay from "@/pages/LiveReplay";

const originalFetch = global.fetch;
const originalEventSource = global.EventSource;

afterEach(() => {
  global.fetch = originalFetch;
  global.EventSource = originalEventSource;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("LiveReplay", () => {
  it("renders the setup controls", () => {
    render(
      <MemoryRouter>
        <LiveReplay />
      </MemoryRouter>,
    );

    expect(screen.getByText(/REPLAY,/)).toBeInTheDocument();
    expect(screen.getByLabelText(/NBA game id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Start period/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Start clock/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /START REPLAY/i })).toBeInTheDocument();
  });

  it("searches games and fills the selected game id", async () => {
    vi.stubEnv("VITE_BACKEND_URL", "http://127.0.0.1:8000");
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/live/teams")) {
        return new Response(
          JSON.stringify([
            { team_id: "1610612764", name: "Washington Wizards", abbreviation: "WAS", city: "Washington" },
            { team_id: "1610612766", name: "Charlotte Hornets", abbreviation: "CHA", city: "Charlotte" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/live/games/search")) {
        return new Response(
          JSON.stringify([
            {
              game_id: "0022300157",
              game_date: "2023-11-08",
              season: "2023-24",
              season_type: "Regular Season",
              matchup: "WAS @ CHA",
              team_abbreviation: "WAS",
              opponent_abbreviation: "CHA",
              home_team: "CHA",
              away_team: "WAS",
              team_score: 132,
              opponent_score: 116,
              score: "132-116",
              result: "W",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    render(
      <MemoryRouter>
        <LiveReplay />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/^Team$/i), { target: { value: "WAS" } });
    fireEvent.change(screen.getByLabelText(/Opponent/i), { target: { value: "CHA" } });
    fireEvent.change(screen.getByLabelText(/NBA season/i), { target: { value: "2023-24" } });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    const result = await screen.findByText("0022300157");
    fireEvent.click(result.closest("button") as HTMLButtonElement);

    await waitFor(() => expect(screen.getByLabelText(/NBA game id/i)).toHaveValue("0022300157"));
    expect(screen.getByText(/SELECTED/i)).toBeInTheDocument();
  });

  it("sends video play and pause state to the backend playback clock", async () => {
    vi.stubEnv("VITE_BACKEND_URL", "http://127.0.0.1:8000");
    class FakeEventSource {
      onerror: (() => void) | null = null;
      addEventListener = vi.fn();
      close = vi.fn();
    }
    global.EventSource = FakeEventSource as unknown as typeof EventSource;

    const playbackBodies: unknown[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/live/teams")) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/live/sessions")) {
        return new Response(
          JSON.stringify({
            session_id: "session-1",
            status: "ready",
            team_names: ["WAS", "CHA"],
            event_count: 12,
            warnings: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/live/sessions/session-1/playback")) {
        playbackBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    render(
      <MemoryRouter>
        <LiveReplay />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /paste url/i }));
    fireEvent.change(screen.getByLabelText(/Replay video URL/i), { target: { value: "https://example.test/replay.mp4" } });
    fireEvent.change(screen.getByLabelText(/NBA game id/i), { target: { value: "0022300157" } });
    fireEvent.click(screen.getByRole("button", { name: /start replay/i }));

    await waitFor(() => expect(document.querySelector("video")).toBeTruthy());
    const video = document.querySelector("video") as HTMLVideoElement;
    video.currentTime = 14;
    video.playbackRate = 1.5;
    fireEvent.play(video);
    fireEvent.pause(video);

    await waitFor(() => {
      expect(playbackBodies).toEqual(
        expect.arrayContaining([
          { state: "playing", replay_time_sec: 14, playback_rate: 1.5 },
          { state: "paused", replay_time_sec: 14, playback_rate: 1.5 },
        ]),
      );
    });
  });

  it("hides captions that are ahead of the video clock", () => {
    window.localStorage.setItem("vision2voice.live.sessionId.v1", JSON.stringify("session-1"));
    window.localStorage.setItem("vision2voice.live.status.v1", JSON.stringify("running"));
    window.localStorage.setItem(
      "vision2voice.live.captions.v1",
      JSON.stringify([
        {
          type: "caption",
          session_id: "session-1",
          event_id: "future",
          period: 1,
          clock: "11:40",
          event_type: "made_shot",
          text: "This line is still ahead of the video.",
          source: "feed",
          confidence: 0.9,
          model_name: "test",
          replay_time_sec: 20,
          latency_ms: 0,
        },
        {
          type: "caption",
          session_id: "session-1",
          event_id: "current",
          period: 1,
          clock: "12:00",
          event_type: "start",
          text: "This line is safe to show.",
          source: "feed",
          confidence: 0.9,
          model_name: "test",
          replay_time_sec: 0,
          latency_ms: 0,
        },
      ]),
    );

    render(
      <MemoryRouter>
        <LiveReplay />
      </MemoryRouter>,
    );

    expect(screen.getByText(/This line is safe to show/i)).toBeInTheDocument();
    expect(screen.queryByText(/This line is still ahead/i)).not.toBeInTheDocument();
  });
});
