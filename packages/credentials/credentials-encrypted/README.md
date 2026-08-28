---
description: "AES-256-GCM enterprise credential provider with online key rotation."
kind: "package-reference"
---
# `@deepseek-ai/dsh-credentials-encrypted`

English | [中文](README.zh.md)

## Summary

AES-256-GCM enterprise credential provider with online key rotation.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Enterprise `CredentialProvider` using AES-256-GCM envelopes, per-address associated data, owner-only atomic files, environment precedence, opaque credential records, and online key rotation. Master keys are supplied by deployment environment and never written beside ciphertext.

## Model Experience

### Credential resolution

#### What the model sees

Nothing. `EncryptedCredentialProvider` resolves secrets only at Host operation boundaries and never exposes values through model messages or schemas.

#### Token effect

Zero tokens. Secret resolution remains below the model-message boundary.

#### KV Cache effect

None; credential rotation changes transport authorization, not assembled request text.

## Known Limitations and Deferred Work

- Key custody belongs to the deployment secret manager; the package does not pretend a colocated key file is enterprise KMS.
- Rotation requires every old key until all envelopes have been re-encrypted under the current key id.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
