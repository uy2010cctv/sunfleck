# Agent Note: User-scoped recorder device binding

Status: implemented

English | [中文](2026-09-21-user-scoped-recorder-device-binding.zh.md)

## Problem

The Device Plane pairs computers to an authenticated organization user by an Ed25519 public key, while the recorder gateway maps one embedded token and a manually maintained serial-number allowlist to a user. The second path cannot support self-service binding, device transfer, revocation, or the `My devices` projection without treating a recorder as a Computer Use executor.

## Decision

The enterprise control plane projects computers and recorders as user-owned devices while retaining separate authentication and capability records. The current user creates a single-use recorder binding challenge from `My devices`; the Android relay presents that challenge with the recorder serial number and a relay public key. The Server derives the owner from the challenge, never from an app-supplied user id.

## Device records and authentication

Computer records should remain in the Computer Use Device Plane and continue to authenticate signed Agent requests with their Ed25519 key. Recorder records should store an organization id, user id, display name, server-HMACed recorder serial number, Android relay public key, status, last-seen time, and timestamps. Recorder records should grant audio upload and status reporting only; Computer Use run and permit APIs should reject them.

The Android relay generates its key in Android Keystore. A recorder binding challenge expires after ten minutes, is consumed once, and is protected by the gateway rate limit. Repeating a successful bind for the same user and serial number returns the existing recorder. Binding an active recorder to another user fails until a later revocation or transfer flow is implemented.

The current binding response issues one random recorder credential and stores only its digest in the gateway registry. Each upload presents that credential and the recorder serial number; the gateway resolves the durable organization and user mapping and attaches it to the transcript. The relay public key is retained for a later signed-request upgrade, but upload signatures and nonce replay protection are not part of this release. The APK contains no shared production gateway token.

## User experience

The workbench should use `My devices` as the page and navigation label. It should keep `Connect this computer` for the local Device Agent and add `Bind recorder` as a separate action. Device rows should show a human name, device type, online state, last seen time, and type-specific test. The ordinary UI should show only a masked recorder suffix and should never expose public keys, internal ids, signatures, or binding secrets.

## Migration

The existing recorder JSON registry should be imported only when its organization, user, token, and serial-number relationship is unambiguous. Imported bindings should be marked as migrated and should require a relay-key upgrade before the shared token fallback is removed. Unknown records should remain quarantined rather than being assigned to the first user.

## Alternatives considered

**Store recorders in the existing computer table.** This would require fake public keys or nullable fields and would let Computer Use code accept a non-executing device unless every caller added a new guard. Separate authentication records with one user-facing projection preserve existing Computer Use invariants.

**Continue the JSON allowlist.** This is operationally simple but requires administrator edits, has no authenticated self-service ceremony, and cannot express revocation or transfer safely.

**Trust the user id sent by the Android app.** This would let a device select another owner. The binding challenge must own the organization and user scope on the Server.

## Verification

- An authenticated user can bind one recorder without administrator input, and another user cannot consume or replay the challenge.
- The same user and recorder bind idempotently; a different user receives a conflict until an explicit transfer completes.
- Recorder uploads resolve ownership exclusively from the durable binding and its server-issued credential.
- Computer Use operations reject recorder devices before a run or permit is created.
- `My devices` lists only the authenticated user's computers and recorders, with type-specific actions and no secret identifiers.
- A migrated recorder can upload during the transition, and the legacy shared-token entry can be removed after the recorder receives its dedicated credential.

## Consequences

The Android phone becomes the recorder's authentication relay because the current card cannot sign requests. Loss of the phone therefore requires credential revocation and re-enrollment; this release records the relay key but does not yet expose revocation or transfer controls. A short code can be phished while valid, so the Server binds it to one user and the gateway rate-limits attempts.
