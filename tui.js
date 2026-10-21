import { contextBreakdownRpc, estimateTokens } from "./shared.js";

const formatTokens = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;
const formatShare = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "-");

// The provider's real prompt size for the latest completed request.
// `input` excludes cache reads and writes, so all three add up to the prompt.
function lastUsage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type !== "assistant" || !message.tokens) continue;
    const { input, cache } = message.tokens;
    const total = input + cache.read + cache.write;
    if (total > 0) return { total, model: message.model };
  }
}

function contextLimit(api, model) {
  if (!model) return;
  const info = api.data.location.model
    .list()
    ?.find((m) => m.providerID === model.providerID && (m.id === model.id || m.modelID === model.id));
  return info?.limit.input ?? info?.limit.context;
}

// Pure: snapshot + real usage -> dialog rows. Scales every chars/4 guess so the
// rows sum to the provider-reported total.
export function breakdownRows(snapshot, usage, limit) {
  const estimated = snapshot.groups.flatMap((g) => g.items).reduce((sum, item) => sum + estimateTokens(item), 0);
  // A wild ratio means the usage belongs to a different request (compaction,
  // request still in flight). Fall back to the raw guess then.
  const ratio = usage && estimated > 0 ? usage.total / estimated : 1;
  const calibrated = ratio > 0.5 && ratio < 2;
  const scale = calibrated ? ratio : 1;
  const total = estimated * scale;
  const tokens = (item) => estimateTokens(item) * scale;

  const rows = snapshot.groups.map((group) => {
    const sum = group.items.reduce((s, item) => s + tokens(item), 0);
    return { title: group.name, value: `group:${group.name}`, footer: `${formatTokens(sum)}  ${formatShare(sum, total)}`, category: "Summary" };
  });
  if (limit) {
    rows.push({ title: "Free", value: "free", footer: `${formatTokens(Math.max(limit - total, 0))}  ${formatShare(Math.max(limit - total, 0), limit)}`, category: "Summary" });
  }

  for (const group of snapshot.groups) {
    const items = [...group.items].sort((a, b) => tokens(b) - tokens(a));
    for (const item of items) {
      const detail = [item.count > 1 ? `${item.count}x` : undefined, item.media ? `${item.media} media` : undefined]
        .filter(Boolean)
        .join(", ");
      rows.push({
        title: item.label,
        value: `${group.name}:${item.label}`,
        description: detail || undefined,
        footer: `${formatTokens(tokens(item))}  ${formatShare(tokens(item), total)}`,
        category: group.name,
      });
    }
  }

  const head = limit ? `${formatTokens(total)} / ${formatTokens(limit)} (${formatShare(total, limit)})` : formatTokens(total);
  return { title: `Context ${calibrated && usage ? "" : "≈"}${head}`, rows };
}

export default {
  id: "local.context-breakdown.tui",
  setup(api) {
    const rpc = api.client.rpc(contextBreakdownRpc);
    let latest = 0;

    async function showBreakdown() {
      const route = api.ui.router.current();
      if (route.type !== "session") {
        api.ui.toast.show({ message: "Open a session first", variant: "warning" });
        return;
      }
      // Newest invocation wins: a slow earlier call never opens a stale dialog.
      const call = ++latest;
      try {
        // The server runs one plugin instance per location, each with its own
        // snapshots. Route the call to the session's location, not the TUI's.
        const directory = api.data.session.get(route.sessionID)?.location.directory;
        const [{ snapshot }] = await Promise.all([
          rpc.get({ sessionID: route.sessionID }, directory ? { location: { directory } } : undefined),
          api.data.session.message.sync(route.sessionID).catch(() => {}),
        ]);
        if (call !== latest) return;
        if (!snapshot) {
          api.ui.toast.show({ message: "No request in this session since the server started", variant: "info" });
          return;
        }
        const usage = lastUsage(api.data.session.message.list(route.sessionID));
        const { title, rows } = breakdownRows(snapshot, usage, contextLimit(api, usage?.model ?? snapshot.model));
        await api.ui.dialog.select({ title, options: rows });
      } catch (error) {
        if (call !== latest) return;
        api.ui.toast.show({ title: "Context breakdown failed", message: String(error?.message ?? error), variant: "error" });
      }
    }

    // A keymap layer needs a live component owner. Called bare in setup it never
    // attaches, so mount it from an invisible `app` slot, as the built-in /btw does.
    api.ui.slot({
      append: "app",
      render() {
        api.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "context.breakdown",
              title: "Context breakdown",
              description: "Show what fills the context window",
              group: "Session",
              palette: true,
              slash: { name: "context" },
              run: () => void showBreakdown(),
            },
          ],
        }));
        return null;
      },
    });
  },
};
