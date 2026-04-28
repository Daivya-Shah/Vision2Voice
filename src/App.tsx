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
    <div className="max-w-lg space-y-4 rounded-xl border border-border bg-card p-8 shadow-lg">
      <h1 className="font-display text-2xl font-bold text-primary">Supabase key missing</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Your root <code className="rounded bg-secondary px-1.5 py-0.5 text-foreground">.env</code> must
        include a non-empty{" "}
        <code className="rounded bg-secondary px-1.5 py-0.5 text-foreground">
          VITE_SUPABASE_PUBLISHABLE_KEY
        </code>{" "}
        (Supabase Dashboard → your project → <strong>Settings → API Keys</strong> →{" "}
        <strong>Publishable</strong> key).
      </p>
      <p className="text-sm text-muted-foreground">
        Also confirm <code className="rounded bg-secondary px-1.5 py-0.5">VITE_SUPABASE_URL</code> matches
        your project URL.         Save the file with <strong>Ctrl+S</strong> (the key must be on disk, not only in the editor tab),
        then stop and run{" "}
        <code className="rounded bg-secondary px-1.5 py-0.5">npm run dev:full</code> again.
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
