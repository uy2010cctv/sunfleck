---
description: "Workspace file-directory surface: a sidebar trigger plus overlay drawer listing the current session's workspace file tree; for users and maintainers of the workspace file-browsing experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace-files

English | [中文](README.zh.md)

## Summary

This package renders a workspace file-directory surface for the Web GUI: a sidebar footer trigger opens a right-side drawer listing the file tree of the current session's workspace directory (the session cwd). Directories expand lazily, one level per Host round-trip, through the same file-reference discovery service the `@` mention menu uses — so the tree and the mention menu share one relative-path vocabulary and never disagree about what the workspace contains. The plugin is a read-only projection for the human: it issues no mutation RPCs.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in the web roster alongside the runtime. A folder trigger appears in the sidebar footer (beside Settings); clicking it toggles the drawer. The drawer header shows the workspace basename plus the full path, with refresh and close controls. The tree lists the workspace root by default; clicking a directory expands or collapses it, loading that level on first expand. When the current session has no workspace directory, the drawer shows an empty state instead of an error.

### Data source

Levels come from the Host file-reference discovery service (`ctx.remote.fileReferences.list` with the session id and a relative directory query: `''` for the workspace root, `'dir/'` for a subdirectory). Hidden entries and excluded directories are Host-filtered exactly as they are for the `@` mention menu, so a directory that does not appear in mentions does not appear in the tree.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers two additive slot entries, both keyed by the same `workspace-files` id:

- `sidebar.footer.action` — the trigger button. It reads the shared open-state store through the inject `hooks` compartment (`useWorkspaceFiles`), so its pressed state and the drawer's visibility can never disagree.
- `shell.overlay` — the drawer itself. It reads the current session and its cwd through the standard `useSessions` hook, then lists levels through the injected `listLevel` callback bound to the file-reference remote.

The two entries share one `SnapshotStore<{ open: boolean }>` created in `apply`, passed through each registration's `inject` `hooks` compartment. Level children are cached per directory key in component state; a generation counter plus an `AbortController` invalidate in-flight scans when the drawer closes, the session changes, or the tree resets, so a late settlement can never mutate a closed drawer.
</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-client-ui-reference`](../ui-reference/) — the `@` mention menu that shares the same file-discovery vocabulary.
- [`dsh-file-reference-local`](../../context/file-reference-local/) — the Host service that resolves level listings.
- [`dsh-client-ui-workspace`](../ui-workspace/) — the workspace/session browsing region this plugin complements.

-----

<a id="model-experience"></a>
## Model Experience

### Workspace browsing

#### What the model sees

Nothing. The browser calls `ctx.remote.fileReferences.list` for its drawer; this package adds no tools or prompt sections. The model's filesystem tools and the `@`-mention menu retain their own context behavior.

#### Token effect

Zero tokens. Drawer listings do not enter Session history.

#### KV Cache effect

None; browsing or refreshing the drawer does not assemble a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Levels are bounded by the Host file-discovery `maxResults` cap (20 by default); a directory with more entries than the cap is truncated. Raising the cap on the `file-reference-local` row lifts the same limit for both the tree and mentions.
- The drawer lists names only — no sizes, mtimes, or open-in-editor actions yet.
- The tree does not follow filesystem changes live; the refresh button re-reads levels on demand.

-----

<a id="dev-note"></a>
### Dev Note

Rebuild the client bundle with `pnpm --filter @deepseek-ai/dsh-client-ui-workspace-files run bundle` (or the dev-web watch loop). The bundle must be re-served by the web runtime before the drawer appears; the client-hmr chain reloads the entry when the artifact changes.
