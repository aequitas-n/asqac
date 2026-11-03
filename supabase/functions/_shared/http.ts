export function cors(request: Request) {
  const origin = request.headers.get('origin');
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((s) => s.trim());
  return {
    'Access-Control-Allow-Origin': origin && allowed.includes(origin) ? origin : allowed[0],
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'content-type,x-device-token,x-maintenance-token',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Cache-Control': 'no-store',
  };
}
export function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(request), 'Content-Type': 'application/json' },
  });
}
export function originAllowed(request: Request) {
  const origin = request.headers.get('origin');
  return (
    !origin ||
    (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://127.0.0.1:5173,http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .includes(origin)
  );
}
