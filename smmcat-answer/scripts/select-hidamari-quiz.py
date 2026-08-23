# -*- coding: utf-8 -*-
"""避开已抽出的测试题，从剩余简体中文题分层抽 30 题（高/中/低各 10）。"""
from __future__ import annotations

import html as html_lib
import json
import random
import re
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
ROOT = PLUGIN.parent
HTML_DIR = ROOT / "中文翻译"
OUT_DIR = PLUGIN / "data" / "answerData"
OUT_MAIN = OUT_DIR / "向阳王.json"
OUT_TEST = OUT_DIR / "向阳王测试.json"

FILES = [
    ("hidaking-1_zh.html", "东京会场第1回"),
    ("hidaking-2_zh.html", "东京会场第2回"),
    ("hidaking-3_zh.html", "东京会场第3回"),
    ("hidaking-4_zh.html", "东京会场第4回"),
    ("hidaking-5_zh.html", "大阪会场第1回"),
    ("hidaking-6_zh.html", "大阪会场第2回"),
]

Q_RE = re.compile(
    r'<section class="question" id="q(\d+)">\s*'
    r'<div class="q-head"><span class="q-num">第(\d+)题</span></div>\s*'
    r'<p class="q-text">(.*?)</p>\s*'
    r'<ul class="options">(.*?)</ul>',
    re.S,
)
OPT_RE = re.compile(r'<span class="opt-key">([A-D])</span>(.*?)</li>', re.S)
ANS_RE = re.compile(r"<tr><td>(\d+)</td><td>([A-D])</td></tr>")

SEED = 202608231
NEED = {"low": 10, "medium": 10, "high": 10}
MAIN4 = ("由乃", "宫子", "寻", "沙英")

HIGH_NEEDLES = (
    "DVD", "Blu-ray", "蓝光", "音频评论", "发售", "CD",
    "作曲", "作词", "编曲", "脚本", "分镜", "系列构成", "音响监督",
    "形象歌曲", "角色歌", "广播剧", "特典", "页数", "彩页",
    "单行本", "目前出版", "出版到", "三围", "marble", "micco",
    "副标题", "全名", "真名", "房租", "石膏像", "哭声",
    "第一次登场", "首次出场", "同一天发售", "墙壁上画",
    "绳子", "门牌", "家庭菜园", "借物赛跑", "广播体操",
    "第几卷", "多少页", "多少本", "多少张", "第几集",
    "赞助商", "四格漫画的标题", "小说版", "播出形式",
    "片尾曲", "片头曲", "角色歌",
)


def unescape(s: str) -> str:
    s = html_lib.unescape(s)
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_ask(s: str) -> str:
    return re.sub(r"\s+", "", s)


def parse_file(path: Path, source: str) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    answers = {int(n): k for n, k in ANS_RE.findall(text)}
    items = []
    for _qid, qnum, ask_html, opts_html in Q_RE.findall(text):
        n = int(qnum)
        opts = {k: unescape(v) for k, v in OPT_RE.findall(opts_html)}
        if len(opts) != 4:
            raise SystemExit(f"{path.name} Q{n}: expected 4 options, got {opts}")
        key = answers.get(n)
        if key not in opts:
            raise SystemExit(f"{path.name} Q{n}: missing answer {key}")
        items.append(
            {
                "source": source,
                "num": n,
                "ask": unescape(ask_html),
                "column": [opts["A"], opts["B"], opts["C"], opts["D"]],
                "susses": opts[key],
            }
        )
    if len(items) != 100:
        raise SystemExit(f"{path.name}: expected 100, got {len(items)}")
    return items


