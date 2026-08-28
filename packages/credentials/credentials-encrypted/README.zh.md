---
description: "AES-256-GCM enterprise credential provider with online key rotation。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-credentials-encrypted`

[English](README.md) | 中文

## 概述

AES-256-GCM enterprise credential provider with online key rotation。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

企业 `CredentialProvider`：使用 AES-256-GCM Envelope、按地址绑定的 Associated Data、owner-only 原子文件、环境变量优先级、不透明 CredentialRecord 和在线密钥轮换。Master Key 由部署环境提供，绝不与 Ciphertext 一起写入。

## Model Experience

### 凭据解析

#### What the model sees

无。`EncryptedCredentialProvider` 只在 Host 操作边界解析密钥，不通过模型 Message 或 Schema 暴露值。

#### Token effect

零 Token。密钥解析保持在模型 Message 边界之下。

#### KV Cache effect

无；凭据轮换改变传输授权，不改变已组装请求文本。

## Known Limitations and Deferred Work

- 密钥托管属于部署方的 Secret Manager；本包不会把同盘 Key File 伪称为企业 KMS。
- 在所有 Envelope 都使用当前 Key ID 重新加密之前，轮换需要保留每个旧密钥。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
