const SLACK_API = 'https://slack.com/api';

/** Authenticated POST against the Slack Web API. Automatically retries on 429 rate limits. */
export async function slackFetch(
  method: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: body ? JSON.stringify(body) : '{}',
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') || '2');
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    return res;
  }

  // Return a synthetic 429 if all retries exhausted
  return new Response(JSON.stringify({ ok: false, error: 'rate_limited' }), { status: 429 });
}
