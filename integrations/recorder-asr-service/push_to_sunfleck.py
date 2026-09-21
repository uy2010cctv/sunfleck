"""把转写结果整理成 SUNFLECK 记忆卡片（只用标准库，无需额外依赖）。

定位：分窗、去重、渲染 Markdown 卡片。**不做**摘要/记忆加工——那一步交给
SUNFLECK 里的数字员工（有 LLM 和检索工具）。

用法：
    # 1) 渲染成卡片文件（推荐，配合"外部只产出文本"的设计）
    python3 push_to_sunfleck.py --in transcript.json --out-dir ./cards

    # 2) 只看一眼（不写任何文件）
    python3 push_to_sunfleck.py --in transcript.json --dry-run

⚠️ **HTTP 直写模式已废弃**：SUNFLECK 的 `/knowledge` 接口自
   dsh-knowledge 0.3.11-enterprise.3（2026-09-17）起改为"企业 Session + RBAC"，
   匿名 POST 会返回 401，且没有 API token 通道。外部脚本不应再直连写库。
   正确做法：本脚本产出卡片文件 → 由 SUNFLECK 内的数字员工用
   knowledge_add_document / knowledge_reindex_document 入库。
   下面保留 --endpoint / --base-id 仅为兼容旧流程，且必须自备有效会话 Cookie。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
from urllib import error, request

DEFAULT_ENDPOINT = "http://127.0.0.1:3081"
WINDOW_MINUTES = 30


# ---------------------------------------------------------------------------
# 输入规整：容忍 ASR 服务返回的几种形态
# ---------------------------------------------------------------------------

@dataclass
class Utterance:
    start_ts: float
    end_ts: float
    text: str
    confidence: Optional[float] = None
    bookmarked: bool = False


def load_utterances(payload: Any) -> List[Utterance]:
    """从多种 JSON 形态里提取话语列表。

    兼容：
      * {"results": [{start_ts, end_ts, text, ...}, ...]}   ← app.py 的输出
      * [{"start_ts": ..., "text": ...}, ...]                ← 裸列表
      * {"segments": [...], "anchor_ts": ...}                ← 相对秒数 + 锚点
    相对秒数会通过 anchor_ts（或文件创建时间）折算成墙钟时间。
    """
    items: Iterable[Dict[str, Any]]
    anchor: Optional[float] = None

    if isinstance(payload, dict):
        if "results" in payload:
            items = payload["results"]
        elif "segments" in payload:
            items = payload["segments"]
            anchor = payload.get("anchor_ts")
        else:
            items = [payload]
    elif isinstance(payload, list):
        items = payload
    else:
        raise ValueError("无法识别的输入 JSON 形态")

    out: List[Utterance] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        text = (it.get("text") or "").strip()
        if not text:
            continue                                    # 空段直接丢，别写进库
        has_wall = "start_ts" in it and it.get("start_ts") is not None
        if has_wall:
            start = float(it["start_ts"])
            end = float(it.get("end_ts") or start)
        else:
            base = float(anchor if anchor is not None else it.get("anchor_ts") or time.time())
            start = base + float(it.get("start") or 0.0)
            end = base + float(it.get("end") or 0.0)
        out.append(Utterance(
            start_ts=start,
            end_ts=end,
            text=text,
            confidence=it.get("confidence"),
            bookmarked=bool(it.get("bookmarked")),
        ))
    out.sort(key=lambda u: u.start_ts)
    return out


# ---------------------------------------------------------------------------
# 分窗 + 去重
# ---------------------------------------------------------------------------

def window_key(ts: float, minutes: int = WINDOW_MINUTES) -> str:
    dt = datetime.fromtimestamp(ts)
    start_min = (dt.minute // minutes) * minutes
    return dt.replace(minute=start_min, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M")


def group_windows(utts: List[Utterance], minutes: int = WINDOW_MINUTES):
    buckets: Dict[str, List[Utterance]] = {}
    for u in utts:
        buckets.setdefault(window_key(u.start_ts, minutes), []).append(u)
    return buckets


def dedupe(utts: List[Utterance], tolerance_s: float = 0.75) -> List[Utterance]:
    """折叠"同一句被投递两次"的重复。

    实时流与文件回补两条路会覆盖同一段时间，同一句话可能来两次，且两条路
    给出的时间戳通常差几十毫秒到几百毫秒（不是完全相同）。所以不能只比对
    时间戳是否相等，而要看"文本相同且起点足够接近"。

    容忍窗口刻意取小（默认 0.75 秒）：真人连续说两句相同的话（比如连着两次
    "好"）通常间隔超过这个值，属于真实信息，必须保留。宁可漏折叠，不可错折叠。
    """
    kept: List[Utterance] = []
    for u in utts:
        dup = any(
            k.text == u.text and abs(k.start_ts - u.start_ts) <= tolerance_s
            for k in kept
        )
        if not dup:
            kept.append(u)
    return kept


# ---------------------------------------------------------------------------
# 记忆卡片渲染
# ---------------------------------------------------------------------------

def render_card(window: str, utts: List[Utterance]) -> tuple[str, str]:
    """返回 (标题, Markdown 正文)。"""
    date_part = window.split(" ")[0]
    title = f"[原始] {window}"
    lines = [
        "---",
        f"date: {date_part}",
        f"window: {window}",
        "layer: raw",
        f"utterances: {len(utts)}",
        f"start: {datetime.fromtimestamp(utts[0].start_ts).strftime('%H:%M:%S')}",
        f"end: {datetime.fromtimestamp(utts[-1].end_ts).strftime('%H:%M:%S')}",
        "---",
        "",
        f"# 原始转写 {window}",
        "",
        "> 本文件由录音卡片→本地 ASR 自动生成，未经人工校对。",
        "> ASR 可能误识别专有名词，引用前请核对上下文。",
        "",
    ]
    if any(u.bookmarked for u in utts):
        marks = [u for u in utts if u.bookmarked]
        lines.append("## ⭐ 重点标记")
        for u in marks:
            lines.append(f"- `{_hms(u.start_ts)}` {u.text}")
        lines.append("")
    lines.append("## 转写正文")
    lines.append("")
    for u in utts:
        flag = " ⭐" if u.bookmarked else ""
        conf = ""
        if u.confidence is not None and u.confidence < 0.75:
            conf = f" (低置信 {u.confidence})"
        lines.append(f"- `{_hms(u.start_ts)}–{_hms(u.end_ts)}`{flag}{conf} {u.text}")
    lines.append("")
    return title, "\n".join(lines)


def _hms(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%H:%M:%S")


# ---------------------------------------------------------------------------
# 入库
# ---------------------------------------------------------------------------

def post_document(endpoint: str, base_id: str, title: str, content: str,
                  timeout: float = 60.0) -> Dict[str, Any]:
    url = f"{endpoint.rstrip('/')}/knowledge/bases/{base_id}/documents"
    body = json.dumps({"title": title, "content": content}).encode("utf-8")
    req = request.Request(url, data=body, method="POST",
                          headers={"content-type": "application/json"})
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"无法连接 {url}: {exc.reason}") from exc


def safe_filename(window: str) -> str:
    """把 "2026-09-18 09:00" 变成可安全落盘的文件名。"""
    return window.replace(":", "").replace(" ", "_") + ".md"


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="转写结果 → SUNFLECK 记忆卡片")
    ap.add_argument("--in", dest="infile", required=True, help="转写 JSON 文件，或 - 读 stdin")
    ap.add_argument("--out-dir", help="把卡片写成 .md 文件（推荐；由员工入库）")
    ap.add_argument("--base-id", help="目标知识库 id（仅旧版 HTTP 直写模式需要）")
    ap.add_argument("--endpoint", default=DEFAULT_ENDPOINT,
                    help=f"SUNFLECK 地址，默认 {DEFAULT_ENDPOINT}（仅旧版直写模式）")
    ap.add_argument("--window", type=int, default=WINDOW_MINUTES, help="分窗分钟数，默认 30")
    ap.add_argument("--dry-run", action="store_true", help="只打印卡片，不写任何东西")
    args = ap.parse_args(argv)

    if args.infile == "-":
        raw = sys.stdin.read()
    else:
        with open(args.infile, encoding="utf-8") as fh:
            raw = fh.read()
    payload = json.loads(raw)
    # 兼容 outbox 记录的 {"payload": {"results": [...]}} 外层包装
    if isinstance(payload, dict) and "payload" in payload and "results" not in payload:
        payload = payload["payload"]
    utts = dedupe(load_utterances(payload))
    if not utts:
        print("没有可用话语（空转写），无事可做。", file=sys.stderr)
        return 0

    if not args.dry_run and not args.out_dir and not args.base_id:
        ap.error("需要 --out-dir（推荐）或旧版的 --base-id")

    windows = group_windows(utts, args.window)
    print(f"共 {len(utts)} 句，分为 {len(windows)} 个窗口（{args.window} 分钟/窗）", file=sys.stderr)

    written = 0
    for window in sorted(windows):
        title, content = render_card(window, windows[window])
        if args.dry_run:
            print("=" * 70)
            print(f"# {title}\n{content}")
            continue
        if args.out_dir:
            os.makedirs(args.out_dir, exist_ok=True)
            path = os.path.join(args.out_dir, safe_filename(window))
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(content)
            print(f"已写出 {title} → {path}", file=sys.stderr)
            written += 1
            continue
        try:
            resp = post_document(args.endpoint, args.base_id, title, content)
        except RuntimeError as exc:
            print(f"写入失败 {title}: {exc}", file=sys.stderr)
            print("提示：/knowledge 现在需要企业会话，匿名写入返回 401。"
                  "请改用 --out-dir 由数字员工入库。", file=sys.stderr)
            return 2
        doc_id = (resp.get("value") or {}).get("id", "?")
        print(f"已写入 {title} → {doc_id}", file=sys.stderr)
        written += 1
    if not args.dry_run:
        print(f"完成，共 {written} 篇。", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
