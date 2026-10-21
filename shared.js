// Shared by server.js and tui.js. Pure: no host imports, so both halves load it as-is.

// JSON Schema literals keep this file free of zod/effect imports.
export const contextBreakdownRpc = {
  id: "context-breakdown",
  methods: {
    get: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
      },
      output: { type: "object" },
    },
  },
  events: {},
};

// Providers report only a total, so every category starts as a chars/4 guess.
// The TUI rescales the guesses to the provider's real total.
// TODO: per-model tokenizers would make shares exact. Revisit if the
// calibrated shares look wrong for a provider with an unusual tokenizer.
export const CHARS_PER_TOKEN = 4;

// Media bytes say nothing about token cost (base64 overcounts by orders of
// magnitude). Assume one mid-size image per item.
// TODO: use media.info width/height and the provider image formula if this matters.
const MEDIA_TOKENS = 1500;

const textLength = (value) =>
  typeof value === "string" ? value.length : value === undefined ? 0 : JSON.stringify(value).length;

const firstLine = (text) => {
  const line = text.split("\n").find((l) => l.trim()) ?? "(empty)";
  const clean = line.trim().replace(/^#+\s*/, "");
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
};

const bump = (map, key, chars, extra) => {
  const item = map.get(key) ?? { label: key, chars: 0, count: 0 };
  item.chars += chars;
  item.count += 1;
  if (extra) item.media = (item.media ?? 0) + extra;
  map.set(key, item);
};

const toolResultChars = (result) => {
  if (result?.type !== "content") return { chars: textLength(result?.value), media: 0 };
  let chars = 0;
  let media = 0;
  for (const item of result.value) {
    if (item.type === "text") chars += item.text.length;
    else media += 1;
  }
  return { chars, media };
};

// Summarises one model request. Stores sizes only, never the content, so a
// snapshot stays a few KB even when the request is megabytes.
export function measureContext({ system, messages, tools, model, agent }) {
  const systemItems = system.map((part, index) => ({
    label: `${index + 1}. ${firstLine(part.text)}`,
    chars: part.text.length,
    count: 1,
  }));

  const toolItems = Object.entries(tools).map(([name, tool]) => ({
    label: name,
    chars: name.length + tool.description.length + textLength(tool.input),
    count: 1,
  }));

  const history = new Map();
  const toolIO = new Map();
  for (const message of messages) {
    for (const part of message.content) {
      switch (part.type) {
        case "text":
          bump(history, `${message.role} text`, part.text.length);
          break;
        case "reasoning":
          // Encrypted reasoning is opaque. Its length is a rough proxy only.
          bump(history, part.text ? "reasoning" : "reasoning (encrypted)", part.text?.length || part.encrypted?.length || 0);
          break;
        case "media":
          bump(history, `${message.role} media`, 0, 1);
          break;
        case "tool-call":
          bump(toolIO, part.name, textLength(part.input));
          break;
        case "tool-result": {
          const { chars, media } = toolResultChars(part.result);
          // The call already counted this tool once. Count chars only.
          const item = toolIO.get(part.name) ?? { label: part.name, chars: 0, count: 0 };
          item.chars += chars;
          if (media) item.media = (item.media ?? 0) + media;
          toolIO.set(part.name, item);
          break;
        }
        case "compaction":
          bump(history, "compaction summary", part.text?.length ?? part.encrypted?.length ?? 0);
          break;
        default:
          bump(history, `${message.role} ${part.type}`, textLength(part));
      }
    }
  }

  return {
    at: Date.now(),
    model,
    agent,
    messageCount: messages.length,
    groups: [
      { name: "System prompt", items: systemItems },
      { name: "Tool definitions", items: toolItems },
      { name: "Conversation", items: [...history.values()] },
      { name: "Tool calls + results", items: [...toolIO.values()] },
    ],
  };
}

// MCP tools arrive as `<server>_<tool>`. One row per server shows where the
// schema bulk comes from, which is usually the surprise.
export function groupMcpTools(items, servers) {
  const prefixes = [...servers].sort((a, b) => b.length - a.length).map((s) => [s, `${s}_`]);
  const grouped = new Map();
  for (const item of items) {
    const server = prefixes.find(([, prefix]) => item.label.startsWith(prefix))?.[0];
    const key = server ? `mcp: ${server}` : item.label;
    const row = grouped.get(key) ?? { label: key, chars: 0, count: 0 };
    row.chars += item.chars;
    row.count += item.count;
    grouped.set(key, row);
  }
  return [...grouped.values()];
}

export const estimateTokens = (item) => item.chars / CHARS_PER_TOKEN + (item.media ?? 0) * MEDIA_TOKENS;
