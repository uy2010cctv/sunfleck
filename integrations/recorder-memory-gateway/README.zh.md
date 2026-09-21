# 录音卡用户私有记忆网关

[English](README.md) | 中文

录音卡 token 是凭据和持久所有者映射。手机只发送 `device_sn`，不能提交可信用户 id。服务端计算 `X-Auth-Token` 哈希，解析唯一的企业 `org_id` 和 `user_id`，校验已分配设备，并按以下路径保存转写：

```text
/home/recorder/transcripts/<org_id>/<user_id>/<YYYYMMDD>.jsonl
```

每条记录携带 `owner_org_id` 和 `owner_user_id`。`push_to_sunfleck.py` 拒绝没有所有者的输入，把所有者写入 Markdown frontmatter，并在同一所有者分区中生成卡片。SUNFLECK 只把卡片写入该用户的 `scope=user` 知识库。

网关维护 SQLite 段账本。同一 `segment_id` 和音频指纹的重试会返回已保存结果；同一 id 对应不同音频时返回冲突。归档 JSONL 保存段元数据和音频摘要，不保存 base64 PCM。

`recorder_memory_worker.py` 扫描按所有者分区的转写 JSONL，通过持久本地确认表把每个新结果提交到 DSH `/recorder-memory/ingest`。DSH 写入失败时不会确认消费，并会继续重试。只有在 DSH bridge 已部署且 `DSH_RECORDER_INGEST_TOKEN` 已配置后，才安装 `recorder-memory-worker.service`。

`POST /v1/bind_recorder` 把六位用户绑定码、录音卡序列号和 Android 中继公钥转发到本机 DSH 录音卡绑定端点。DSH 解析绑定码所有者后，网关只保存返回凭据的摘要，并且只向 App 返回一次明文凭据。

公共企业文档继续位于 `scope=public` 知识库。knowledge 插件按认证主体过滤 HTTP 列表和搜索，并按当前企业 Session 的持久所有者过滤 Agent 工具。

## Registry

`/home/recorder/users.json` 只保存 SHA-256 token 摘要，不保存明文 token。以下命令不会把 token 写入 shell 历史：

```bash
python3 -c 'import getpass,hashlib; print(hashlib.sha256(getpass.getpass("token: ").encode()).hexdigest())'
```

## Validation

```bash
python3 -m unittest -v test_gateway.py test_push_to_sunfleck.py
```
