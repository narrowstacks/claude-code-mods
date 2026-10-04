# claude-code-mods

Function-hook mods for Claude Code. Each folder is one plugin.

| Mod | What it does |
| --- | --- |
| `context-watch` | Status line gauge for context fill, cost and hot rate limits; toasts at 60/80/90%; compaction keeps your instructions and edited files; `/ctx` opens a context breakdown pane |
| `live-spinner` | Spinner shows what is running: the Bash command, file being read or edited, search, subagent, MCP tool |
| `pr-watch` | Tracks PRs from `gh pr` / `gt submit` / `git push` output, shows checks above the prompt, toasts on green/red/merged, blocks foreground CI polling loops; `/prs` |
| `house-style` | No em dashes: system prompt rule, reminder to the model after a write that adds one, toast when a reply uses one |

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