def classify(q: dict) -> str:
    ask = q["ask"]
    blob = ask + "｜" + "｜".join(q["column"])
    if any(n in blob for n in HIGH_NEEDLES):
        return "high"
    if re.search(r"第\d+期|第\d+话|第\d+卷|第\d+集", ask):
        return "high"
    if "颜色" in ask:
        return "high"
    if re.search(r"什么时候|哪一天|几月", ask) and re.search(r"\d+月", blob):
        return "high"
    m = re.search(r"为(.{1,12}?)配音", ask)
    if m:
        who = m.group(1).strip()
        if re.fullmatch(r"(由乃|宫子|寻|沙英)", who):
            return "low"
        return "high"
    if re.search(r"现在[，,]?住在向阳庄\d{3}", ask):
        return "low"
    if re.search(r"住在向阳庄\d{3}号?(房间|室)的是谁", ask):
        return "low"
    if "年纪最小" in ask or "年纪最大" in ask:
        return "low"
    if "戴眼镜" in ask:
        return "low"
    if "减肥" in ask and "寻" in ask:
        return "low"
    if "班主任老师" in ask and "座位" not in ask:
        return "low"
    if "个子最高" in ask or "个子最矮" in ask:
        return "low"
    if re.search(r"怎么称呼", ask) and any(c in ask for c in MAIN4):
        return "low"
    if "正下方" in ask or "正上方" in ask:
        return "low"
    if re.search(r"(原作者|作者).{0,8}(是谁|叫什么)", ask):
        return "low"
    return "medium"


def to_bot_item(q: dict, idx: int) -> dict:
    mark = {"low": 1, "medium": 2, "high": 3}[q["difficulty"]]
    return {
        "id": idx,
        "mark": mark,
        "ask": q["ask"],
        "more": {},
        "susses": [q["susses"]],
        "column": q["column"],
    }


def load_exclude() -> set[str]:
    used: set[str] = set()
    if OUT_TEST.is_file():
        data = json.loads(OUT_TEST.read_text(encoding="utf-8"))
        for item in (data.get("content") or {}).values():
            used.add(norm_ask(item.get("ask") or ""))
    return used


def main() -> None:
    exclude = load_exclude()
    all_q: list[dict] = []
    for fname, source in FILES:
        all_q.extend(parse_file(HTML_DIR / fname, source))

    seen: set[str] = set()
    unique: list[dict] = []
    for q in all_q:
        key = norm_ask(q["ask"])
        if key in seen or key in exclude:
            continue
        seen.add(key)
        q["difficulty"] = classify(q)
        unique.append(q)

    buckets: dict[str, list[dict]] = {"low": [], "medium": [], "high": []}
    for q in unique:
        buckets[q["difficulty"]].append(q)

    log = OUT_DIR.parent.parent / "scripts" / "stratify-log.txt"
    lines = [
        f"excluded={len(exclude)} unique_left={len(unique)}",
        f"pool low={len(buckets['low'])} medium={len(buckets['medium'])} high={len(buckets['high'])}",
        "=== low ===",
    ]
    for q in buckets["low"]:
        lines.append(f"  [{q['source']} Q{q['num']:03d}] {q['ask']}")
    log.write_text("\n".join(lines) + "\n", encoding="utf-8")

    rng = random.Random(SEED)
    selected: list[dict] = []
    for k, n in NEED.items():
        if len(buckets[k]) < n:
            raise SystemExit(
                f"not enough {k}: {len(buckets[k])} < {n}\n" + "\n".join(lines[:40])
            )
        rng.shuffle(buckets[k])
        selected.extend(buckets[k][:n])
    rng.shuffle(selected)

    bank = {
        "msg": "向阳素描一次考试精选 · 共30题（低/中/高各10题，已打乱；不含已抽出的测试题）。低1分、中2分、高3分。群内：/开始抢答 向阳王",
        "guild": "向阳王",
        "pic": "",
        "content": {str(i): to_bot_item(q, i) for i, q in enumerate(selected)},
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_MAIN.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    order = "".join({"low": "L", "medium": "M", "high": "H"}[q["difficulty"]] for q in selected)
    summary = log.read_text(encoding="utf-8") + f"\norder={order}\n"
    for i, q in enumerate(selected):
        summary += f"{i:02d} {q['difficulty'][0].upper()} [{q['source']} Q{q['num']}] {q['ask']}\n"
    log.write_text(summary, encoding="utf-8")


if __name__ == "__main__":
    main()
