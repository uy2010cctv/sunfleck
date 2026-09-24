# Recorder user-private memory gateway

English | [中文](README.zh.md)

The recorder token is the credential and durable owner mapping. The phone sends `device_sn`; it never sends a trusted user id. The server hashes `X-Auth-Token`, resolves an exact enterprise `org_id` and `user_id`, verifies the assigned device, and stores transcripts under:

```text
/home/recorder/transcripts/<org_id>/<user_id>/<YYYYMMDD>.jsonl
```

Each record carries `owner_org_id` and `owner_user_id`. `push_to_sunfleck.py` refuses unowned input, copies ownership into Markdown frontmatter, and writes cards under the same owner partition. SUNFLECK then writes the card only to that user's `scope=user` knowledge base.

The gateway keeps a SQLite segment ledger. A retry with the same `segment_id` and audio fingerprint replays the stored result; reusing an id for different audio returns a conflict. Archived JSONL contains segment metadata and the audio digest, not base64 PCM.

`recorder_memory_worker.py` advances a durable byte cursor through each owner-partitioned transcript JSONL and stores parsed segments in one reusable SQLite connection. It retries failed `/recorder-memory/ingest` writes, marks only ids included in a successful `/recorder-memory/process` request, and processes the oldest backlog in bounded owner windows. The `indexed_v1` and `processed_v2` generations intentionally replay legacy acknowledgements once into the indexed DSH timeline and corrected processing ledger. Install `recorder-memory-worker.service` only after the DSH bridge is deployed and `DSH_RECORDER_INGEST_TOKEN` is configured. `RECORDER_MEMORY_INGEST_BATCH_SIZE`, `RECORDER_MEMORY_CONTEXT_SECONDS`, and `RECORDER_MEMORY_PROCESS_BATCH_SIZE` configure bounded work per poll.

`POST /v1/bind_recorder` forwards a six-digit user challenge, recorder serial number, and Android relay public key to the local DSH recorder-binding endpoint. After DSH resolves the challenge owner, the gateway stores only the returned credential digest and returns the plaintext credential once to the App.

Public company documents stay in `scope=public` bases. The knowledge plugin filters HTTP listings/search by the authenticated principal and filters Agent tools by the durable owner of the current enterprise Session.

## Registry

`/home/recorder/users.json` contains SHA-256 token digests, never plaintext tokens. Generate one digest without printing the token into shell history:

```bash
python3 -c 'import getpass,hashlib; print(hashlib.sha256(getpass.getpass("token: ").encode()).hexdigest())'
```

## Validation

```bash
python3 -m unittest -v test_gateway.py test_push_to_sunfleck.py test_recorder_memory_worker.py
```
