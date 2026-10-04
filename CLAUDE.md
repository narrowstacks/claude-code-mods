# claude-code-mods

A Claude Code plugin marketplace: one function-hook mod per folder, listed in `.claude-plugin/marketplace.json`.

## Versioning

- **Bump a plugin's `version` in its `.claude-plugin/plugin.json` in the same commit as any change to that plugin's folder.** Installed copies only update when the version changes, so an unbumped change never reaches anyone.
- Minor bump (`0.2.0` -> `0.3.0`) for a feature or behavior change, patch bump (`0.2.0` -> `0.2.1`) for a fix that changes nothing else. A new plugin starts at `0.1.0`.
- Bump only the plugins whose folder changed. README or marketplace-only edits need no bump.

## Checks before committing

Run `claude plugin validate <mod>` and `claude plugin test <mod>` for each changed mod, and `claude plugin validate .` for the marketplace.
