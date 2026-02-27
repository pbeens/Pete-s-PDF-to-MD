#!/usr/bin/env python3
import argparse
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
        if text.startswith(("•", "-", "*")):
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
    out = text
    out = re.sub(r"(?im)^\W*extract\s+\d+\s*", "", out)
    out = re.sub(r"(?im)^[-*•]\s*", "- ", out)
    # Plain inline marker: "Parents 1 play ..." -> "Parents <sup>1</sup> play ..."
    out = re.sub(r"(?<=\w)\s(\d{1,3})(?=\s+[a-z])", r" <sup>\1</sup>", out)
    # Footnote markers at the beginning of a line: "1 The word..." -> "<sup>1</sup> The word..."
    out = re.sub(r"(?m)^(\d{1,3})\s+", r"<sup>\1</sup> ", out)
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
    item_re = re.compile(r"^\s*(.+?)\s*\.{3,}\s*<sup>(\d{1,3})</sup>\s*$")

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

        if len(rows) >= 4:
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


def page_blocks(page, y_min=None, y_max=None):
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

def prepare_output_dirs(out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    sections_dir = out_dir / "sections"
    sections_dir.mkdir(parents=True, exist_ok=True)

    # Avoid removing the whole output tree on Windows: open handles (editors/previewers)
    # can lock files and make shutil.rmtree fail with WinError 32.
    for existing in sections_dir.glob("*.md"):
        try:
            existing.unlink()
        except PermissionError as err:
            raise RuntimeError(
                f"Output file is locked by another process: {existing}. "
                "Close any open section files or preview windows and retry."
            ) from err

    return sections_dir


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


def write_outputs(doc, outline, out_dir: Path, max_section_chars: int, include_section_metadata: bool):
    sections_dir = prepare_output_dirs(out_dir)

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

    section_rows = []
    total_sections = len(normalized)
    for i, current in enumerate(normalized):
        current_title = clean_line(current.get("title", ""))[:80]
        print(f"PROGRESS: Extracting section text {i + 1}/{total_sections}: {current_title}", flush=True)
        start = max(1, current["page_start"])
        has_next = i + 1 < len(normalized)
        next_entry = normalized[i + 1] if has_next else None
        section_end_page = next_entry["page_start"] if has_next else doc.page_count
        end = max(start, min(doc.page_count, section_end_page))

        current_y = current.get("y0")
        next_y = next_entry.get("y0") if has_next else None
        next_page = next_entry["page_start"] if has_next else None
        next_same_page = has_next and next_page == start

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

            blocks = page_blocks(page, y_min=y_min, y_max=y_max)
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
        body = remove_redundant_table_header_lines(body)
        body = remove_duplicate_markdown_table_headers(body)
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

    max_level_in_doc = max((int(item["level"]) for item in normalized), default=1)
    numbering_depth = max(3, min(6, max_level_in_doc))
    level_counters = [0] * numbering_depth

    segments = []
    total_rows = len(section_rows)
    for row in section_rows:
        i = row["index"]
        current = normalized[i]
        current_title = clean_line(current.get("title", ""))[:80]
        print(f"PROGRESS: Writing section markdown {i + 1}/{total_rows}: {current_title}", flush=True)
        start = row["start"]
        end = row["end"]
        body = row["body"]

        current_level = max(1, min(numbering_depth, int(current["level"])))
        for depth_i in range(current_level, numbering_depth):
            level_counters[depth_i] = 0
        level_counters[current_level - 1] += 1
        section_code = ".".join(str(level_counters[idx]) for idx in range(numbering_depth))

        current["line_count"] = len([line for line in body.splitlines() if line.strip()])
        current["char_count"] = len(body)
        file_name = f"{section_code}-{slugify(current['title'])}.md"
        section_path = f"sections/{file_name}"
        current["section_file"] = section_path
        md_level = max(1, min(6, int(current["level"])))
        heading_prefix = "#" * md_level
        if include_section_metadata:
            metadata_block = (
                f"- Level: {current['level']}\n"
                f"- Pages: {start}-{end}\n"
                f"- Source: {current['source']}\n\n"
            )
        else:
            metadata_block = ""
        markdown = (
            f"{heading_prefix} {current['title']}\n\n"
            f"{metadata_block}"
            f"{body}\n"
        )
        (sections_dir / file_name).write_text(markdown, encoding="utf-8")
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
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    print("PROGRESS: Opening PDF document", flush=True)
    doc = fitz.open(str(input_path))

    print("PROGRESS: Detecting headings", flush=True)
    outline = build_outline_from_toc(doc)
    if not outline:
        print("PROGRESS: No embedded TOC found; using text heuristics", flush=True)
        outline = build_outline_heuristic(doc)
    if not outline:
        outline = [{"level": 1, "title": "Document", "page_start": 1, "source": "fallback"}]

    base = input_path.stem
    out_dir = Path(args.out_dir).expanduser().resolve() / base
    print("PROGRESS: Writing outline and section markdown files", flush=True)
    normalized, segments = write_outputs(
        doc,
        outline,
        out_dir,
        args.max_section_chars,
        bool(args.include_section_metadata),
    )
    print("PROGRESS: Finalizing output indexes", flush=True)

    print("Phase 1 extraction complete")
    print(f"Input: {input_path}")
    print(f"Output: {out_dir}")
    print(f"Headings: {len(normalized)}")
    print(f"Segments: {len(segments)}")


if __name__ == "__main__":
    main()

