// Type-check Edge Function source with local npm dependencies when Deno is absent.
// Actual deployment uses Deno and supabase/functions/deno.json.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};
