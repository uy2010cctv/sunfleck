# Enterprise Collaboration Release Notes — 2026-09-27

English | [中文](2026-09-27-enterprise-collaboration-release.zh.md)

> Version scope: group administration, room messaging parity, shell adjustments, and the fixes that landed with them. All changes are merged to `master` between `4e1a448adc` and `4ef40dc514`.

## Group administration

The human who creates a group is its recorded administrator and the only member who can rename the group, replace or clear its announcement, and add or remove human and employee members. Administration rides new authenticated routes (`rename`, `announcement`, `members/add`, `members/remove`), the room detail reports `viewerIsAdmin` with the optional `adminUserId` and `announcement`, and the sidebar room composer details panel renders the editing affordances only for the administrator. Added humans must keep their workspace access, added employees must resolve to visible published presets, and the administrator can never be removed. Groups created before this version expose no administration surface.

## Room messaging parity

The viewer's own posts right-align in groups, channels, and threads, and digital employees render their published dicebear avatar everywhere an identity appears: room messages, the session header entry, the new-session employee picker, and the mention menu. The avatar seed resolves as the profile seed, else the employee id, matching the roster cards. The room composer gained the workspace composer's attachment capability without its session-only controls — no model selection and no permission selection: files upload raw to a room-scoped route (20 MB per file, eight per message), commit before the message that references them, ride signed `attachment` tags, download member-scoped, and employee prompts name the files. Typing `@` summons the member picker filtered by the partial name and inserts the picked display name; the picker rows carry the roster avatar. The stored contract changed from text-only to attachments-aware, including a new attachments table added through an idempotent boot migration.

## Shell adjustments

The Plugins entry moved from the top panel list to a new `settings.aux` trigger-row slot, so it sits beside the settings launcher in the sidebar foot (stacked in the rail). The turn-process running label replaced "深度求索中" with a growth-cycle mark — seed, sprout, breaking soil, tree, grove, forest — looping every 3 seconds beside "智能生长中" in lime green `#32cd32` with a light streak sweeping across the text; reduced motion pins the tree glyph.

## Fixes

`replayedTargets` treated a freshly created work Session as an error because the Session had no persisted events yet, so the first-ever mention of an employee failed after the message had committed; an empty history is now the replay baseline. The room attachments table is created before the schema-version short-cut so already-migrated databases converge on the first boot. `serveRoute` logs the route error before folding it into a 400 instead of swallowing it silently.

## Operations note

The local enterprise deployment launches with `pnpm run dev:web --skip-build --patch apps/cli/config/enterprise.cordis.patch.yml` and the environment file `~/.dsh/enterprise/local-dev.env` (master key, bootstrap password, database URLs, organization id). Room signing keys bind to an actor's first public key: rotating the enterprise master key makes existing bindings unsignable, and recovery requires deleting the affected rows in `dsh_enterprise_collaboration_actor_keys` so actors rebind on their next message. Historical signed events remain valid.

## Commits

`2b79db5b84` group administration and workbench copy overhaul · `dc71b44251` roster avatar for every digital employee · `ed65e1bfb6` picker avatars · `48ebb9d06c` plugins entry beside settings · `9cec38c8cc` room composer attachments and @-summoned picker · `ddfd53352f` attachments table migration order · `c84bd84f63` empty-session replay baseline and route error logging · `4ef40dc514` growth-cycle running mark.
