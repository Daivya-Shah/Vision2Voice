import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isSupabaseConfigured } from "@/integrations/supabase/client";
import Index from "./pages/Index.tsx";
import LiveReplay from "./pages/LiveReplay.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const MissingSupabaseEnv = () => (
  <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
    <div className="w-full max-w-xl space-y-6 border border-foreground/40 p-8">
      <span className="font-mono text-[10px] uppercase tracked tabular text-court">
        FAULT / SUPABASE / MISSING KEY
      </span>
      <h1 className="font-display text-5xl leading-[0.85]">
        SUPABASE KEY <span className="text-court">MISSING.</span>
      </h1>
      <p className="font-body text-base leading-relaxed text-foreground/80">
        Your root <code className="font-mono text-foreground">.env</code> must include a non-empty{" "}
        <code className="font-mono text-foreground">VITE_SUPABASE_PUBLISHABLE_KEY</code> (Supabase
        Dashboard → Settings → API Keys → Publishable).
      </p>
      <p className="font-body text-base leading-relaxed text-foreground/80">
        Also confirm <code className="font-mono text-foreground">VITE_SUPABASE_URL</code> matches your
        project URL. Save the file, then run{" "}
        <code className="font-mono text-foreground">npm run dev:full</code> again.
      </p>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      {!isSupabaseConfigured ? (
        <MissingSupabaseEnv />
      ) : (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/live" element={<LiveReplay />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      )}
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
