# Agent Note: Download presented source files

Status: implemented

English | [中文](2026-09-22-present-source-file-download.zh.md)

## Problem

Presented-file cards can preview a source in the Sidebar or ask the serving Host desktop to open it. A headless deployment disables both native menu actions, leaving users unable to save generated documents from the browser.

## Decision

The [deliverables plugin](../../../../packages/client/ui-deliverables/README.md) adds Download to every presented-file menu. The action uses an authenticated GET addressed by the viewed Session, delivery event sequence, and original file index. The Host resolves the recorded declaration through the viewed Session filesystem, streams bounded byte ranges, and sets the attachment filename from the declared basename. Download does not require a Host desktop and remains available while a native action is pending.

The route captures the source version before transfer and checks it before each byte range. A concurrent source change fails the transfer instead of returning bytes from multiple versions. Edits completed before the gesture appear in the download; deleted, moved, non-regular, or malformed declarations fail without exposing a Host path. The Session log continues to store only declarations, and no attachment snapshot or fallback copy is created.

## Alternatives considered

**Restoring immutable delivery snapshots** would preserve historical bytes, but would also restore content storage and retention obligations rejected by the source-file delivery design.

**Using native Host open for downloads** does not work on headless servers and sends the action to the wrong device for remote browsers.

**Reading the entire file before responding** simplifies error handling but makes memory usage proportional to file size. Bounded reads keep memory stable and permit large transfers.

## Consequences

Downloaded bytes represent the source at the download gesture, not the time of declaration. Session exports still contain no file contents. Browser authentication and declaration lookup prevent downloading arbitrary paths by changing query parameters. The file card menu stays usable without desktop metadata; only default-app and file-manager items are disabled.

Focused tests cover current edited bytes, Unicode filenames, headless Hosts, invalid coordinates, missing sources, menu availability, keyboard navigation, and independence from native action state. The recorded Web delivery scenario downloads a source and verifies the resulting filename and bytes.
