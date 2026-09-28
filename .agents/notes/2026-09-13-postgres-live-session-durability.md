# PostgreSQL live-session durability repair

English | [中文](2026-09-13-postgres-live-session-durability.zh.md)

The v0.1.5 handle adapter persisted explicit pre-publication appends but did not route live session events, unlike the JSONL provider. Completed conversations remained only in RAM and appeared blank after restart.

Register live event, checkpoint and disposal listeners; retain failed buffers and await close-time arrivals. All handles are attempted at shutdown. Regression failed with zero recovered events before the repair. 16 focused tests, package TypeScript build and source lint pass. Real PostgreSQL + native SessionStore verified user-message persistence after close and fresh-provider read.

Existing missing conversation bodies cannot be reconstructed from header-only database rows. Preserve source work products; do not manufacture session history from screenshots.
