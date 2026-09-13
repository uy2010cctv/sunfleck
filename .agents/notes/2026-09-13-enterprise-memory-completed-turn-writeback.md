# Enterprise memory completed-turn writeback

The former automatic-memory path depended on the main Agent calling `remember_business_knowledge`. A completed answer could therefore contain durable business knowledge without producing any memory record.

The enterprise memory context now captures the direct user text and final assistant answer at `agent/turn-stopping`, durably enqueues the bounded snapshot in PostgreSQL, and returns control before independent extraction begins. The extractor runs without tools, sees bounded active/pending memory in the same organization and department, and emits strict `skip`, `create`, or `conflict` candidates. Exact duplicates skip, high-confidence creates activate, and conflicts or lower-confidence statements remain pending.

Queue rows are idempotent by session and turn. Claims use expiring owner leases; completion and failure are fenced by the lease owner. Failures retry after 5, 15, 60, and 180 seconds, stop automatic retry after five attempts, and remain manually retryable. Successful work removes its copied conversation snapshot and retains only outcome counts, memory ids, timestamps, and provenance. Every write rechecks the current workspace grant and Session owner.

The enterprise governance page shows automatic-capture activity, the latest counts, failed jobs, and retry actions without exposing snapshots. This follows the durable outbox and independent extraction ideas observed in `lemoncat7/dsh-knowledge`, while retaining DSH Enterprise organization, department, workspace, Session-owner, privacy, audit, and exception-review boundaries.

Validation includes 58 focused tests, targeted TypeScript builds, source lint, and an isolated real-PostgreSQL exercise covering enqueue, extraction, activation, conflict, duplicate skip, lease fencing shape, and successful snapshot cleanup.
