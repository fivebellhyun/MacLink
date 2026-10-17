/** Response hardening that leaves streaming, downloads and WebRTC policies intact. */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  // An additional CSP policy is intersected with any existing policy. Do not
  // replace a framework policy or loosen its script/style restrictions.
  headers.append('Content-Security-Policy', "frame-ancestors 'none'");
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
