export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const urlToken = new URL(req.url).searchParams.get('token');
  if (urlToken) return urlToken;

  const protocolHeader = req.headers.get('Sec-WebSocket-Protocol');
  if (!protocolHeader) return null;

  // Browser WebSocket clients can pass auth via subprotocols.
  // Expected format: "agent-ops, bearer.<token>"
  for (const protocol of protocolHeader.split(',').map((p) => p.trim())) {
    if (protocol.startsWith('bearer.')) {
      const token = protocol.slice('bearer.'.length);
      if (token) return token;
    }
  }

  return null;
}
