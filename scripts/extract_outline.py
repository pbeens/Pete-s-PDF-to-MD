#!/usr/bin/env python3
import argparse
import difflib
import json
import math
import re
from pathlib import Path

import fitz


def slugify(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return (value or "section")[:64]


def clean_line(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()


def clean_paragraph(text: str) -> str:
    lines = [clean_line(line) for line in text.splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        return ""
    return " ".join(lines)


def percentile(values, pct: float):
    if not values:
        return 0.0
    values = sorted(values)
    idx = max(0, min(len(values) - 1, int(math.floor((len(values) - 1) * pct))))
    return values[idx]


def build_outline_from_toc(doc):
    toc = doc.get_toc(simple=True)
    entries = []
    for item in toc:
        if len(item) < 3:
            continue
        level, title, page = item[0], clean_line(str(item[1])), int(item[2])
        if not title:
            continue
        entries.append(
            {
                "level": max(1, int(level)),
                "title": title,
                "page_start": max(1, page),
                "source": "pdf-outline",
                "y0": None,
            }
        )
    return entries


def normalize_match_text(value: str) -> str:
    value = clean_line(str(value or "")).lower()
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return clean_line(value)


def repair_mojibake(text: str) -> str:
    replacements = {
        "ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢": "â€¢",
        "Ã¢â‚¬Â¢": "â€¢",
        "Ã¢â‚¬â€œ": "â€“",
        "Ã¢â‚¬â€": "â€”",
        "Ã¢â‚¬Ëœ": "â€˜",
        "Ã¢â‚¬â„¢": "â€™",
        "Ã¢â‚¬Å“": "â€œ",
        "Ã¢â‚¬Â": "â€",
        "Ã¢â‚¬Â¦": "â€¦",
        "Ã‚ ": " ",
        "Ã‚": "",
    }
    out = text
    for bad, good in replacements.items():
        out = out.replace(bad, good)
    return out


def normalize_outline(outline: list[dict]) -> list[dict]:
    if not outline:
        return outline

    cleaned = []
    recent_entries = []
    prev_level = 1
    last_page = 1

    for item in outline:
        title = clean_line(item.get("title", ""))
        if not title:
            continue
        title_norm = normalize_match_text(title)
        page_start = max(last_page, int(item.get("page_start") or last_page))
        level = max(1, int(item.get("level") or 1))
        if cleaned:
            level = min(level, prev_level + 1)

        is_near_repeat = any(
            prev_title == title_norm and abs(page_start - prev_page) <= 2
            for prev_title, prev_page in recent_entries[-8:]
        )
        same_page_repeat = (
            bool(cleaned)
            and cleaned[-1]["page_start"] == page_start
            and normalize_match_text(cleaned[-1]["title"]) == title_norm
        )
        if same_page_repeat or is_near_repeat:
            continue

        row = dict(item)
        row["title"] = title
        row["page_start"] = page_start
        row["level"] = level
        cleaned.append(row)
        recent_entries.append((title_norm, page_start))
        prev_level = level
        last_page = page_start

    return cleaned


def build_margin_noise_profile(doc):
    top_counts = {}
    bottom_counts = {}
    min_repeat = max(3, int(math.ceil(doc.page_count * 0.15)))

    for page_no in range(1, doc.page_count + 1):
        page = doc.load_page(page_no - 1)
        payload = page.get_text("dict")
        page_height = float(page.rect.height)
        top_band = page_height * 0.10
        bottom_band = page_height * 0.90

        for block in payload.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                parts = []
                for span in line.get("spans", []):
                    text = clean_line(span.get("text", ""))
                    if text:
                        parts.append(text)
                merged = clean_line(" ".join(parts))
                if not merged:
                    continue

                bbox = line.get("bbox", [0, 0, 0, 0])
                y0 = float(bbox[1])
                y1 = float(bbox[3])
                norm = normalize_match_text(merged)
                if not norm:
                    continue

                if y0 <= top_band:
                    top_counts.setdefault(norm, set()).add(page_no)
                if y1 >= bottom_band:
                    bottom_counts.setdefault(norm, set()).add(page_no)

    repeated_top = {text for text, pages in top_counts.items() if len(pages) >= min_repeat and len(text) >= 4}
    repeated_bottom = {text for text, pages in bottom_counts.items() if len(pages) >= min_repeat and len(text) >= 4}
    return {"top": repeated_top, "bottom": repeated_bottom}


def infer_toc_heading_positions(doc, outline):
    if not outline:
        return outline

    lines_by_page = {}

    def page_lines(page_no: int):
        if page_no in lines_by_page:
            return lines_by_page[page_no]

        page = doc.load_page(page_no - 1)
        payload = page.get_text("dict")
        rows = []
        for block in payload.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                parts = []
                for span in line.get("spans", []):
                    text = clean_line(span.get("text", ""))
                    if text:
                        parts.append(text)
                merged = clean_line(" ".join(parts))
                if not merged:
                    continue
                y0 = float(line.get("bbox", [0, 0, 0, 0])[1])
                rows.append(
                    {
                        "y0": y0,
                        "text": merged,
                        "norm": normalize_match_text(merged),
                    }
                )

        rows.sort(key=lambda item: item["y0"])
        lines_by_page[page_no] = rows
        return rows

    grouped = {}
    for idx, entry in enumerate(outline):
        page_no = int(entry.get("page_start") or 1)
        grouped.setdefault(page_no, []).append(idx)

    for page_no, indices in grouped.items():
        rows = page_lines(page_no)
        if not rows:
            continue

        last_y = -1e9
        for idx in indices:
            entry = outline[idx]
            if entry.get("y0") is not None:
                last_y = float(entry["y0"])
                continue

            title_norm = normalize_match_text(entry.get("title", ""))
            if not title_norm:
                continue

            candidates = []
            for row in rows:
                row_norm = row["norm"]
                if not row_norm:
                    continue
                exact = row_norm == title_norm
                contains = title_norm in row_norm and len(title_norm) >= 6
                contained_by = row_norm in title_norm and len(row_norm) >= 8
                if exact or contains or contained_by:
                    after_prev = row["y0"] >= (last_y - 0.5)
                    score = (
                        0 if exact else 1,
                        0 if after_prev else 1,
                        abs(row["y0"] - max(last_y, 0.0)),
                        row["y0"],
                    )
                    candidates.append((score, row))

            if not candidates:
                continue

            candidates.sort(key=lambda item: item[0])
            chosen = candidates[0][1]
            entry["y0"] = float(chosen["y0"])
            last_y = float(chosen["y0"])

    return outline


def build_outline_heuristic(doc):
    spans = []
    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        payload = page.get_text("dict")
        for block in payload.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                parts = []
                font_size = 0.0
                for span in line.get("spans", []):
                    text = clean_line(span.get("text", ""))
                    if not text:
                        continue
                    parts.append(text)
                    font_size = max(font_size, float(span.get("size", 0.0)))
                merged = clean_line(" ".join(parts))
                if merged:
                    spans.append(
                        {
                            "page_start": page_index + 1,
                            "text": merged,
                            "size": font_size,
                            "y0": float(line.get("bbox", [0, 0, 0, 0])[1]),
                        }
                    )

    if not spans:
        return []

    all_sizes = [s["size"] for s in spans if s["size"] > 0]
    if not all_sizes:
        return []

    cutoff = max(percentile(all_sizes, 0.75), percentile(all_sizes, 0.5) + 1.0)

    candidates = []
    seen = set()
    for row in spans:
        text = row["text"]
        if len(text) < 4 or len(text) > 120:
            continue
        if text.startswith(("â€¢", "-", "*")):
            continue
        if row["size"] < cutoff:
            continue
        if text.endswith(".") and len(text.split()) > 8:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        candidates.append(row)

    if not candidates:
        return []

    candidates.sort(key=lambda x: (x["page_start"], x.get("y0") if x.get("y0") is not None else 1e9))

    continuation_tail_words = {"for", "and", "or", "to", "in", "on", "of", "with", "program", "course", "grade"}

    # Merge wrapped heading lines split across adjacent lines on the same page.
    merged = []
    idx = 0
    while idx < len(candidates):
        current = dict(candidates[idx])
        while idx + 1 < len(candidates):
            nxt = candidates[idx + 1]
            same_page = current["page_start"] == nxt["page_start"]
            similar_size = abs(current["size"] - nxt["size"]) <= 0.2
            close_y = abs(float(nxt.get("y0", 0.0)) - float(current.get("y0", 0.0))) <= 90.0
            current_tail = current["text"].split()[-1].lower() if current["text"].split() else ""
            next_first = nxt["text"].split()[0] if nxt["text"].split() else ""
            next_starts_lower = bool(next_first) and next_first[0].islower()
            next_is_continuation_word = next_first.lower() in {"and", "or", "for", "to", "in", "of", "the"} if next_first else False
            current_words = current["text"].split()
            next_words = nxt["text"].split()
            likely_wrapped_title = (
                len(current_words) >= 6
                and len(next_words) <= 8
                and not re.search(r"[\\.:;!?]$", current["text"])
                and ("," in nxt["text"] or len(current["text"]) >= 35 or next_is_continuation_word)
            )
            looks_wrapped = (
                same_page
                and similar_size
                and close_y
                and not re.search(r"[\\.:;!?]$", current["text"])
                and (
                    (
                        len(current["text"].split()) <= 6
                        and len(nxt["text"].split()) <= 6
                        and (
                            next_starts_lower
                            or current_tail in continuation_tail_words
                            or current["text"].endswith("-")
                            or next_is_continuation_word
                        )
                    )
                    or likely_wrapped_title
                )
            )
            if looks_wrapped:
                current["text"] = f"{current['text']} {nxt['text']}"
                idx += 1
            else:
                break
        merged.append(current)
        idx += 1

    candidates = merged

    unique_sizes = sorted({round(c["size"], 1) for c in candidates}, reverse=True)
    size_to_level = {size: min(3, i + 1) for i, size in enumerate(unique_sizes)}

    outline = []
    for row in candidates:
        lvl = size_to_level.get(round(row["size"], 1), 2)
        outline.append(
            {
                "level": lvl,
                "title": row["text"],
                "page_start": row["page_start"],
                "source": "text-heuristic",
                "y0": row.get("y0"),
            }
        )

    outline.sort(key=lambda x: (x["page_start"], x.get("y0") if x.get("y0") is not None else 1e9, x["level"], x["title"].lower()))
    return outline


def improve_readability(text: str) -> str:
    out = repair_mojibake(text)
    out = re.sub(r"(?im)^\W*extract\s+\d+\s*", "", out)
    out = re.sub(r"(?im)^[-*\u2022]\s*", "- ", out)
    # Plain inline marker: "Parents 1 play ..." -> "Parents <sup>1</sup> play ..."
    out = re.sub(r"(?<=\w)\s(\d{1,3})(?=\s+[a-z])", r" <sup>\1</sup>", out)
    # Footnote markers at the beginning of a line: "1 The word..." -> "<sup>1</sup> The word..."
    # Avoid converting table-like rows such as "19 | Header ...".
    out = re.sub(r"(?m)^(\d{1,3})\s+(?!\|)", r"<sup>\1</sup> ", out)
    # Inline footnote markers attached to punctuation: "...strategies;6 " -> "...strategies;<sup>6</sup> "
    out = re.sub(r"([;:,\.\)])(\d{1,3})(?=\s)", r"\1<sup>\2</sup>", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out

def attach_missing_footnote_markers(text: str) -> str:
    paragraphs = [p for p in text.split("\n\n") if p.strip()]
    if len(paragraphs) < 2:
        return text

    for idx in range(1, len(paragraphs)):
        match = re.match(r"^\s*<sup>(\d{1,3})</sup>\s+", paragraphs[idx])
        if not match:
            continue
        num = match.group(1)
        prev = paragraphs[idx - 1]
        if f"<sup>{num}</sup>" in prev:
            continue
        paragraphs[idx - 1] = prev.rstrip() + f" <sup>{num}</sup>"

    return "\n\n".join(paragraphs)


def normalize_footnote_block_breaks(text: str) -> str:
    # If a footnote definition line is followed by a lowercase continuation on the next line,
    # split it into separate paragraphs so reordering and stitching can handle it.
    return re.sub(r"(?m)(<sup>\d{1,3}</sup>[^\n]*)\n([a-z])", r"\1\n\n\2", text)


def move_footnote_definitions_to_end(text: str) -> str:
    paragraphs = [p for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        return text

    footnote_pat = re.compile(r"^\s*<sup>\d{1,3}</sup>\s+")
    body = [p for p in paragraphs if not footnote_pat.match(p)]
    footnotes = [p for p in paragraphs if footnote_pat.match(p)]

    combined = body + footnotes
    return "\n\n".join(combined)


def format_dot_leader_blocks(text: str) -> str:
    lines = text.splitlines()
    out = []
    i = 0
    item_re = re.compile(
        r"^\s*(.+?)\s*(?:\.{3,}|(?:\.\s*){3,})\s*(?:<sup>)?(\d{1,3})(?:</sup>)?\s*$"
    )

    while i < len(lines):
        j = i
        rows = []
        consumed_any = False
        while j < len(lines):
            line = lines[j]
            if not line.strip():
                if consumed_any:
                    j += 1
                    continue
                break
            m = item_re.match(line)
            if not m:
                break
            consumed_any = True
            rows.append((m.group(1).strip(), m.group(2)))
            j += 1

        if len(rows) >= 3:
            out.append("| Section | Page |")
            out.append("|---|---:|")
            for title, page in rows:
                safe_title = title.replace("|", "\\|")
                out.append(f"| {safe_title} | {page} |")
            out.append("")
            i = j
            continue

        out.append(lines[i])
        i += 1

    return "\n".join(out)


def parse_course_rows_from_flat(flat: str) -> list[dict]:
    code_re = re.compile(r"\b[A-Z]{3}\d[A-Z]\b")
    type_re = re.compile(r"\b(Open|University|College)\b")
    grade_re = re.compile(r"\b(10|11|12)\b")
    prereq_re = re.compile(r"^(None|Grade\s+11\s+Introduction\s+to\s+Computer\s+(?:Science|Programming),\s*(?:University|College))\b")

    codes = list(code_re.finditer(flat))
    if len(codes) < 3:
        return []

    rows = []
    prev_cut = 0

    for idx, code_match in enumerate(codes):
        code = code_match.group(0)
        next_start = codes[idx + 1].start() if idx + 1 < len(codes) else len(flat)
        left = flat[prev_cut:code_match.start()].strip()
        right = flat[code_match.end():next_start].strip()
        prev_cut = code_match.end()

        left_grade_matches = list(grade_re.finditer(left))
        left_type_matches = list(type_re.finditer(left))
        if not left_grade_matches or not left_type_matches:
            continue

        grade = left_grade_matches[-1].group(1)
        type_match = left_type_matches[-1]
        course_type = type_match.group(1)

        grade_start = left_grade_matches[-1].start()
        name_before = left[grade_start + len(grade):type_match.start()].strip()
        name_before = re.sub(r"^(Course\s+Name\s+Course\s+Type\s+Course\s+Code\s+Prerequisite)\s*", "", name_before).strip()

        prereq = ""
        name_after = right
        pm = prereq_re.match(right)
        if pm:
            prereq = pm.group(1)
            name_after = right[pm.end():].strip()
        else:
            prereq = "None" if "None" in right else ""

        name_after = re.sub(r"\s+\b(10|11|12)\b\s+[A-Za-z][A-Za-z\s\-]+(?:Open|University|College)\s*$", "", name_after).strip()

        course_name = name_before if name_before else name_after
        course_name = re.sub(r"\s+", " ", course_name).strip(" ,;")
        course_name = re.sub(r"\s+\b(10|11|12)\b\s+(Open|University|College)\s*$", "", course_name).strip()
        if not course_name:
            course_name = "(unknown)"
        if not prereq:
            prereq = "(unspecified)"

        rows.append(
            {
                "grade": grade,
                "course_name": course_name,
                "course_type": course_type,
                "course_code": code,
                "prerequisite": prereq,
            }
        )

    return rows


def format_course_table_blocks(text: str) -> str:
    if "Course Name" not in text or "Course Type" not in text or "Course Code" not in text:
        return text

    table_hdr_re = re.compile(
        r"Grade\s*\n+\s*Course Name\s*\n+\s*Course Type\s*\n+\s*Course Code[^\n]*",
        flags=re.IGNORECASE,
    )
    m = table_hdr_re.search(text)
    if not m:
        return text

    end_note = text.find("\n\nNote:", m.end())
    block_end = end_note if end_note != -1 else len(text)
    block = text[m.start():block_end]
    flat = re.sub(r"\s+", " ", block).strip()
    prereq_idx = flat.lower().find("prerequisite")
    data_flat = flat[prereq_idx + len("prerequisite"):].strip() if prereq_idx != -1 else flat

    rows = parse_course_rows_from_flat(data_flat)
    if len(rows) < 3:
        return text

    table_lines = [
        "| Grade | Course | Type | Code | Prerequisite |",
        "|---:|---|---|---|---|",
    ]
    for row in rows:
        c_name = row["course_name"].replace("|", "\\|")
        pre = row["prerequisite"].replace("|", "\\|")
        table_lines.append(
            f"| {row['grade']} | {c_name} | {row['course_type']} | {row['course_code']} | {pre} |"
        )

    table_md = "\n".join(table_lines)
    replaced = text[:m.start()] + table_md + text[block_end:]
    return replaced


def fix_as_follows_bullet_lists(text: str) -> str:
    lines = text.splitlines()
    out = []
    i = 0
    strand_line_re = re.compile(r"^\s*(?:[-*]\s+)?([A-Z]\.\s+.+?)\s*(?:\u2022)?\s*$")

    while i < len(lines):
        out.append(lines[i])
        trigger = lines[i].strip().lower().endswith("as follows:")
        i += 1
        if not trigger:
            continue

        while i < len(lines):
            raw = lines[i]
            stripped = raw.strip()

            if not stripped:
                out.append(raw)
                i += 1
                continue

            # Stop at headings or table rows.
            if stripped.startswith("#") or stripped.startswith("|"):
                break

            match = strand_line_re.match(raw)
            if not match:
                break

            item = clean_line(match.group(1))
            out.append(f"- {item}")
            i += 1

    return "\n".join(out)


def remove_redundant_table_header_lines(text: str) -> str:
    if "|" not in text:
        return text
    # Remove standalone table-header labels that were extracted as plain text
    # above/between table blocks.
    noise_re = re.compile(
        r"(?im)(?:^|\n\n)Categories\s*\n\s*Level\s*1\s*\n\s*Level\s*2\s*\n\s*Level\s*3\s*\n\s*Level\s*4\s*(?=\n\n|\n\||$)"
    )
    cleaned = noise_re.sub("\n\n", text)
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def remove_duplicate_markdown_table_headers(text: str) -> str:
    lines = text.splitlines()
    if not lines:
        return text

    header_line = "| Categories | Level 1 | Level 2 | Level 3 | Level 4 |"
    sep_line = "|---|---|---|---|---|"
    out = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        next_line = lines[i + 1].strip() if i + 1 < len(lines) else ""
        if line == header_line and next_line == sep_line:
            # Only drop header blocks that are duplicated inside an existing table.
            # Keep headers that start a new table section after non-table text.
            prev_nonempty = ""
            for j in range(len(out) - 1, -1, -1):
                probe = out[j].strip()
                if probe:
                    prev_nonempty = probe
                    break

            next_nonempty = ""
            for j in range(i + 2, len(lines)):
                probe = lines[j].strip()
                if probe:
                    next_nonempty = probe
                    break

            duplicated_inside_table = prev_nonempty.startswith("|") and next_nonempty.startswith("|")
            if duplicated_inside_table:
                i += 2
                continue
        out.append(lines[i])
        i += 1

    return "\n".join(out)


def strip_footnote_prefix_from_table_rows(text: str) -> str:
    # Footnote markers sometimes bleed into the first table row as:
    # "<sup>19</sup> | ...", which breaks markdown table parsing.
    return re.sub(r"(?m)^<sup>\d{1,3}</sup>\s+(?=\|)", "", text)


def strip_inline_sup_markers(text: str) -> str:
    out = re.sub(r"</?sup>", "", text)
    out = re.sub(r"(?m)^\s*\d{1,3}\s+(?=\|)", "", out)
    return out


def split_inline_bullet_runs(text: str) -> str:
    lines = text.splitlines()
    out = []
    for raw in lines:
        line = raw.strip()
        if (
            not line
            or line.startswith("#")
            or line.startswith("|")
            or line.startswith("* ")
        ):
            out.append(raw)
            continue

        working = line
        if working.startswith("- "):
            working = working[2:].strip()

        if "•" not in working:
            out.append(raw)
            continue

        parts = [clean_line(p) for p in re.split(r"\s*•\s*", working) if clean_line(p)]
        if len(parts) < 2:
            out.append(raw)
            continue
        out.extend([f"- {part}" for part in parts])
    return "\n".join(out)


def strip_remaining_bullet_glyphs(text: str) -> str:
    out = re.sub(r"\s*•\s*", " ", text)
    out = re.sub(r"[ \t]{2,}", " ", out)
    return out


def deduplicate_body_paragraphs(text: str) -> str:
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        return text

    kept = []
    seen_exact = set()
    seen_by_prefix = {}

    def is_candidate(para: str) -> bool:
        if para.startswith("|") or para.startswith("#"):
            return False
        if para.startswith("- Level:") or para.startswith("- Pages:") or para.startswith("- Source:"):
            return False
        return len(para) >= 80 and len(para.split()) >= 12

    for para in paragraphs:
        norm = normalize_match_text(para)
        if not norm:
            continue
        if not is_candidate(para):
            kept.append(para)
            continue

        if norm in seen_exact:
            continue

        prefix = " ".join(norm.split()[:10])
        near_dup = False
        for prev in seen_by_prefix.get(prefix, []):
            if difflib.SequenceMatcher(None, prev, norm).ratio() >= 0.94:
                near_dup = True
                break
        if near_dup:
            continue

        seen_exact.add(norm)
        seen_by_prefix.setdefault(prefix, []).append(norm)
        kept.append(para)

    if not kept:
        return "(No extractable text in this range.)"
    return "\n\n".join(kept)


def build_toc_markdown_table(rows: list[dict]) -> str:
    if not rows:
        return ""

    table = ["## Table of Contents", "", "| Section | Page |", "|---|---:|"]
    seen = set()
    for row in rows:
        title = clean_line(row.get("title", ""))
        page = int(row.get("start") or row.get("page_start") or 1)
        if not title:
            continue
        sig = (normalize_match_text(title), page)
        if sig in seen:
            continue
        seen.add(sig)
        safe_title = title.replace("|", "\\|")
        table.append(f"| {safe_title} | {page} |")
    table.append("")
    return "\n".join(table)


def stitch_orphan_continuations(text: str) -> str:
    paragraphs = [p for p in text.split("\n\n") if p.strip()]
    if len(paragraphs) < 2:
        return text

    i = 1
    while i < len(paragraphs):
        p = paragraphs[i].lstrip()
        if p and p[0].islower():
            merged = False
            # Prefer attaching to the nearest paragraph that ends with a footnote marker.
            for j in range(i - 1, -1, -1):
                if re.search(r"</sup>\s*$", paragraphs[j].rstrip()):
                    paragraphs[j] = paragraphs[j].rstrip() + " " + p
                    del paragraphs[i]
                    merged = True
                    break
            if not merged and i > 0 and not re.search(r"[.!?]\s*$", paragraphs[i - 1].rstrip()):
                paragraphs[i - 1] = paragraphs[i - 1].rstrip() + " " + p
                del paragraphs[i]
                merged = True
            if merged:
                continue
        i += 1

    return "\n\n".join(paragraphs)


def rebalance_cross_section_footnotes(sections: list[dict]) -> None:
    footnote_def_re = re.compile(r"^\s*<sup>(\d{1,3})</sup>\s+")

    for i in range(1, len(sections)):
        prev_body = sections[i - 1]["body"]
        curr_body = sections[i]["body"]
        curr_paragraphs = [p for p in curr_body.split("\n\n") if p.strip()]
        if not curr_paragraphs:
            continue

        curr_defs = []
        curr_nondefs = []
        for p in curr_paragraphs:
            m = footnote_def_re.match(p)
            if m:
                curr_defs.append((m.group(1), p))
            else:
                curr_nondefs.append(p)

        if not curr_defs:
            continue

        curr_nondef_text = "\n\n".join(curr_nondefs)
        prev_paragraphs = [p for p in prev_body.split("\n\n") if p.strip()]
        moved_any = False

        for num, definition in curr_defs:
            marker = f"<sup>{num}</sup>"
            prev_has_marker = marker in prev_body
            prev_has_definition = re.search(rf"(?m)^\s*<sup>{re.escape(num)}</sup>\s+", prev_body) is not None
            curr_uses_marker = marker in curr_nondef_text
            prev_marker_pos = prev_body.find(marker)
            prev_marker_early = prev_marker_pos != -1 and prev_marker_pos < 500

            if prev_has_marker and not prev_has_definition and (not curr_uses_marker or prev_marker_early):
                prev_paragraphs.append(definition)
                curr_paragraphs = [p for p in curr_paragraphs if p != definition]
                moved_any = True

        if moved_any:
            sections[i - 1]["body"] = "\n\n".join(prev_paragraphs).strip()
            sections[i]["body"] = "\n\n".join(curr_paragraphs).strip() or "(No extractable text in this range.)"


def remove_orphan_markers_after_rebalance(sections: list[dict]) -> None:
    def_nums_re = re.compile(r"(?m)^\s*<sup>(\d{1,3})</sup>\s+")
    marker_re = re.compile(r"<sup>(\d{1,3})</sup>")

    for i in range(1, len(sections)):
        prev_body = sections[i - 1]["body"]
        curr_body = sections[i]["body"]

        prev_defs = set(def_nums_re.findall(prev_body))
        curr_defs = set(def_nums_re.findall(curr_body))
        curr_markers = set(marker_re.findall(curr_body))

        orphan_nums = [n for n in curr_markers if n not in curr_defs and n in prev_defs]
        for num in orphan_nums:
            curr_body = re.sub(rf"\s*<sup>{re.escape(num)}</sup>", "", curr_body)

        sections[i]["body"] = re.sub(r"\n{3,}", "\n\n", curr_body).strip() or "(No extractable text in this range.)"


def markdown_table_from_rows(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    col_count = max((len(row) for row in rows), default=0)
    if col_count < 2:
        return ""

    normalized_rows = []
    for row in rows:
        normalized = [clean_line(str(cell or "").replace("\n", " ")) for cell in row]
        while len(normalized) < col_count:
            normalized.append("")
        normalized = normalized[:col_count]
        if any(normalized):
            normalized_rows.append(normalized)

    if len(normalized_rows) < 2:
        return ""

    def esc(cell: str) -> str:
        return cell.replace("|", "\\|")

    def is_achievement_header_row(row: list[str]) -> bool:
        if len(row) < 5:
            return False
        first = row[0].lower()
        rest = " ".join(row[1:5]).lower()
        return "categories" in first and "level 1" in rest and "level 4" in rest

    def is_separator_like_row(row: list[str]) -> bool:
        return all(re.fullmatch(r"-{2,}", cell.strip()) for cell in row if cell.strip()) and any(cell.strip() for cell in row)

    if is_achievement_header_row(normalized_rows[0]):
        header = normalized_rows[0]
        body = normalized_rows[1:]
    elif col_count == 5:
        header = ["Categories", "Level 1", "Level 2", "Level 3", "Level 4"]
        body = normalized_rows
    else:
        header = normalized_rows[0]
        body = normalized_rows[1:]

    body = [row for row in body if not is_achievement_header_row(row) and not is_separator_like_row(row)]
    if not body:
        return ""
    lines = [
        f"| {' | '.join(esc(cell) for cell in header)} |",
        f"|{'|'.join(['---'] * col_count)}|",
    ]
    for row in body:
        lines.append(f"| {' | '.join(esc(cell) for cell in row)} |")
    return "\n".join(lines)


def extract_page_tables(page, top: float, bottom: float) -> list[dict]:
    found = []
    try:
        table_objs = page.find_tables().tables
    except Exception:
        table_objs = []

    seen = set()
    for table in table_objs:
        bbox = getattr(table, "bbox", None)
        if not bbox or len(bbox) < 4:
            continue
        x0, y0, x1, y1 = [float(v) for v in bbox[:4]]
        if y1 <= top or y0 >= bottom:
            continue
        md = markdown_table_from_rows(table.extract() or [])
        if not md:
            continue
        key = (round(y0, 1), round(y1, 1), md)
        if key in seen:
            continue
        seen.add(key)
        found.append(
            {
                "x0": x0,
                "x1": x1,
                "y0": max(y0, top),
                "y1": min(y1, bottom),
                "md": md,
            }
        )

    found.sort(key=lambda item: (item["y0"], item["x0"]))
    return found


def lines_to_paragraphs(lines: list[dict]) -> list[str]:
    if not lines:
        return []

    lines = sorted(lines, key=lambda item: (item["y0"], item["x0"]))
    baseline_x = min(line["x0"] for line in lines)
    bullet_pattern = re.compile(r"^([•\-*]|\d+\.)\s+")
    paragraphs = []
    current = []
    current_is_bullet = False
    prev = None

    def flush():
        if not current:
            return
        merged = current[0]
        for nxt in current[1:]:
            if merged.endswith("-") and len(merged) > 1 and merged[-2].isalpha() and nxt[:1].isalpha():
                merged = merged[:-1] + nxt
            elif re.search(r"[.!?:;)]$", merged):
                merged += " " + nxt
            else:
                merged += " " + nxt
        paragraphs.append(merged.strip())

    for line in lines:
        text = line["text"]
        bullet = bool(bullet_pattern.match(text))

        if prev is None:
            current = [text]
            current_is_bullet = bullet
            prev = line
            continue

        gap = line["y0"] - prev["y1"]
        indent_delta = line["x0"] - baseline_x
        prev_indent_delta = prev["x0"] - baseline_x
        continuation_of_bullet = (
            current_is_bullet
            and not bullet
            and indent_delta >= (prev_indent_delta - 1.0)
            and gap <= 10.0
        )
        starts_new = (gap > 4.0 and not continuation_of_bullet) or bullet or (
            indent_delta - prev_indent_delta > 8.0 and not continuation_of_bullet
        )

        if starts_new:
            flush()
            current = [text]
            current_is_bullet = bullet
        else:
            current.append(text)
        prev = line

    flush()
    return paragraphs


def page_blocks(page, y_min=None, y_max=None, margin_noise_profile=None):
    top = 0.0 if y_min is None else max(0.0, float(y_min) + 0.5)
    bottom = float(page.rect.height) if y_max is None else float(y_max)
    if bottom <= top:
        return []

    tables = extract_page_tables(page, top, bottom)
    payload = page.get_text("dict")
    lines = []
    for block in payload.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            bbox = line.get("bbox", [0, 0, 0, 0])
            x0, x1, y0, y1 = float(bbox[0]), float(bbox[2]), float(bbox[1]), float(bbox[3])
            if y1 <= top or y0 >= bottom:
                continue
            if any(
                not (x1 <= tb["x0"] or x0 >= tb["x1"] or y1 <= tb["y0"] or y0 >= tb["y1"])
                for tb in tables
            ):
                continue
            parts = []
            for span in line.get("spans", []):
                text = clean_line(span.get("text", ""))
                if text:
                    parts.append(text)
            text = clean_line(" ".join(parts))
            if text:
                norm = normalize_match_text(text)
                top_band = float(page.rect.height) * 0.10
                bottom_band = float(page.rect.height) * 0.90
                page_number_like = re.match(
                    r"^\s*(?:page\s+)?\d{1,4}(?:\s*(?:/|of)\s*\d{1,4})?\s*$",
                    text,
                    flags=re.IGNORECASE,
                ) is not None
                is_top_noise = (
                    margin_noise_profile is not None
                    and y0 <= top_band
                    and norm in margin_noise_profile.get("top", set())
                )
                is_bottom_noise = (
                    margin_noise_profile is not None
                    and y1 >= bottom_band
                    and norm in margin_noise_profile.get("bottom", set())
                )
                is_page_footer = page_number_like and y1 >= bottom_band
                if is_top_noise or is_bottom_noise or is_page_footer:
                    continue
                lines.append({"x0": x0, "y0": y0, "y1": y1, "text": text})

    if not lines and not tables:
        return []

    lines = sorted(lines, key=lambda item: (item["y0"], item["x0"]))
    output_blocks = []
    li = 0
    for table in tables:
        pre_lines = []
        while li < len(lines) and lines[li]["y0"] < table["y0"]:
            pre_lines.append(lines[li])
            li += 1
        output_blocks.extend(lines_to_paragraphs(pre_lines))
        output_blocks.append(table["md"])
        while li < len(lines) and lines[li]["y0"] < table["y1"]:
            li += 1

    if li < len(lines):
        output_blocks.extend(lines_to_paragraphs(lines[li:]))

    return [block for block in output_blocks if clean_line(block)]

def prepare_output_dirs(out_dir: Path, conversion_mode: str) -> tuple[Path, str]:
    out_dir.mkdir(parents=True, exist_ok=True)

    if conversion_mode == "sections":
        target_dir = out_dir / "Sections"
        relative_prefix = "Sections/"
    elif conversion_mode == "major":
        target_dir = out_dir / "By Major Heading"
        relative_prefix = "By Major Heading/"
    elif conversion_mode == "single":
        target_dir = out_dir
        relative_prefix = ""
    else:
        raise ValueError(f"Unsupported conversion mode: {conversion_mode}")

    target_dir.mkdir(parents=True, exist_ok=True)

    # Avoid removing the whole output tree on Windows: open handles (editors/previewers)
    # can lock files and make cleanup fail with WinError 32.
    for existing in target_dir.glob("*.md"):
        if conversion_mode == "single" and existing.name.lower() == "outline.md":
            continue
        try:
            existing.unlink()
        except PermissionError as err:
            raise RuntimeError(
                f"Output file is locked by another process: {existing}. "
                "Close any open section files or preview windows and retry."
            ) from err

    return target_dir, relative_prefix


def cleanup_section_body(body: str, title: str, next_title: str | None = None) -> str:
    out = body.strip()
    out = re.sub(r"(?im)^\W*extract\s+\d+\s*", "", out)

    paragraphs = [p.strip() for p in out.split("\n\n") if p.strip()]
    if not paragraphs:
        return "(No extractable text in this range.)"

    # Remove duplicated heading echoed as first paragraph.
    first_para = paragraphs[0].rstrip(":").strip()
    if first_para.lower() == title.strip().lower().rstrip(":"):
        paragraphs = paragraphs[1:]

    if paragraphs and next_title:
        last_para = paragraphs[-1].rstrip(":").strip()
        if last_para.lower() == next_title.strip().lower().rstrip(":"):
            paragraphs = paragraphs[:-1]

    # Drop likely trailing heading bleed if it is short title-case text.
    if len(paragraphs) > 1:
        tail = paragraphs[-1]
        tail_words = tail.split()
        looks_like_heading = (
            len(tail_words) <= 6
            and not re.search(r"[.!?]$", tail)
            and all(w[:1].isupper() for w in tail_words if w[:1].isalpha())
        )
        if looks_like_heading:
            paragraphs = paragraphs[:-1]

    out = "\n\n".join(paragraphs).strip()
    if not out:
        out = "(No extractable text in this range.)"

    out = re.sub(r"\n{3,}", "\n\n", out)
    return out


def build_section_markdown(title: str, level: int, start: int, end: int, source: str, body: str, include_section_metadata: bool) -> str:
    md_level = max(1, min(6, int(level)))
    heading_prefix = "#" * md_level
    if include_section_metadata:
        metadata_block = (
            f"- Level: {level}\n"
            f"- Pages: {start}-{end}\n"
            f"- Source: {source}\n\n"
        )
    else:
        metadata_block = ""
    return (
        f"{heading_prefix} {title}\n\n"
        f"{metadata_block}"
        f"{body}\n"
    )


def write_outputs(
    doc,
    outline,
    out_dir: Path,
    max_section_chars: int,
    include_section_metadata: bool,
    conversion_mode: str,
):
    output_md_dir, output_rel_prefix = prepare_output_dirs(out_dir, conversion_mode)
    margin_noise_profile = build_margin_noise_profile(doc)

    normalized = []
    for idx, item in enumerate(outline, start=1):
        normalized.append(
            {
                "id": f"h{idx}",
                "level": int(item["level"]),
                "title": item["title"],
                "page_start": int(item["page_start"]),
                "source": item["source"],
                "y0": item.get("y0"),
                "line_count": 0,
                "char_count": 0,
                "section_file": None,
            }
        )
    normalized = normalize_outline(normalized)

    # Preserve content that appears before the first detected heading
    # (e.g., title pages, foreword, or top-of-page text before first TOC anchor).
    if normalized:
        first = normalized[0]
        first_page = max(1, int(first.get("page_start", 1)))
        first_y = first.get("y0")
        has_preface_gap = first_page > 1
        has_same_page_lead_in = first_page == 1 and first_y is not None and float(first_y) > 2.0
        if has_preface_gap or has_same_page_lead_in:
            normalized.insert(
                0,
                {
                    "id": "h0",
                    "level": 1,
                    "title": "Front Matter",
                    "page_start": 1,
                    "source": "synthetic-front-matter",
                    "y0": 0.0,
                    "line_count": 0,
                    "char_count": 0,
                    "section_file": None,
                },
            )

    section_rows = []
    total_sections = len(normalized)
    for i, current in enumerate(normalized):
        current_title = clean_line(current.get("title", ""))[:80]
        print(f"PROGRESS: Extracting section text {i + 1}/{total_sections}: {current_title}", flush=True)
        start = max(1, current["page_start"])
        has_next = i + 1 < len(normalized)
        next_entry = normalized[i + 1] if has_next else None

        current_y = current.get("y0")
        next_y = next_entry.get("y0") if has_next else None
        next_page = next_entry["page_start"] if has_next else None
        next_same_page = has_next and next_page == start

        if has_next and next_page is not None:
            if next_y is not None:
                section_end_page = next_page
            elif next_same_page:
                # Ambiguous same-page boundary: keep current section empty rather than
                # duplicating full-page content into multiple sections.
                section_end_page = start - 1
            else:
                # Without an anchor on the next heading, stop before its start page
                # to avoid cross-section full-page overlap.
                section_end_page = next_page - 1
        else:
            section_end_page = doc.page_count

        end = max(start - 1, min(doc.page_count, section_end_page))

        pages_text = []
        for page_no in range(start - 1, end):
            page = doc.load_page(page_no)
            if page_no == start - 1 and current_y is not None:
                y_min = float(current_y)
            else:
                y_min = None

            if page_no == start - 1 and next_same_page and next_y is not None:
                y_max = float(next_y)
            elif has_next and next_page is not None and page_no == next_page - 1 and next_y is not None:
                y_max = float(next_y)
            else:
                y_max = None

            blocks = page_blocks(page, y_min=y_min, y_max=y_max, margin_noise_profile=margin_noise_profile)
            if blocks:
                pages_text.append("\n\n".join(blocks))

        next_title = next_entry["title"] if has_next else None
        body = "\n\n".join(pages_text).strip() or "(No extractable text in this range.)"
        body = cleanup_section_body(body, current["title"], next_title=next_title)
        body = improve_readability(body)
        body = normalize_footnote_block_breaks(body)
        body = attach_missing_footnote_markers(body)
        body = move_footnote_definitions_to_end(body)
        body = stitch_orphan_continuations(body)
        body = format_dot_leader_blocks(body)
        body = format_course_table_blocks(body)
        body = fix_as_follows_bullet_lists(body)
        body = remove_redundant_table_header_lines(body)
        body = remove_duplicate_markdown_table_headers(body)
        body = strip_footnote_prefix_from_table_rows(body)
        body = split_inline_bullet_runs(body)
        body = strip_remaining_bullet_glyphs(body)
        body = strip_inline_sup_markers(body)
        body = deduplicate_body_paragraphs(body)
        section_rows.append(
            {
                "index": i,
                "start": start,
                "end": end,
                "title": current["title"],
                "level": current["level"],
                "source": current["source"],
                "body": body,
            }
        )

    rebalance_cross_section_footnotes(section_rows)
    remove_orphan_markers_after_rebalance(section_rows)
    for row in section_rows:
        row["body"] = deduplicate_body_paragraphs(row["body"])

    max_level_in_doc = max((int(item["level"]) for item in normalized), default=1)
    numbering_depth = max(3, min(6, max_level_in_doc))
    level_counters = [0] * numbering_depth

    code_by_index = {}
    for row in section_rows:
        i = row["index"]
        current = normalized[i]
        current_level = max(1, min(numbering_depth, int(current["level"])))
        for depth_i in range(current_level, numbering_depth):
            level_counters[depth_i] = 0
        level_counters[current_level - 1] += 1
        code_by_index[i] = ".".join(str(level_counters[idx]) for idx in range(numbering_depth))

        body = row["body"]
        current["line_count"] = len([line for line in body.splitlines() if line.strip()])
        current["char_count"] = len(body)
        current["section_file"] = None

    segments = []
    total_rows = len(section_rows)

    if conversion_mode == "sections":
        for row in section_rows:
            i = row["index"]
            current = normalized[i]
            current_title = clean_line(current.get("title", ""))[:80]
            print(f"PROGRESS: Writing section markdown {i + 1}/{total_rows}: {current_title}", flush=True)
            start = row["start"]
            end = row["end"]
            body = row["body"]

            section_code = code_by_index[i]
            file_name = f"{section_code}-{slugify(current['title'])}.md"
            section_path = f"{output_rel_prefix}{file_name}"
            current["section_file"] = section_path
            markdown = build_section_markdown(
                current["title"],
                int(current["level"]),
                int(start),
                int(end),
                current["source"],
                body,
                include_section_metadata,
            )
            (output_md_dir / file_name).write_text(markdown, encoding="utf-8")
            segments.append(
                {
                    "id": f"s{len(segments)+1}",
                    "title": current["title"],
                    "level": current["level"],
                    "page_start": start,
                    "page_end": end,
                    "file": section_path,
                    "char_count": len(body),
                }
            )
    elif conversion_mode == "major":
        levels = [int(item["level"]) for item in normalized] or [1]
        level_counts = {}
        for lvl in levels:
            level_counts[lvl] = level_counts.get(lvl, 0) + 1
        multi_levels = sorted([lvl for lvl, cnt in level_counts.items() if cnt >= 2])
        major_level = multi_levels[0] if multi_levels else min(levels)
        major_indices = [idx for idx, item in enumerate(normalized) if int(item["level"]) == major_level]
        if not major_indices:
            major_indices = [0]

        rows_by_major = {idx: [] for idx in major_indices}
        active_major = major_indices[0]
        major_set = set(major_indices)
        for row in section_rows:
            idx = row["index"]
            if idx in major_set:
                active_major = idx
            rows_by_major.setdefault(active_major, []).append(row)

        for major_idx in major_indices:
            grouped_rows = rows_by_major.get(major_idx, [])
            if not grouped_rows:
                continue
            current = normalized[major_idx]
            current_title = clean_line(current.get("title", ""))[:80]
            print(
                f"PROGRESS: Writing major-heading markdown {major_idx + 1}/{len(normalized)}: {current_title}",
                flush=True,
            )

            section_code = code_by_index.get(major_idx, "0.0.0")
            file_name = f"{section_code}-{slugify(current['title'])}.md"
            section_path = f"{output_rel_prefix}{file_name}"
            current["section_file"] = section_path

            chunk_markdown = []
            total_chars = 0
            page_start = grouped_rows[0]["start"]
            page_end = grouped_rows[-1]["end"]
            for row in grouped_rows:
                idx = row["index"]
                entry = normalized[idx]
                body = row["body"]
                total_chars += len(body)
                chunk_markdown.append(
                    build_section_markdown(
                        entry["title"],
                        int(entry["level"]),
                        int(row["start"]),
                        int(row["end"]),
                        entry["source"],
                        body,
                        include_section_metadata,
                    ).strip()
                )
            (output_md_dir / file_name).write_text("\n\n".join(chunk_markdown) + "\n", encoding="utf-8")
            segments.append(
                {
                    "id": f"s{len(segments)+1}",
                    "title": current["title"],
                    "level": current["level"],
                    "page_start": page_start,
                    "page_end": page_end,
                    "file": section_path,
                    "char_count": total_chars,
                }
            )
    elif conversion_mode == "single":
        file_name = f"{out_dir.name}.md"
        section_path = f"{output_rel_prefix}{file_name}"
        if normalized:
            normalized[0]["section_file"] = section_path

        chunk_markdown = []
        toc_table = build_toc_markdown_table(section_rows)
        if toc_table:
            chunk_markdown.append(toc_table.strip())
        total_chars = 0
        page_start = section_rows[0]["start"] if section_rows else 1
        page_end = section_rows[-1]["end"] if section_rows else doc.page_count
        for row in section_rows:
            idx = row["index"]
            entry = normalized[idx]
            body = row["body"]
            total_chars += len(body)
            chunk_markdown.append(
                build_section_markdown(
                    entry["title"],
                    int(entry["level"]),
                    int(row["start"]),
                    int(row["end"]),
                    entry["source"],
                    body,
                    include_section_metadata,
                ).strip()
            )
        (output_md_dir / file_name).write_text("\n\n".join(chunk_markdown) + "\n", encoding="utf-8")
        segments.append(
            {
                "id": "s1",
                "title": "Document",
                "level": 1,
                "page_start": page_start,
                "page_end": page_end,
                "file": section_path,
                "char_count": total_chars,
            }
        )
    else:
        raise ValueError(f"Unsupported conversion mode: {conversion_mode}")

    (out_dir / "outline.json").write_text(json.dumps(normalized, indent=2), encoding="utf-8")
    (out_dir / "segments.json").write_text(json.dumps(segments, indent=2), encoding="utf-8")

    lines = ["# Outline", ""]
    for entry in normalized:
        indent = "  " * max(0, entry["level"] - 1)
        title = entry["title"]
        if entry.get("section_file"):
            title = f"[{title}]({entry['section_file']})"
        lines.append(
            f"{indent}- L{entry['level']} p{entry['page_start']} "
            f"{title} (lines: {entry['line_count']}, chars: {entry['char_count']})"
        )
    lines.append("")
    (out_dir / "outline.md").write_text("\n".join(lines), encoding="utf-8")

    return normalized, segments


def main():
    parser = argparse.ArgumentParser(description="Phase 1 outline extraction and split planner")
    parser.add_argument("--input", "-i", required=True, help="Input PDF path")
    parser.add_argument("--out-dir", "-o", default="output", help="Output directory root")
    parser.add_argument("--max-section-chars", type=int, default=8000, help="Max chars per section chunk")
    parser.add_argument(
        "--include-section-metadata",
        type=int,
        choices=[0, 1],
        default=1,
        help="Include section metadata header lines (Level/Pages/Source) in output markdown files",
    )
    parser.add_argument(
        "--conversion-mode",
        choices=["single", "major", "sections"],
        default="sections",
        help="Output grouping mode: single file, per-major-heading, or per-section",
    )
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    print("PROGRESS: Opening PDF document", flush=True)
    doc = fitz.open(str(input_path))

    print("PROGRESS: Detecting headings", flush=True)
    outline = build_outline_from_toc(doc)
    if outline:
        outline = infer_toc_heading_positions(doc, outline)
    if not outline:
        print("PROGRESS: No embedded TOC found; using text heuristics", flush=True)
        outline = build_outline_heuristic(doc)
    if not outline:
        outline = [{"level": 1, "title": "Document", "page_start": 1, "source": "fallback"}]
    outline = normalize_outline(outline)

    base = input_path.stem
    out_dir = Path(args.out_dir).expanduser().resolve() / base
    print("PROGRESS: Writing outline and section markdown files", flush=True)
    normalized, segments = write_outputs(
        doc,
        outline,
        out_dir,
        args.max_section_chars,
        bool(args.include_section_metadata),
        args.conversion_mode,
    )
    print("PROGRESS: Finalizing output indexes", flush=True)

    print("Phase 1 extraction complete")
    print(f"Input: {input_path}")
    print(f"Output: {out_dir}")
    print(f"Headings: {len(normalized)}")
    print(f"Segments: {len(segments)}")


if __name__ == "__main__":
    main()





