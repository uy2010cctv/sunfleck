"""转写出件箱（Outbox）—— Mac 侧暂存已识别文本，供 47 侧拉取。

**为什么需要它**：SUNFLECK 的 `/knowledge` 接口已从"匿名可写"改为"企业 Session +
RBAC"（dsh-knowledge 0.3.11-enterprise.3）。外部脚本不再能直接写知识库。
于是把方向反过来：

    Mac 只负责产出文本（放在本机出件箱）
    47 侧的 Agent 通过同一条 SSH 反向隧道拉取，用自己的会话写入知识库

好处：
  * Mac 上**不需要任何 SUNFLECK 凭据**（不存 cookie、不存 token）
  * 不需要给 SSH key 开 sftp/shell —— 只靠已经验证过的 `permitlisten` 反向端口
  * 隧道断掉时 Mac 继续积累，47 恢复后按序补拉，不丢数据
  * 拉取成功才 ack 删除，语义是 at-least-once（重复拉取由上游去重兜住）

纯标准库实现，便于单测与跨平台。
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional

# 文件名形如 1737000000123-1a2b3c4d.json
_ID_RE = re.compile(r"^[0-9]{13}-[0-9a-f]{8}$")
_MAX_RECORD_BYTES = 8 * 1024 * 1024


class OutboxError(Exception):
    pass


class BadRecordId(OutboxError):
    """id 不合法。**这是路径穿越防护**：id 必须严格匹配内部生成的格式。"""


@dataclass
class OutboxItem:
    id: str
    created_ts: float
    size: int
    meta: Dict[str, Any] = field(default_factory=dict)


class Outbox:
    """追加式的文件出件箱。每个条目是一个独立 JSON 文件。

    选文件而不是数据库：Mac 侧无需装任何依赖，`ls` 就能排障，
    而且崩溃时最坏只丢最后一个未写完的文件（写入用临时文件 + rename，原子）。
    """

    def __init__(self, root: str) -> None:
        self.root = root
        os.makedirs(self.root, exist_ok=True)

    # -- 内部 -------------------------------------------------------------

    def _path(self, record_id: str) -> str:
        if not _ID_RE.match(record_id or ""):
            raise BadRecordId(f"invalid outbox id: {record_id!r}")
        path = os.path.abspath(os.path.join(self.root, f"{record_id}.json"))
        # 双保险：解析后的路径必须仍在 root 内
        if os.path.dirname(path) != os.path.abspath(self.root):
            raise BadRecordId(f"outbox id escapes root: {record_id!r}")
        return path

    # -- 写 ---------------------------------------------------------------

    def put(self, payload: Any, meta: Optional[Dict[str, Any]] = None) -> str:
        """append 一条记录，返回 id。写入是原子的（临时文件 + rename）。"""
        record_id = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
        body = json.dumps(
            {"id": record_id, "created_ts": time.time(), "meta": meta or {}, "payload": payload},
            ensure_ascii=False,
        ).encode("utf-8")
        if len(body) > _MAX_RECORD_BYTES:
            raise OutboxError(f"record too large: {len(body)} bytes")

        tmp = os.path.join(self.root, f".{record_id}.tmp")
        with open(tmp, "wb") as fh:
            fh.write(body)
            fh.flush()
            os.fsync(fh.fileno())
        os.rename(tmp, self._path(record_id))     # 同分区 rename 是原子的
        return record_id

    # -- 读 ---------------------------------------------------------------

    def list(self, since: Optional[float] = None, limit: Optional[int] = None) -> List[OutboxItem]:
        """按时间升序列出条目（只读目录，不解析正文，便于大 outbox 下也很快）。"""
        items: List[OutboxItem] = []
        for name in os.listdir(self.root):
            if not name.endswith(".json"):
                continue
            record_id = name[:-5]
            if not _ID_RE.match(record_id):
                continue                          # 忽略临时文件与异物
            path = os.path.join(self.root, name)
            try:
                st = os.stat(path)
            except OSError:
                continue                          # 可能正被 rename，跳过
            if since is not None and st.st_mtime <= since:
                continue
            items.append(OutboxItem(id=record_id, created_ts=st.st_mtime, size=st.st_size))
        items.sort(key=lambda i: (i.created_ts, i.id))
        if limit is not None:
            items = items[:limit]
        return items

    def get(self, record_id: str) -> Dict[str, Any]:
        path = self._path(record_id)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except FileNotFoundError as exc:
            raise OutboxError(f"outbox item not found: {record_id}") from exc
        except json.JSONDecodeError as exc:
            raise OutboxError(f"outbox item corrupt: {record_id}") from exc

    def ack(self, record_id: str) -> bool:
        """确认已成功入库后删除。返回是否真的删掉了。"""
        path = self._path(record_id)
        try:
            os.unlink(path)
            return True
        except FileNotFoundError:
            return False

    def stats(self) -> Dict[str, Any]:
        items = self.list()
        return {
            "pending": len(items),
            "bytes": sum(i.size for i in items),
            "oldest_ts": items[0].created_ts if items else None,
            "newest_ts": items[-1].created_ts if items else None,
        }
