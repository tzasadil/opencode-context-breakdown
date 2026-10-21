# opencode-context-breakdown

An [OpenCode](https://opencode.ai) v2 plugin. Type `/context` to see what fills the context window.

```
Context 41.3k / 200.0k (20.7%)

Summary
  System prompt              14.2k  34.4%
  Tool definitions            6.9k  16.7%
  Conversation                3.1k   7.5%
  Tool calls + results       17.1k  41.4%
  Free                      158.7k  79.4%
System prompt
  3. Code Mode                6.2k  15.0%
  1. You are an AI agent...   361    0.9%
Tool definitions
  mcp: context7               1.7k   4.1%
  subagent                    658    1.6%
Tool calls + results
  read                  12x   9.8k  23.7%
  shell                  5x   4.2k  10.2%
...
```

Each row is one item:

- **System prompt:** each system part, labeled by its first line.
- **Tool definitions:** each tool schema. MCP tools are grouped by server.
- **Conversation:** user text, assistant text, reasoning, media, compaction summaries.
- **Tool calls + results:** input plus output per tool, with the call count.

## Install

Requirements: OpenCode v2. Tested on 2.1.2.

1. Clone the repo:

   ```sh
   git clone https://github.com/tzasadil/opencode-context-breakdown ~/.config/opencode/context-breakdown
   ```

2. Add the directory to `plugins` in `~/.config/opencode/opencode.jsonc`. This loads the server half.

   ```jsonc
   "plugins": ["./context-breakdown"]
   ```

3. Add the same directory to `plugins` in `~/.config/opencode/cli.json`. This loads the TUI half.

   ```json
   "plugins": ["./context-breakdown"]
   ```

4. Restart the background service and the TUI:

   ```sh
   opencode service restart
   ```

5. Send one message in a session, then type `/context`. The command palette lists it as "Context breakdown".

Relative paths resolve from the config file that lists them. A clone somewhere else works with an absolute path.

Update with `git -C ~/.config/opencode/context-breakdown pull`. The server half reloads on file change. Restart the TUI to reload the TUI half.

## How it works

The plugin has two halves:

- **Server (`server.js`):** hooks `session.hook("context")`, which sees the final system parts, history, and tool schemas of every model request. It stores only sizes, never content, and keeps the latest request per session.
- **TUI (`tui.js`):** registers `/context`. It fetches the snapshot over plugin RPC and shows it in a list dialog.

## Accuracy

- Providers report only a total token count. Each row starts as a guess of characters / 4.
- The rows are then scaled so they sum to the real total from the last reply. The total is exact. The split is an estimate.
- The title shows `≈` when no usable total exists, for example right after compaction or while a request is in flight.
- Media counts as about 1500 tokens per item.

## Limitations

- Snapshots live in memory. After a server restart, `/context` shows nothing until the next message in that session.
- With Code Mode enabled, MCP tools sit inside one system part ("Code Mode") and are not split per server.
- Only requests made after the plugin loads are measured.

## License

MIT
