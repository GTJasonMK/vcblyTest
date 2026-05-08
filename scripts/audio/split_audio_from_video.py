#!/usr/bin/env python3
"""Build per-word audio clips by aligning the vocabulary video to the word list.

The video has a stable card layout: every word card shows a counter and a large
cyan English word in the same title region. This script uses that visual signal
as the primary source of truth, then uses audio silence data only to trim each
card down to the spoken word.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = ROOT / "media" / "source"
VIDEO_FILE = MEDIA_DIR / "2023考研红宝书英音全集.mp4"
AUDIO_FILE = MEDIA_DIR / "2023考研红宝书英音全集.m4a"
WORDS_FILE = ROOT / "words.json"

WORK_DIR = ROOT / ".audio_work"
DETECTED_FILE = WORK_DIR / "detected_cards.json"
MATCHED_FILE = WORK_DIR / "matched_cards.json"
TEMPLATE_FILE = WORK_DIR / "template_features.json"
SILENCE_FILE = WORK_DIR / "silence_data.txt"
DETECT_CHUNKS_DIR = WORK_DIR / "detect_chunks"
MANIFEST_JS = ROOT / "data" / "audio_manifest.js"
OUTPUT_DIR = ROOT / "word_audio_matched"

EXPECTED_VIDEO_WORDS = 6556
FEATURE_COLS = 80
FEATURE_ROWS = 24

# Cropped from 1282x720 video. This region covers the card counter and title
# word, while avoiding lower example-sentence text that can animate/scroll.
TITLE_CROP = {
    "x": 180,
    "y": 80,
    "w": 900,
    "h": 150,
    "scaled_w": 450,
    "scaled_h": 75,
}

DEFAULT_FONTS = ("Noto-Sans-Bold", "NimbusSans-Bold", "Liberation-Sans-Bold")

ALIGNMENT_DELTAS = (
    (5770, 5893, 1, "words.json entry 5860 guarding is not present in the video"),
    (5940, 6003, -1, "video record 5939 repeats knowledgeable"),
    (6005, 6070, -2, "video record 6004 repeats microprocessor"),
    (6072, 6127, -3, "video record 6071 repeats non-materialistic"),
    (6129, 6292, -4, "video record 6128 repeats over-the-counter"),
    (6293, 6458, -3, "words.json entry 6379 revitalise is not present in the video"),
    (6459, 6478, -2, "words.json entry 6546 unclear is not present in the video"),
    (6479, 6556, -1, "words.json entry 6567 unfavourable is not present in the video"),
)

SKIP_MANIFEST_RECORDS = {
    5894: "duplicate intermarriage detection",
    5939: "duplicate knowledgeable detection",
    6004: "duplicate microprocessor detection",
    6071: "duplicate non-materialistic detection",
    6128: "duplicate over-the-counter detection",
}


def run(cmd: list[str], *, stdout=None, stderr=None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, stdout=stdout, stderr=stderr)


def ffprobe_duration(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        text=True,
    )
    return float(out.strip())


def read_words() -> list[dict]:
    with WORDS_FILE.open(encoding="utf-8") as f:
        data = json.load(f)
    return data


def safe_name(word: str) -> str:
    out = re.sub(r"[^\w.-]+", "_", word, flags=re.ASCII)
    out = out.strip("._")
    return out or "word"


def resample(values: list[float], size: int) -> list[float]:
    if not values:
        return [0.0] * size
    if len(values) == size:
        return values[:]
    result: list[float] = []
    scale = len(values) / size
    for i in range(size):
        pos = (i + 0.5) * scale - 0.5
        left = max(0, min(len(values) - 1, math.floor(pos)))
        right = max(0, min(len(values) - 1, left + 1))
        frac = pos - left
        result.append(values[left] * (1.0 - frac) + values[right] * frac)
    return result


def feature_from_mask(mask: list[int], width: int, height: int) -> dict | None:
    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        row = mask[y * width : (y + 1) * width]
        for x, value in enumerate(row):
            if value:
                xs.append(x)
                ys.append(y)

    if not xs:
        return None

    min_x = max(0, min(xs) - 1)
    max_x = min(width - 1, max(xs) + 1)
    min_y = max(0, min(ys) - 1)
    max_y = min(height - 1, max(ys) + 1)
    box_w = max_x - min_x + 1
    box_h = max_y - min_y + 1

    cropped: list[int] = []
    for y in range(min_y, max_y + 1):
        cropped.extend(mask[y * width + min_x : y * width + max_x + 1])

    columns = [0.0] * box_w
    rows = [0.0] * box_h
    ink = 0
    for y in range(box_h):
        for x in range(box_w):
            value = cropped[y * box_w + x]
            if value:
                columns[x] += 1.0
                rows[y] += 1.0
                ink += 1

    if ink < 20 or box_w < 8 or box_h < 8:
        return None

    columns = [value / box_h for value in columns]
    rows = [value / box_w for value in rows]
    return {
        "bbox": [min_x, min_y, max_x, max_y],
        "bbox_w": box_w,
        "bbox_h": box_h,
        "ratio": box_w / box_h,
        "density": ink / (box_w * box_h),
        "ink": ink,
        "cols": [round(v, 5) for v in resample(columns, FEATURE_COLS)],
        "rows": [round(v, 5) for v in resample(rows, FEATURE_ROWS)],
    }


def cyan_feature_from_rgb(frame: bytes, width: int, height: int) -> dict | None:
    mask: list[int] = []
    for i in range(0, len(frame), 3):
        r = frame[i]
        g = frame[i + 1]
        b = frame[i + 2]
        # The large English title is bright cyan. This keeps anti-aliased edges
        # while excluding white counter text and yellow phonetics.
        is_cyan = b > 85 and g > 75 and r < 105 and (b - r) > 35 and (g - r) > 25
        mask.append(1 if is_cyan else 0)
    return feature_from_mask(mask, width, height)


def read_pgm(data: bytes) -> tuple[int, int, list[int]]:
    index = 0

    def token() -> str:
        nonlocal index
        while index < len(data) and data[index] in b" \t\r\n":
            index += 1
        if index < len(data) and data[index] == ord("#"):
            while index < len(data) and data[index] not in b"\r\n":
                index += 1
            return token()
        start = index
        while index < len(data) and data[index] not in b" \t\r\n":
            index += 1
        return data[start:index].decode("ascii")

    magic = token()
    if magic != "P5":
        raise ValueError(f"unsupported PGM magic {magic!r}")
    width = int(token())
    height = int(token())
    max_value = int(token())
    if max_value <= 0:
        raise ValueError("invalid PGM max value")
    while index < len(data) and data[index] in b" \t\r\n":
        index += 1
    pixels = [1 if value > 40 else 0 for value in data[index : index + width * height]]
    return width, height, pixels


def render_template_feature(word: str, font: str, point_size: int = 82) -> dict | None:
    try:
        out = subprocess.check_output(
            [
                "magick",
                "-background",
                "black",
                "-fill",
                "white",
                "-font",
                font,
                "-pointsize",
                str(point_size),
                f"label:{word}",
                "-trim",
                "PGM:-",
            ],
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        return None

    width, height, mask = read_pgm(out)
    return feature_from_mask(mask, width, height)


def parse_showinfo_times(log_file: Path) -> list[float]:
    pattern = re.compile(r"pts_time:([0-9.]+)")
    times: list[float] = []
    with log_file.open(encoding="utf-8", errors="ignore") as f:
        for line in f:
            match = pattern.search(line)
            if match:
                times.append(float(match.group(1)))
    return times


def detect_chunk(
    chunk_id: int,
    nominal_start: float,
    nominal_end: float,
    ffmpeg_start: float,
    ffmpeg_duration: float,
    args: argparse.Namespace,
) -> dict:
    raw_w = TITLE_CROP["scaled_w"]
    raw_h = TITLE_CROP["scaled_h"]
    frame_size = raw_w * raw_h * 3

    crop = TITLE_CROP
    vf = (
        f"crop={crop['w']}:{crop['h']}:{crop['x']}:{crop['y']},"
        f"scale={raw_w}:{raw_h},"
        "setpts=PTS-STARTPTS,"
        f"select=gt(scene\\,{args.scene_threshold}),"
        "showinfo,format=rgb24"
    )

    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "info",
        "-ss",
        f"{ffmpeg_start:.3f}",
        "-t",
        f"{ffmpeg_duration:.3f}",
        "-i",
        str(VIDEO_FILE),
        "-vf",
        vf,
        "-an",
        "-vsync",
        "0",
        "-f",
        "rawvideo",
        "-",
    ]

    log_file = args.detect_log_dir / f"chunk_{chunk_id:03d}.log"
    features: list[dict | None] = []
    with log_file.open("w", encoding="utf-8") as log:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=log)
        assert proc.stdout is not None
        while True:
            frame = proc.stdout.read(frame_size)
            if not frame:
                break
            if len(frame) != frame_size:
                raise RuntimeError("short raw frame from ffmpeg")
            features.append(cyan_feature_from_rgb(frame, raw_w, raw_h))
        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg scene detection failed in chunk {chunk_id}: {proc.returncode}")

    times = parse_showinfo_times(log_file)
    if len(times) != len(features):
        raise RuntimeError(
            f"showinfo/frame count mismatch in chunk {chunk_id}: {len(times)} != {len(features)}"
        )

    raw_cards: list[dict] = []
    for time_value, feature in zip(times, features):
        global_time = ffmpeg_start + time_value
        if global_time < args.min_time or feature is None:
            continue
        if global_time < nominal_start or global_time >= nominal_end:
            continue
        if feature["bbox_w"] < args.min_title_width or feature["ink"] < args.min_ink:
            continue
        raw_cards.append({"time": global_time, "feature": feature})

    return {
        "chunkId": chunk_id,
        "nominalStart": nominal_start,
        "nominalEnd": nominal_end,
        "ffmpegStart": ffmpeg_start,
        "ffmpegDuration": ffmpeg_duration,
        "rawFrames": len(features),
        "candidates": raw_cards,
        "logFile": str(log_file),
    }


def build_detect_chunks(duration: float, args: argparse.Namespace) -> list[tuple[int, float, float, float, float]]:
    chunks: list[tuple[int, float, float, float, float]] = []
    cursor = 0.0
    chunk_id = 0
    while cursor < duration:
        nominal_start = cursor
        nominal_end = min(duration, cursor + args.chunk_duration)
        ffmpeg_start = max(0.0, nominal_start - args.chunk_overlap)
        ffmpeg_end = min(duration, nominal_end + args.chunk_overlap)
        chunks.append((chunk_id, nominal_start, nominal_end, ffmpeg_start, ffmpeg_end - ffmpeg_start))
        cursor = nominal_end
        chunk_id += 1
    if args.max_chunks and args.max_chunks > 0:
        chunks = chunks[: args.max_chunks]
    return chunks


def detect_cards(args: argparse.Namespace) -> None:
    WORK_DIR.mkdir(exist_ok=True)
    DETECT_CHUNKS_DIR.mkdir(exist_ok=True)
    args.detect_log_dir = DETECT_CHUNKS_DIR / f"run_{int(time.time())}_{os.getpid()}"
    args.detect_log_dir.mkdir(exist_ok=True)

    duration = ffprobe_duration(VIDEO_FILE)
    chunks = build_detect_chunks(duration, args)
    jobs = args.jobs or min(4, os.cpu_count() or 1)
    jobs = max(1, min(jobs, len(chunks)))

    print(
        f"Running chunked scene detection: {len(chunks)} chunks, "
        f"{jobs} parallel jobs, duration {duration:.1f}s, logs {args.detect_log_dir}",
        flush=True,
    )

    raw_cards: list[dict] = []
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as executor:
        future_map = {
            executor.submit(detect_chunk, chunk_id, start, end, ff_start, ff_dur, args): (
                chunk_id,
                start,
                end,
            )
            for chunk_id, start, end, ff_start, ff_dur in chunks
        }
        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            chunk_id, start, end = future_map[future]
            result = future.result()
            completed += 1
            raw_cards.extend(result["candidates"])
            elapsed = time.time() - started
            print(
                f"[{completed:02d}/{len(chunks):02d}] chunk {chunk_id:03d} "
                f"{start:7.1f}-{end:7.1f}s: "
                f"{len(result['candidates']):4d} candidates "
                f"({len(raw_cards):5d} total), elapsed {elapsed:5.1f}s",
                flush=True,
            )

    raw_cards.sort(key=lambda item: item["time"])

    cards: list[dict] = []
    last_time = -999.0
    for item in raw_cards:
        time_value = item["time"]
        if time_value - last_time < args.min_gap:
            # Keep the first valid frame for the card. Later frames inside the
            # same transition usually have identical title text.
            continue
        cards.append(
            {
                "videoIndex": len(cards) + 1,
                "start": round(time_value, 3),
                "feature": item["feature"],
            }
        )
        last_time = time_value

    for i, card in enumerate(cards):
        if i + 1 < len(cards):
            card["end"] = cards[i + 1]["start"]
        else:
            card["end"] = round(duration, 3)

    DETECTED_FILE.write_text(json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Detected {len(cards)} candidate word cards -> {DETECTED_FILE}", flush=True)
    if len(cards) != EXPECTED_VIDEO_WORDS:
        print(
            f"WARNING: expected {EXPECTED_VIDEO_WORDS} cards from the video counter, "
            f"detected {len(cards)}. Try --scene-threshold/--min-gap tuning."
            ,
            flush=True,
        )


def load_template_features(words: list[dict], fonts: tuple[str, ...], rebuild: bool, jobs: int = 0) -> dict:
    word_list = [item["w"] for item in words]
    cache_key = {"words": word_list, "fonts": list(fonts), "cols": FEATURE_COLS, "rows": FEATURE_ROWS}

    if TEMPLATE_FILE.exists() and not rebuild:
        cached = json.loads(TEMPLATE_FILE.read_text(encoding="utf-8"))
        if cached.get("cacheKey") == cache_key:
            return cached["features"]

    total = len(word_list) * len(fonts)
    jobs = jobs or min(4, os.cpu_count() or 1)
    jobs = max(1, min(jobs, total))
    print(
        f"Rendering {total} template features with {jobs} parallel ImageMagick jobs. "
        "This is cached after the first run...",
        flush=True,
    )
    features: dict[str, list[dict | None]] = {font: [] for font in fonts}
    for font in fonts:
        features[font] = [None] * len(word_list)

    started = time.time()
    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as executor:
        future_map = {
            executor.submit(render_template_feature, word, font): (font, idx)
            for idx, word in enumerate(word_list)
            for font in fonts
        }
        for future in concurrent.futures.as_completed(future_map):
            font, idx = future_map[future]
            features[font][idx] = future.result()
            completed += 1
            if completed % 500 == 0 or completed == total:
                elapsed = time.time() - started
                print(f"  rendered {completed}/{total} templates, elapsed {elapsed:.1f}s", flush=True)

    TEMPLATE_FILE.write_text(
        json.dumps({"cacheKey": cache_key, "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )
    return features


def feature_score(card: dict, template: dict | None) -> float:
    if template is None:
        return 999.0
    col_delta = sum(abs(a - b) for a, b in zip(card["cols"], template["cols"])) / FEATURE_COLS
    row_delta = sum(abs(a - b) for a, b in zip(card["rows"], template["rows"])) / FEATURE_ROWS
    ratio_delta = abs(math.log(max(card["ratio"], 0.01) / max(template["ratio"], 0.01)))
    density_delta = abs(card["density"] - template["density"])
    return (2.0 * col_delta) + (0.7 * row_delta) + (0.75 * ratio_delta) + (0.7 * density_delta)


def best_visual_score(card: dict, template_features: dict, word_index: int, fonts: tuple[str, ...]) -> float:
    return min(feature_score(card, template_features[font][word_index]) for font in fonts)


def align_cards_to_words(args: argparse.Namespace) -> None:
    if not DETECTED_FILE.exists():
        raise SystemExit(f"missing {DETECTED_FILE}; run detect first")

    cards = json.loads(DETECTED_FILE.read_text(encoding="utf-8"))
    words = read_words()
    fonts = tuple(args.fonts.split(","))
    template_features = load_template_features(words, fonts, args.rebuild_templates, args.template_jobs)

    n_cards = len(cards)
    n_words = len(words)
    max_skips = n_words - n_cards
    if max_skips < 0:
        raise SystemExit(f"word list has fewer entries ({n_words}) than detected cards ({n_cards})")

    print(f"Aligning {n_cards} video cards to {n_words} words; expected skips: {max_skips}", flush=True)

    # DP state for frame i: possible matched word indices are i..i+max_skips.
    prev: dict[int, float] = {}
    backs: list[dict[int, int | None]] = []
    first_score = best_visual_score(cards[0]["feature"], template_features, 0, fonts)
    prev[0] = first_score
    backs.append({0: None})

    for i in range(1, n_cards):
        if i % 500 == 0:
            print(f"  aligned {i}/{n_cards}", flush=True)

        current: dict[int, float] = {}
        current_back: dict[int, int | None] = {}
        min_k = i
        max_k = min(n_words - 1, i + max_skips)

        for k in range(min_k, max_k + 1):
            visual = best_visual_score(cards[i]["feature"], template_features, k, fonts)
            best_cost = float("inf")
            best_prev: int | None = None
            for prev_k, prev_cost in prev.items():
                if prev_k >= k:
                    continue
                gap = k - prev_k - 1
                if gap > args.max_gap:
                    continue
                cost = prev_cost + visual + (args.gap_penalty * gap * gap)
                if cost < best_cost:
                    best_cost = cost
                    best_prev = prev_k
            if best_prev is not None:
                current[k] = best_cost
                current_back[k] = best_prev

        if not current:
            raise RuntimeError(f"alignment failed at card {i + 1}; try increasing --max-gap")
        prev = current
        backs.append(current_back)

    end_index = n_words - 1
    if end_index not in prev:
        end_index = min(prev, key=prev.get)
        print(f"WARNING: best path ended at word {end_index + 1}, not final word {n_words}", flush=True)

    path = [end_index]
    for i in range(n_cards - 1, 0, -1):
        parent = backs[i][path[-1]]
        if parent is None:
            raise RuntimeError("broken alignment backpointer")
        path.append(parent)
    path.reverse()

    selected = set(path)
    skipped = [idx for idx in range(n_words) if idx not in selected]

    records: list[dict] = []
    for i, word_index in enumerate(path):
        word = words[word_index]
        filename = f"{i + 1:04d}_{safe_name(word['w'])}.m4a"
        records.append(
            {
                "videoIndex": i + 1,
                "wordIndex": word_index + 1,
                "word": word["w"],
                "start": cards[i]["start"],
                "end": cards[i]["end"],
                "audio": f"{OUTPUT_DIR.name}/{filename}",
                "feature": cards[i]["feature"],
            }
        )

    apply_alignment_repairs(records, words)
    selected = {record["wordIndex"] for record in records if not record.get("skipManifest")}
    skipped = [idx for idx in range(n_words) if idx + 1 not in selected]

    payload = {
        "video": str(VIDEO_FILE.name),
        "audioSource": str(AUDIO_FILE.name),
        "outputDir": OUTPUT_DIR.name,
        "fonts": list(fonts),
        "recordCount": len(records),
        "wordCount": n_words,
        "skippedWordCount": len(skipped),
        "skippedWords": [{"wordIndex": idx + 1, "word": words[idx]["w"]} for idx in skipped],
        "records": records,
    }
    MATCHED_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    write_audio_manifest_js(payload)

    print(f"Matched {len(records)} records -> {MATCHED_FILE}", flush=True)
    print(f"Skipped {len(skipped)} word-list entries without direct video cards", flush=True)
    print(f"Wrote frontend manifest -> {MANIFEST_JS}", flush=True)

    for idx in args.sample_indices:
        if 1 <= idx <= len(records):
            item = records[idx - 1]
            print(
                f"sample {idx}: video #{item['videoIndex']} -> "
                f"word #{item['wordIndex']} {item['word']}",
                flush=True,
            )


def write_audio_manifest_js(payload: dict) -> None:
    by_word_index: dict[str, str] = {}
    by_word: dict[str, str] = {}
    for record in payload["records"]:
        if record.get("skipManifest"):
            continue
        by_word_index[str(record["wordIndex"])] = record["audio"]
        # Keep the first occurrence for duplicate spellings. The index-based
        # manifest is authoritative when the app knows the source word index.
        by_word.setdefault(record["word"], record["audio"])

    lines = [
        "// Generated by split_audio_from_video.py. Do not edit by hand.",
        f"var AUDIO_MANIFEST_BY_WORD_INDEX = {json.dumps(by_word_index, ensure_ascii=False, indent=2)};",
        f"var AUDIO_MANIFEST = {json.dumps(by_word, ensure_ascii=False, indent=2)};",
        "",
    ]
    MANIFEST_JS.write_text("\n".join(lines), encoding="utf-8")


def apply_alignment_repairs(records: list[dict], words: list[dict]) -> None:
    for record in records:
        video_index = record["videoIndex"]
        old_word = record["word"]
        for start, end, delta, reason in ALIGNMENT_DELTAS:
            if start <= video_index <= end:
                record["wordIndex"] += delta
                word = words[record["wordIndex"] - 1]
                record["word"] = word["w"]
                record["audio"] = f"{OUTPUT_DIR.name}/{video_index:04d}_{safe_name(word['w'])}.m4a"
                record["alignmentRepair"] = {
                    "oldWord": old_word,
                    "wordIndexDelta": delta,
                    "reason": reason,
                }
                break

        if video_index in SKIP_MANIFEST_RECORDS:
            record["skipManifest"] = True
            record["alignmentRepair"] = {
                "oldWord": old_word,
                "reason": SKIP_MANIFEST_RECORDS[video_index],
                "duplicateOfVideoIndex": video_index - 1,
            }


def parse_silence_file(path: Path, duration: float) -> list[tuple[float, float]]:
    starts: list[float] = []
    ends: list[float] = []
    start_pattern = re.compile(r"silence_start:\s*([0-9.]+)")
    end_pattern = re.compile(r"silence_end:\s*([0-9.]+)")

    with path.open(encoding="utf-8", errors="ignore") as f:
        for line in f:
            start_match = start_pattern.search(line)
            if start_match:
                starts.append(float(start_match.group(1)))
            end_match = end_pattern.search(line)
            if end_match:
                ends.append(float(end_match.group(1)))

    nonsilent: list[tuple[float, float]] = []
    cursor = 0.0
    for start, end in zip(starts, ends):
        if start > cursor:
            nonsilent.append((cursor, start))
        cursor = max(cursor, end)
    if cursor < duration:
        nonsilent.append((cursor, duration))
    return [(s, e) for s, e in nonsilent if e - s >= 0.08]


def parse_ffmpeg_time(value: str) -> float | None:
    if value == "N/A":
        return None
    parts = value.split(":")
    if len(parts) != 3:
        return None
    try:
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = float(parts[2])
    except ValueError:
        return None
    return (hours * 3600.0) + (minutes * 60.0) + seconds


def ensure_silence_data(args: argparse.Namespace) -> Path:
    if args.silence_file:
        path = Path(args.silence_file)
        if not path.exists():
            raise SystemExit(f"silence file does not exist: {path}")
        return path

    if SILENCE_FILE.exists() and not args.rebuild_silence:
        return SILENCE_FILE

    WORK_DIR.mkdir(exist_ok=True)
    duration = ffprobe_duration(AUDIO_FILE)
    print(
        f"Generating silence data with ffmpeg for {duration:.1f}s of audio. "
        "Progress updates print every ~10s...",
        flush=True,
    )
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-nostats",
        "-progress",
        "pipe:1",
        "-i",
        str(AUDIO_FILE),
        "-af",
        f"silencedetect=noise={args.silence_noise}:d={args.silence_duration}",
        "-f",
        "null",
        "-",
    ]
    with SILENCE_FILE.open("w", encoding="utf-8") as log:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=log, text=True)
        assert proc.stdout is not None
        last_report = 0.0
        current_time = 0.0
        for line in proc.stdout:
            key, _, value = line.strip().partition("=")
            if key == "out_time":
                parsed = parse_ffmpeg_time(value)
                if parsed is not None:
                    current_time = parsed
            elif key in {"out_time_us", "out_time_ms"}:
                try:
                    current_time = int(value) / 1_000_000.0
                except ValueError:
                    pass
            now = time.time()
            if current_time and now - last_report >= 10.0:
                percent = min(100.0, (current_time / duration) * 100.0)
                print(f"  silence scan {current_time:.1f}/{duration:.1f}s ({percent:.1f}%)", flush=True)
                last_report = now
        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg silence detection failed: {proc.returncode}")
    print(f"Wrote silence data -> {SILENCE_FILE}", flush=True)
    return SILENCE_FILE


def choose_clip_interval(
    record: dict,
    nonsilent: list[tuple[float, float]],
    args: argparse.Namespace,
    start_index: int = 0,
) -> tuple[float, float, int | None]:
    card_start = record["start"]
    card_end = record["end"]
    window_start = card_start - args.assign_pad_before
    window_end = card_end + args.assign_pad_after

    candidates: list[tuple[int, float, float]] = []
    for idx in range(start_index, len(nonsilent)):
        start, end = nonsilent[idx]
        mid = (start + end) / 2.0
        if window_start <= mid <= window_end:
            candidates.append((idx, start, end))
        if mid > window_end:
            break
    if candidates:
        # The word pronunciation is the first speech event on each card.
        idx, start, end = candidates[0]
        return max(0.0, start - args.clip_pad_before), end + args.clip_pad_after, idx

    return max(0.0, card_start), min(card_end, card_start + args.fallback_duration), None


def split_audio(args: argparse.Namespace) -> None:
    if not MATCHED_FILE.exists():
        raise SystemExit(f"missing {MATCHED_FILE}; run match first")

    payload = json.loads(MATCHED_FILE.read_text(encoding="utf-8"))
    duration = ffprobe_duration(AUDIO_FILE)
    silence_path = ensure_silence_data(args)
    nonsilent = parse_silence_file(silence_path, duration)
    print(f"Loaded {len(nonsilent)} non-silent intervals from {silence_path}")

    records = payload["records"]
    OUTPUT_DIR.mkdir(exist_ok=True)

    commands: list[list[str]] = []
    speech_cursor = 0
    for record in records:
        if record.get("skipManifest"):
            continue
        start, end, speech_index = choose_clip_interval(record, nonsilent, args, speech_cursor)
        if speech_index is not None:
            speech_cursor = speech_index + 1
        record["clipStart"] = round(start, 3)
        record["clipEnd"] = round(end, 3)
        out_path = ROOT / record["audio"]
        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{start:.3f}",
            "-to",
            f"{end:.3f}",
            "-i",
            str(AUDIO_FILE),
            "-c",
            "copy",
            str(out_path),
        ]
        commands.append(cmd)

    script_path = WORK_DIR / "split_audio_matched.sh"
    with script_path.open("w", encoding="utf-8") as f:
        f.write("#!/usr/bin/env bash\nset -euo pipefail\n")
        for cmd in commands:
            f.write(" ".join(shlex.quote(part) for part in cmd) + "\n")
    script_path.chmod(0o755)

    MATCHED_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote split command script -> {script_path}")

    if not args.run:
        print("Dry run only. Add --run to create audio files.")
        return

    limit = args.limit if args.limit and args.limit > 0 else len(commands)
    jobs = args.split_jobs or min(4, os.cpu_count() or 1)
    jobs = max(1, min(jobs, limit))
    started = time.time()
    print(f"Splitting {limit} audio files with {jobs} parallel ffmpeg jobs...", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as executor:
        future_map = {
            executor.submit(run, cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL): i
            for i, cmd in enumerate(commands[:limit], start=1)
        }
        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            future.result()
            completed += 1
            if completed % 250 == 0 or completed == 1 or completed == limit:
                elapsed = time.time() - started
                print(f"  split {completed}/{limit}, elapsed {elapsed:.1f}s", flush=True)
    print(f"Created {limit} audio files in {OUTPUT_DIR}")


def cmd_all(args: argparse.Namespace) -> None:
    detect_cards(args)
    align_cards_to_words(args)
    split_audio(args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    detect = sub.add_parser("detect", help="detect word-card start/end times from video frames")
    detect.add_argument("--scene-threshold", type=float, default=0.018)
    detect.add_argument("--min-time", type=float, default=6.5)
    detect.add_argument("--min-gap", type=float, default=0.45)
    detect.add_argument("--min-title-width", type=int, default=25)
    detect.add_argument("--min-ink", type=int, default=80)
    detect.add_argument("--chunk-duration", type=float, default=300.0, help="seconds per detection chunk")
    detect.add_argument("--chunk-overlap", type=float, default=2.0, help="seconds of overlap around each chunk")
    detect.add_argument("--jobs", type=int, default=0, help="parallel ffmpeg jobs; default min(4, CPU count)")
    detect.add_argument("--max-chunks", type=int, default=0, help="debug only: process at most N chunks")
    detect.set_defaults(func=detect_cards)

    match = sub.add_parser("match", help="align detected video cards to words.json")
    match.add_argument("--fonts", default=",".join(DEFAULT_FONTS))
    match.add_argument("--rebuild-templates", action="store_true")
    match.add_argument("--template-jobs", type=int, default=0, help="parallel ImageMagick jobs")
    match.add_argument("--gap-penalty", type=float, default=0.035)
    match.add_argument("--max-gap", type=int, default=12)
    match.add_argument(
        "--sample-indices",
        type=lambda value: [int(part) for part in value.split(",") if part],
        default=[1, 18, 19, 85, 103, 6552],
    )
    match.set_defaults(func=align_cards_to_words)

    split = sub.add_parser("split", help="trim and split audio using the matched card manifest")
    split.add_argument("--run", action="store_true", help="actually create audio files")
    split.add_argument("--limit", type=int, default=0, help="only split the first N records")
    split.add_argument("--split-jobs", type=int, default=0, help="parallel ffmpeg jobs")
    split.add_argument("--silence-file", default="", help="reuse an existing silencedetect log")
    split.add_argument("--rebuild-silence", action="store_true")
    split.add_argument("--silence-noise", default="-35dB")
    split.add_argument("--silence-duration", type=float, default=0.18)
    split.add_argument("--assign-pad-before", type=float, default=0.25)
    split.add_argument("--assign-pad-after", type=float, default=0.25)
    split.add_argument("--clip-pad-before", type=float, default=0.02)
    split.add_argument("--clip-pad-after", type=float, default=0.04)
    split.add_argument("--fallback-duration", type=float, default=1.2)
    split.set_defaults(func=split_audio)

    all_cmd = sub.add_parser("all", help="run detect, match, and split")
    for action in detect._actions[1:]:
        all_cmd._add_action(action)
    for action in match._actions[1:]:
        all_cmd._add_action(action)
    for action in split._actions[1:]:
        all_cmd._add_action(action)
    all_cmd.set_defaults(func=cmd_all)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    for path in (VIDEO_FILE, AUDIO_FILE, WORDS_FILE):
        if not path.exists():
            parser.error(f"required file does not exist: {path}")

    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
