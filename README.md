# claude-code-mods

Function-hook mods for Claude Code. Each folder is one plugin.

| Mod | What it does |
| --- | --- |
| `context-watch` | One-line gauge above the prompt for context fill, cost and hot rate limits; toasts at 60/80/90%; compaction keeps your instructions and edited files; `/ctx` opens a context breakdown pane |
| `live-spinner` | Spinner shows what is running: the Bash description or a trimmed command, the ssh host, file being read or edited, search, subagent, MCP tool; a tool's own elapsed time after 15s |
| `pr-watch` | Tracks PRs from `gh pr` / `gt submit` / `git push` output, shows checks above the prompt, toasts on green/red/merged, blocks foreground CI polling loops; `/prs` |
| `house-style` | No em dashes: system prompt rule, reminder to the model after a write that adds one, toast when a reply uses one |
| `handoff` | `/handoff [focus]` writes a state note from the conversation and clears; the next prompt carries it. `/handoff save`, `show`, `drop` |
| `agent-jobs` | `/jobs` opens a pane of running subagents and background shells with elapsed time and a Stop button; toasts when background work finishes |
| `zsh-safe` | Quotes glob flags zsh would expand (`--include=*.ts`, `find -name *.ts`) and keeps a grep that finds nothing from failing a `cd ... && grep` chain |
| `pm-guard` | Blocks npm/npx/yarn where the lockfile says bun or pnpm, and steers to bun where there is no lockfile |
| `remote-guard` | Asks before a destructive command (restart, rm, kill, reboot, pct/qm stop, zfs destroy) runs over ssh |
| `xcode-status` | Only in a folder with an `.xcodeproj`/`.xcworkspace`: one line with the last build or test result (flags runs that executed 0 tests) and the booted simulator; blocks a second `xcodebuild` while one is running |

## Install

```sh
claude plugin marketplace add narrowstacks/claude-code-mods
claude plugin install context-watch@claude-code-mods
```

Or load from a checkout without installing:

```sh
claude --plugin-dir ./context-watch --plugin-dir ./live-spinner
```

## Check

```sh
claude plugin validate ./context-watch
claude plugin test ./context-watch
```

`tsc -p ./context-watch` works once Claude Code has loaded the mod and written `.claude-plugin/types/`.
