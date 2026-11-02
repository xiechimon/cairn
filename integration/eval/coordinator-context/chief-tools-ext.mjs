import { readFileSync } from 'node:fs';

const HISTORY_TOOLS = new Set(['search_history', 'read_history']);

export default function chiefToolsExtension(pi) {
  const config = JSON.parse(readFileSync(process.env.SPIKE_TOOLS_CONFIG, 'utf8'));
  for (const spec of config.tools) {
    const history = HISTORY_TOOLS.has(spec.name);
    if (history && !config.history) continue;
    pi.registerTool({
      name: spec.name,
      label: spec.name,
      description: spec.description,
      parameters: spec.parameters ?? { type: 'object', properties: {} },
      async execute(_toolCallId, params) {
        if (!history) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: true, replay: true }) }],
            details: {},
          };
        }
        const res = await fetch(config.historyUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: spec.name, params }),
        });
        return { content: [{ type: 'text', text: await res.text() }], details: {} };
      },
    });
  }
}
