#!/usr/bin/env python3
"""Fix audio_review_dataset labels by OCRing the cyan title text.

The initial dataset aligned screenshots/audio to screen counters correctly, but
used weak word-list visual alignment for directory names and recognized_word.
This script learns simple glyph templates from the existing screenshots, OCRs
the title word in each word_crop.png, aligns those OCR strings to words.json,
and rewrites only metadata/recognized text/directory names.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import re
import shutil
import struct
import time
import zlib
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK_DIR = ROOT / ".audio_review_work"
OUTPUT_DIR = ROOT / "audio_review_dataset"
SEGMENTS_FILE = WORK_DIR / "segments.json"
BACKUP_SEGMENTS_FILE = WORK_DIR / "segments_before_title_ocr.json"
OCR_FILE = WORK_DIR / "title_ocr_alignment.json"
WORDS_FILE = ROOT / "words.json"
EXPECTED_CARDS = 6556
TARGET_H = 40


def safe_name(value: str) -> str:
    value = re.sub(r"[^\w.-]+", "_", value, flags=re.ASCII).strip("._")
    return value or "unknown"


def title_chars(value: str) -> str:
    return re.sub(r"[^A-Za-z-]", "", value).lower()


def match_text(value: str) -> str:
    return re.sub(r"[^a-z]", "", value.lower())


def read_png_rgb(path: Path) -> tuple[int, int, bytes]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a PNG: {path}")
    pos = 8
    width = height = color_type = bit_depth = None
    idat: list[bytes] = []
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            if bit_depth != 8 or color_type not in (2, 6) or interlace != 0:
                raise ValueError(f"unsupported PNG format in {path}: {bit_depth=}, {color_type=}")
        elif kind == b"IDAT":
            idat.append(chunk)
        elif kind == b"IEND":
            break
    if width is None or height is None or color_type is None:
        raise ValueError(f"missing PNG header: {path}")

    raw = zlib.decompress(b"".join(idat))
    bpp = 3 if color_type == 2 else 4
    stride = width * bpp
    out = bytearray(height * stride)
    prev = bytearray(stride)
    cursor = 0
    for y in range(height):
        filter_type = raw[cursor]
        cursor += 1
        scan = bytearray(raw[cursor : cursor + stride])
        cursor += stride
        for i in range(stride):
            left = scan[i - bpp] if i >= bpp else 0
            up = prev[i]
            up_left = prev[i - bpp] if i >= bpp else 0
            if filter_type == 1:
                scan[i] = (scan[i] + left) & 255
            elif filter_type == 2:
                scan[i] = (scan[i] + up) & 255
            elif filter_type == 3:
                scan[i] = (scan[i] + ((left + up) // 2)) & 255
            elif filter_type == 4:
                estimate = left + up - up_left
                pa = abs(estimate - left)
                pb = abs(estimate - up)
                pc = abs(estimate - up_left)
                predictor = left if pa <= pb and pa <= pc else (up if pb <= pc else up_left)
                scan[i] = (scan[i] + predictor) & 255
            elif filter_type != 0:
                raise ValueError(f"unsupported PNG filter {filter_type} in {path}")
        out[y * stride : (y + 1) * stride] = scan
        prev = scan

    if bpp == 3:
        return width, height, bytes(out)

    rgb = bytearray(width * height * 3)
    dst = 0
    for src in range(0, len(out), 4):
        rgb[dst : dst + 3] = out[src : src + 3]
        dst += 3
    return width, height, bytes(rgb)


def cyan_mask(path: Path) -> tuple[int, int, bytearray] | None:
    width, height, rgb = read_png_rgb(path)
    mask = bytearray(width * height)
    for pixel in range(width * height):
        offset = pixel * 3
        r = rgb[offset]
        g = rgb[offset + 1]
        b = rgb[offset + 2]
        if b > 95 and g > 80 and r < 95 and (b - r) > 40 and (g - r) > 25:
            mask[pixel] = 1

    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        row = y * width
        for x in range(width):
            if mask[row + x]:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None

    x1 = max(0, min(xs) - 2)
    x2 = min(width - 1, max(xs) + 2)
    y1 = max(0, min(ys) - 2)
    y2 = min(height - 1, max(ys) + 2)
    cropped_w = x2 - x1 + 1
    cropped_h = y2 - y1 + 1
    cropped = bytearray(cropped_w * cropped_h)
    for out_y, y in enumerate(range(y1, y2 + 1)):
        cropped[out_y * cropped_w : (out_y + 1) * cropped_w] = mask[y * width + x1 : y * width + x2 + 1]
    return cropped_w, cropped_h, cropped


def split_glyphs(mask: bytearray, width: int, height: int) -> list[tuple[bytearray, int, int]]:
    columns = [0] * width
    for y in range(height):
        row = y * width
        for x in range(width):
            columns[x] += mask[row + x]

    active = [value > 0 for value in columns]
    for x in range(1, width - 1):
        if not active[x] and active[x - 1] and active[x + 1]:
            active[x] = True
    for x in range(2, width - 2):
        if not active[x] and not active[x + 1] and active[x - 1] and active[x + 2]:
            active[x] = True
            active[x + 1] = True

    runs: list[tuple[int, int]] = []
    in_run = False
    start = 0
    for x, value in enumerate(active):
        if value and not in_run:
            start = x
            in_run = True
        if in_run and ((not value) or x == width - 1):
            end = x - 1 if not value else x
            if end - start + 1 >= 1:
                runs.append((start, end))
            in_run = False

    glyphs: list[tuple[bytearray, int, int]] = []
    for start, end in runs:
        xs: list[int] = []
        ys: list[int] = []
        for y in range(height):
            row = y * width
            for x in range(start, end + 1):
                if mask[row + x]:
                    xs.append(x)
                    ys.append(y)
        if not xs:
            continue
        x1 = min(xs)
        x2 = max(xs)
        y1 = min(ys)
        y2 = max(ys)
        glyph_w = x2 - x1 + 1
        glyph_h = y2 - y1 + 1
        if glyph_w * glyph_h < 10:
            continue
        glyph = bytearray(glyph_w * glyph_h)
        for out_y, y in enumerate(range(y1, y2 + 1)):
            glyph[out_y * glyph_w : (out_y + 1) * glyph_w] = mask[y * width + x1 : y * width + x2 + 1]
        glyphs.append((glyph, glyph_w, glyph_h))
    return glyphs


def normalize_glyph(glyph: tuple[bytearray, int, int]) -> tuple[tuple[int, ...], int]:
    mask, width, height = glyph
    target_w = max(1, round(width * TARGET_H / height))
    rows: list[int] = []
    for y in range(TARGET_H):
        src_y = min(height - 1, int((y + 0.5) * height / TARGET_H))
        bits = 0
        for x in range(target_w):
            src_x = min(width - 1, int((x + 0.5) * width / target_w))
            if mask[src_y * width + src_x]:
                bits |= 1 << x
        rows.append(bits)
    return tuple(rows), target_w


def glyph_distance(left: tuple[tuple[int, ...], int], right: tuple[tuple[int, ...], int]) -> float:
    left_rows, left_w = left
    right_rows, right_w = right
    diff = 0
    union = 0
    for a, b in zip(left_rows, right_rows):
        diff += (a ^ b).bit_count()
        union += (a | b).bit_count()
    return (diff / max(1, union)) + (0.08 * abs(math.log(max(left_w, 1) / max(right_w, 1))))


def extract_segment_glyphs(item: tuple[int, dict]) -> dict:
    index, segment = item
    crop = OUTPUT_DIR / segment["dir"] / "word_crop.png"
    mask = cyan_mask(crop)
    if mask is None:
        glyphs: list[tuple[tuple[int, ...], int]] = []
    else:
        glyphs = [normalize_glyph(part) for part in split_glyphs(mask[2], mask[0], mask[1])]
    return {
        "audioIndex": segment["audioIndex"],
        "wordIndex": segment.get("wordIndex"),
        "recognizedWord": segment.get("recognizedWord", ""),
        "dir": segment["dir"],
        "glyphs": glyphs,
    }


def collect_glyphs(segments: list[dict], jobs: int, progress_every: int) -> list[dict]:
    print(f"Extracting title glyphs from {len(segments)} crops with {jobs} jobs", flush=True)
    started = time.time()
    results: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as executor:
        futures = {
            executor.submit(extract_segment_glyphs, (idx, segment)): idx
            for idx, segment in enumerate(segments)
        }
        for completed, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            results.append(future.result())
            if completed == 1 or completed % progress_every == 0 or completed == len(segments):
                elapsed = time.time() - started
                rate = completed / elapsed if elapsed else 0.0
                remaining = (len(segments) - completed) / rate if rate else 0.0
                print(
                    f"  glyphs {completed}/{len(segments)} "
                    f"({completed * 100 / len(segments):.1f}%), {rate:.2f}/s, eta {remaining:.0f}s",
                    flush=True,
                )
    results.sort(key=lambda item: item["audioIndex"])
    return results


def build_prototypes(glyph_records: list[dict], max_per_char: int) -> dict[str, list[tuple[tuple[int, ...], int]]]:
    buckets: dict[str, list[tuple[tuple[int, ...], int]]] = defaultdict(list)
    for record in glyph_records:
        label = title_chars(record["recognizedWord"])
        glyphs = record["glyphs"]
        if not label or len(label) != len(glyphs):
            continue
        for char, glyph in zip(label, glyphs):
            buckets[char].append(glyph)

    prototypes: dict[str, list[tuple[tuple[int, ...], int]]] = {}
    for char, glyphs in buckets.items():
        widths = Counter(width for _, width in glyphs)
        common_widths = {width for width, _ in widths.most_common(3)}
        selected = [glyph for glyph in glyphs if glyph[1] in common_widths]
        selected.sort(key=lambda item: (abs(item[1] - widths.most_common(1)[0][0]), item[1]))
        prototypes[char] = selected[:max_per_char]
    print(
        "Trained glyph prototypes: "
        + ", ".join(f"{char}:{len(items)}" for char, items in sorted(prototypes.items())),
        flush=True,
    )
    return prototypes


def ocr_glyphs(
    glyphs: list[tuple[tuple[int, ...], int]],
    prototypes: dict[str, list[tuple[tuple[int, ...], int]]],
) -> tuple[str, float]:
    chars: list[str] = []
    scores: list[float] = []
    for glyph in glyphs:
        best_char = "?"
        best_score = 999.0
        for char, items in prototypes.items():
            score = min(glyph_distance(glyph, proto) for proto in items)
            if score < best_score:
                best_char = char
                best_score = score
        chars.append(best_char)
        scores.append(best_score)
    return "".join(chars), (sum(scores) / len(scores) if scores else 999.0)


def edit_distance(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    prev = list(range(len(right) + 1))
    for i, a in enumerate(left, start=1):
        cur = [i]
        for j, b in enumerate(right, start=1):
            cur.append(min(prev[j] + 1, cur[-1] + 1, prev[j - 1] + (a != b)))
        prev = cur
    return prev[-1]


def word_cost(ocr_text: str, word: str) -> float:
    left = match_text(ocr_text)
    right = match_text(word)
    if not left and not right:
        return 0.0
    distance = edit_distance(left, right)
    return float(distance)


def align_to_words(ocr_records: list[dict], words: list[dict]) -> tuple[list[dict], list[dict]]:
    card_count = len(ocr_records)
    word_count = len(words)
    extras = word_count - card_count
    if extras < 0:
        raise RuntimeError(f"word list shorter than cards: {word_count} < {card_count}")

    print(f"Aligning OCR titles: {card_count} cards, {word_count} words, {extras} skipped words", flush=True)
    inf = float("inf")
    dp = [[inf] * (extras + 1) for _ in range(card_count + 1)]
    back: list[list[tuple[int, int, str] | None]] = [
        [None] * (extras + 1) for _ in range(card_count + 1)
    ]
    dp[0][0] = 0.0
    for i in range(card_count + 1):
        for skipped in range(extras + 1):
            current = dp[i][skipped]
            if current == inf:
                continue
            consumed = i + skipped
            if consumed >= word_count:
                continue
            if skipped < extras:
                value = current
                if value < dp[i][skipped + 1]:
                    dp[i][skipped + 1] = value
                    back[i][skipped + 1] = (i, skipped, "skip")
            if i < card_count:
                value = current + word_cost(ocr_records[i]["ocrTitle"], words[consumed]["w"])
                if value < dp[i + 1][skipped]:
                    dp[i + 1][skipped] = value
                    back[i + 1][skipped] = (i, skipped, "assign")
        if i and i % 500 == 0:
            print(f"  aligned {i}/{card_count}", flush=True)

    if dp[card_count][extras] == inf:
        raise RuntimeError("failed to align OCR titles to word list")

    selected_word_indexes: list[int] = []
    skipped_word_indexes: list[int] = []
    i = card_count
    skipped = extras
    while i > 0 or skipped > 0:
        parent = back[i][skipped]
        if parent is None:
            raise RuntimeError("broken OCR alignment backpointer")
        parent_i, parent_skipped, action = parent
        consumed_before = parent_i + parent_skipped
        if action == "assign":
            selected_word_indexes.append(consumed_before)
        else:
            skipped_word_indexes.append(consumed_before)
        i = parent_i
        skipped = parent_skipped
    selected_word_indexes.reverse()
    skipped_word_indexes.reverse()

    aligned: list[dict] = []
    for record, word_index in zip(ocr_records, selected_word_indexes):
        word = words[word_index]["w"]
        aligned.append(
            {
                **record,
                "wordIndex": word_index + 1,
                "recognizedWord": word,
                "ocrWordCost": round(word_cost(record["ocrTitle"], word), 5),
            }
        )
    skipped_words = [
        {"wordIndex": index + 1, "word": words[index]["w"]}
        for index in skipped_word_indexes
    ]
    print(f"OCR alignment cost: {dp[card_count][extras]:.3f}", flush=True)
    return aligned, skipped_words


def align_to_nearby_words(
    ocr_records: list[dict],
    words: list[dict],
    window: int,
    distance_penalty: float,
) -> tuple[list[dict], list[dict]]:
    print(
        f"Matching OCR titles to nearby word-list entries: window=±{window}, "
        f"distance_penalty={distance_penalty}",
        flush=True,
    )
    aligned: list[dict] = []
    selected: set[int] = set()
    for index, record in enumerate(ocr_records, start=1):
        center = (record.get("oldWordIndex") or record["audioIndex"]) - 1
        start = max(0, center - window)
        end = min(len(words), center + window + 1)
        best: tuple[float, int, int, int] | None = None
        for word_index in range(start, end):
            raw_cost = edit_distance(match_text(record["ocrTitle"]), match_text(words[word_index]["w"]))
            index_distance = abs(word_index - center)
            score = raw_cost + (distance_penalty * index_distance)
            candidate = (score, raw_cost, index_distance, word_index)
            if best is None or candidate < best:
                best = candidate
        if best is None:
            raise RuntimeError(f"no nearby word candidates for audio index {record['audioIndex']}")
        _, raw_cost, index_distance, word_index = best
        selected.add(word_index)
        aligned.append(
            {
                **record,
                "wordIndex": word_index + 1,
                "recognizedWord": words[word_index]["w"],
                "ocrWordCost": raw_cost,
                "ocrWordIndexDistance": index_distance,
            }
        )
        if index == 1 or index % 1000 == 0 or index == len(ocr_records):
            print(f"  nearby matched {index}/{len(ocr_records)}", flush=True)

    skipped_words = [
        {"wordIndex": index + 1, "word": words[index]["w"]}
        for index in range(len(words))
        if index not in selected
    ]
    high_cost = [item for item in aligned if item["ocrWordCost"] >= 3]
    print(
        f"Nearby matching selected {len(selected)} unique word-list entries; "
        f"{len(skipped_words)} entries not selected; {len(high_cost)} high-cost matches",
        flush=True,
    )
    if high_cost:
        for item in high_cost[:20]:
            print(
                f"  high-cost {item['audioIndex']:04d}: ocr={item['ocrTitle']} -> "
                f"{item['recognizedWord']} cost={item['ocrWordCost']} "
                f"distance={item['ocrWordIndexDistance']}",
                flush=True,
            )
    return aligned, skipped_words


def update_dataset(aligned: list[dict], skipped_words: list[dict], segments_payload: dict, dry_run: bool) -> None:
    segments_by_audio = {segment["audioIndex"]: segment for segment in segments_payload["segments"]}
    changes: list[dict] = []
    for record in aligned:
        segment = segments_by_audio[record["audioIndex"]]
        old_dir = OUTPUT_DIR / segment["dir"]
        new_dirname = f"{record['audioIndex']:04d}_w{record['wordIndex']:04d}_{safe_name(record['recognizedWord'])}"
        new_dir = OUTPUT_DIR / new_dirname
        changed = (
            segment.get("wordIndex") != record["wordIndex"]
            or segment.get("recognizedWord") != record["recognizedWord"]
            or segment.get("dir") != new_dirname
        )
        if changed:
            changes.append(
                {
                    "audioIndex": record["audioIndex"],
                    "oldDir": segment["dir"],
                    "newDir": new_dirname,
                    "oldWord": segment.get("recognizedWord"),
                    "newWord": record["recognizedWord"],
                    "ocrTitle": record["ocrTitle"],
                }
            )
        if dry_run:
            continue

        if old_dir != new_dir:
            if new_dir.exists():
                raise RuntimeError(f"target directory already exists: {new_dir}")
            old_dir.rename(new_dir)

        segment["wordIndex"] = record["wordIndex"]
        segment["recognizedWord"] = record["recognizedWord"]
        segment["visualScore"] = record.get("ocrWordCost")
        segment["ocrTitle"] = record["ocrTitle"]
        segment["ocrTitleScore"] = record["ocrTitleScore"]
        segment["ocrWordCost"] = record["ocrWordCost"]
        segment["ocrWordIndexDistance"] = record.get("ocrWordIndexDistance")
        segment["wordSource"] = "title_ocr_alignment"
        segment["dir"] = new_dirname

        (new_dir / "recognized_word.txt").write_text(f"{record['recognizedWord']}\n", encoding="utf-8")
        meta_path = new_dir / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta["wordIndex"] = record["wordIndex"]
        meta["recognizedWord"] = record["recognizedWord"]
        meta["visualScore"] = record["ocrWordCost"]
        meta["ocrTitle"] = record["ocrTitle"]
        meta["ocrTitleScore"] = record["ocrTitleScore"]
        meta["ocrWordCost"] = record["ocrWordCost"]
        meta["ocrWordIndexDistance"] = record.get("ocrWordIndexDistance")
        meta["wordSource"] = "title_ocr_alignment"
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Detected {len(changes)} label/directory changes", flush=True)
    if changes:
        for change in changes[:40]:
            print(
                f"  {change['audioIndex']:04d}: {change['oldWord']} -> {change['newWord']} "
                f"(ocr={change['ocrTitle']})",
                flush=True,
            )
        if len(changes) > 40:
            print(f"  ... {len(changes) - 40} more", flush=True)

    if dry_run:
        return

    segments_payload["segmentSourceMode"] = "audio-counter-title-ocr"
    segments_payload["skippedWordCount"] = len(skipped_words)
    segments_payload["skippedWords"] = skipped_words
    SEGMENTS_FILE.write_text(json.dumps(segments_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest_records = [
        {"audioIndex": segment["audioIndex"], "dir": segment["dir"]}
        for segment in sorted(segments_payload["segments"], key=lambda item: item["audioIndex"])
    ]
    manifest = {
        "sourceVideo": segments_payload.get("sourceVideo"),
        "sourceAudio": segments_payload.get("sourceAudio"),
        "count": len(manifest_records),
        "expectedCount": EXPECTED_CARDS,
        "records": manifest_records,
    }
    (OUTPUT_DIR / "dataset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=int, default=0)
    parser.add_argument("--progress-every", type=int, default=250)
    parser.add_argument("--max-prototypes-per-char", type=int, default=18)
    parser.add_argument("--strategy", choices=["nearby", "dp"], default="nearby")
    parser.add_argument("--nearby-window", type=int, default=120)
    parser.add_argument("--nearby-distance-penalty", type=float, default=0.05)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rebuild-ocr", action="store_true")
    args = parser.parse_args()

    payload = json.loads(SEGMENTS_FILE.read_text(encoding="utf-8"))
    segments = payload["segments"] if isinstance(payload, dict) else payload
    if len(segments) != EXPECTED_CARDS:
        raise SystemExit(f"expected {EXPECTED_CARDS} segments, got {len(segments)}")
    words = json.loads(WORDS_FILE.read_text(encoding="utf-8"))
    jobs = args.jobs or min(6, os.cpu_count() or 1)

    if OCR_FILE.exists() and not args.rebuild_ocr:
        cached = json.loads(OCR_FILE.read_text(encoding="utf-8"))
        if cached.get("count") == len(segments):
            print(f"Loaded cached OCR records from {OCR_FILE}", flush=True)
            ocr_records = cached["records"]
        else:
            ocr_records = []
    else:
        ocr_records = []

    if not ocr_records:
        glyph_records = collect_glyphs(segments, jobs, args.progress_every)
        prototypes = build_prototypes(glyph_records, args.max_prototypes_per_char)
        print("Classifying title glyphs", flush=True)
        ocr_records = []
        for idx, record in enumerate(glyph_records, start=1):
            ocr_title, ocr_score = ocr_glyphs(record["glyphs"], prototypes)
            ocr_records.append(
                {
                    "audioIndex": record["audioIndex"],
                    "oldWordIndex": record.get("wordIndex"),
                    "oldWord": record.get("recognizedWord"),
                    "oldDir": record["dir"],
                    "ocrTitle": ocr_title,
                    "ocrTitleScore": round(ocr_score, 5),
                }
            )
            if idx == 1 or idx % args.progress_every == 0 or idx == len(glyph_records):
                print(f"  OCR {idx}/{len(glyph_records)}", flush=True)
        OCR_FILE.write_text(
            json.dumps({"count": len(ocr_records), "records": ocr_records}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"Wrote OCR cache -> {OCR_FILE}", flush=True)

    if args.strategy == "dp":
        aligned, skipped_words = align_to_words(ocr_records, words)
    else:
        aligned, skipped_words = align_to_nearby_words(
            ocr_records,
            words,
            args.nearby_window,
            args.nearby_distance_penalty,
        )
    if not args.dry_run and SEGMENTS_FILE.exists() and not BACKUP_SEGMENTS_FILE.exists():
        shutil.copy2(SEGMENTS_FILE, BACKUP_SEGMENTS_FILE)
        print(f"Backed up old segments -> {BACKUP_SEGMENTS_FILE}", flush=True)
    update_dataset(aligned, skipped_words, payload, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
