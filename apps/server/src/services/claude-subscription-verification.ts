export async function verifyClaudeSubscription(token: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 1,
        system: [
          { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
        ],
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
