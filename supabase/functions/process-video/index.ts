import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.49.4/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { clip_id, file_url, action } = await req.json();

    if (!clip_id || !file_url) {
      return new Response(
        JSON.stringify({ error: "clip_id and file_url are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const backendUrl = Deno.env.get("VISION2VOICE_BACKEND_URL");

    if (!backendUrl) {
      // Mock response for development when no backend is configured
      console.log("No VISION2VOICE_BACKEND_URL configured, using mock data");

      const mockResult = {
        event_type: "Three-Point Shot",
        player_name: "Stephen Curry",
        team_name: "Golden State Warriors",
        confidence: 0.94,
        visual_summary: "Player #30 catches the ball at the top of the arc, rises for a contested three-pointer over two defenders. The ball swishes through the net as the crowd erupts.",
        retrieved_context: {
          player_stats: {
            season_avg_ppg: 29.4,
            three_pt_pct: 0.427,
            games_played: 56,
            career_threes: 3747,
            last_5_games_avg: 31.2,
          },
          team_stats: {
            win_loss: "41-15",
            conference_rank: 2,
            offensive_rating: 118.3,
            three_pt_team_pct: 0.389,
          },
        },
        commentary_text:
          "And Curry pulls up from DEEP! The two-time MVP rises over the defense, and BANG! Nothing but net! That's his fifth triple of the night, and he's now shooting 42% from beyond the arc this season. The Warriors lead stretches to 12 with that dagger!",
      };

      // Save results to database
      await supabase.from("detections").insert({
        clip_id,
        event_type: mockResult.event_type,
        player_name: mockResult.player_name,
        team_name: mockResult.team_name,
        confidence: mockResult.confidence,
        visual_summary: mockResult.visual_summary,
      });

      await supabase.from("retrieved_context").insert({
        clip_id,
        player_stats_json: mockResult.retrieved_context.player_stats,
        team_stats_json: mockResult.retrieved_context.team_stats,
      });

      await supabase.from("commentaries").insert({
        clip_id,
        model_name: "mock-v1",
        commentary_text: mockResult.commentary_text,
      });

      return new Response(JSON.stringify(mockResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call external backend
    const endpoint = action === "regenerate" ? "/regenerate" : "/analyze";
    const response = await fetch(`${backendUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clip_id, file_url }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Backend API failed [${response.status}]: ${errorBody}`);
    }

    const result = await response.json();

    // Save results to database
    if (action !== "regenerate") {
      await supabase.from("detections").insert({
        clip_id,
        event_type: result.event_type,
        player_name: result.player_name,
        team_name: result.team_name,
        confidence: result.confidence,
        visual_summary: result.visual_summary,
      });

      await supabase.from("retrieved_context").insert({
        clip_id,
        player_stats_json: result.retrieved_context?.player_stats,
        team_stats_json: result.retrieved_context?.team_stats,
      });
    }

    await supabase.from("commentaries").insert({
      clip_id,
      model_name: result.model_name || "external-v1",
      commentary_text: result.commentary_text,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error processing video:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
