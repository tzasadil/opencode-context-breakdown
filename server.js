import { contextBreakdownRpc, groupMcpTools, measureContext } from "./shared.js";

// Snapshots live in memory: a server restart clears them until the next request.
// TODO: persist with ctx.storage if losing them on restart becomes annoying.
const MAX_SESSIONS = 200;

export default {
  id: "local.context-breakdown",
  async setup(ctx) {
    const snapshots = new Map();

    // The `context` hook sees the final system parts, history, and tool schemas
    // of every model request. Read-only and never throws: a failure here would
    // fail the user's request.
    const hook = await ctx.session.hook("context", (request) => {
      try {
        const snapshot = measureContext(request);
        snapshots.delete(request.sessionID);
        snapshots.set(request.sessionID, snapshot);
        if (snapshots.size > MAX_SESSIONS) snapshots.delete(snapshots.keys().next().value);
      } catch (error) {
        console.error("[context-breakdown] measure failed", error);
      }
    });

    const rpc = await ctx.rpc.register(contextBreakdownRpc, {
      async get({ sessionID }) {
        const snapshot = snapshots.get(sessionID);
        if (!snapshot) return { snapshot: null };
        const servers = await ctx.mcp.list().then(
          (result) => result.data.map((server) => server.name),
          () => [],
        );
        const groups = snapshot.groups.map((group) =>
          group.name === "Tool definitions" ? { ...group, items: groupMcpTools(group.items, servers) } : group,
        );
        return { snapshot: { ...snapshot, groups } };
      },
    });

    return async () => {
      await hook.dispose();
      await rpc.dispose();
    };
  },
};
