# Recorder user-private memory gateway

The recorder token is the credential and durable owner mapping. The phone sends `device_sn`; it never sends a trusted user id. The server hashes `X-Auth-Token`, resolves an exact enterprise `org_id` and `user_id`, verifies the assigned device, and stores transcripts under:

```text
/home/recorder/transcripts/<org_id>/<user_id>/<YYYYMMDD>.jsonl
```

Each record carries `owner_org_id` and `owner_user_id`. `push_to_sunfleck.py` refuses unowned input, copies ownership into Markdown frontmatter, and writes cards under the same owner partition. SUNFLECK then writes the card only to that user's `scope=user` knowledge base.

Public company documents stay in `scope=public` bases. The knowledge plugin filters HTTP listings/search by the authenticated principal and filters Agent tools by the durable owner of the current enterprise Session.

## Registry

`/home/recorder/users.json` contains SHA-256 token digests, never plaintext tokens. Generate one digest without printing the token into shell history:

```bash
python3 -c 'import getpass,hashlib; print(hashlib.sha256(getpass.getpass("token: ").encode()).hexdigest())'
```

## Validation

```bash
python3 -m unittest -v test_gateway.py test_push_to_sunfleck.py
```
