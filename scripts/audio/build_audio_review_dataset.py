#!/usr/bin/env python3
"""Build an auditable audio/screenshot dataset from the vocabulary video.

The output is one directory per video word card. Each directory contains the
trimmed audio clip, a screenshot at the audio midpoint, a cropped title image,
the recognized word guess, and metadata for manual checking.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = ROOT / "media" / "source"
VIDEO_FILE = MEDIA_DIR / "2023考研红宝书英音全集.mp4"
AUDIO_FILE = MEDIA_DIR / "2023考研红宝书英音全集.m4a"
WORDS_FILE = ROOT / "words.json"

WORK_DIR = ROOT / ".audio_review_work"
CARDS_FILE = WORK_DIR / "video_cards.json"
SILENCE_FILE = WORK_DIR / "silence_data.txt"
SEGMENTS_FILE = WORK_DIR / "segments.json"
TEMPLATES_FILE = WORK_DIR / "template_features.json"
OUTPUT_DIR = ROOT / "audio_review_dataset"

EXPECTED_CARDS = 6556
FEATURE_COLS = 80
FEATURE_ROWS = 24

TITLE_CROP = {
    "x": 180,
    "y": 80,
    "w": 900,
    "h": 150,
    "scaled_w": 450,
    "scaled_h": 75,
}

SAMPLE_CROP = {
    "x": 180,
    "y": 45,
    "w": 900,
    "h": 185,
    "scaled_w": 450,
    "scaled_h": 92,
}

COUNTER_CROP = {
    "x": 510,
    "y": 45,
    "w": 260,
    "h": 60,
}

COUNTER_TEMPLATE_TIMES = {
    1: 7.50,
    2: 8.90,
    3: 10.20,
    4: 11.40,
    5: 13.10,
    6: 14.20,
    7: 15.70,
    8: 16.90,
    9: 18.40,
    10: 19.90,
}

DEFAULT_FONTS = (
    "Noto-Sans-Bold",
    "NimbusSans-Bold",
    "Liberation-Sans-Bold",
    "DejaVu-Sans-Bold",
    "FreeSans-Bold",
    "TeXGyreHeros-Bold",
)


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
        return json.load(f)


def safe_name(value: str) -> str:
    value = re.sub(r"[^\w.-]+", "_", value, flags=re.ASCII).strip("._")
    return value or "unknown"


def parse_time(value: str) -> float | None:
    if not value or value == "N/A":
        return None
    parts = value.split(":")
    if len(parts) != 3:
        return None
    try:
        return int(parts[0]) * 3600.0 + int(parts[1]) * 60.0 + float(parts[2])
    except ValueError:
        return None


def resample(values: list[float], size: int) -> list[float]:
    if not values:
        return [0.0] * size
    if len(values) == size:
        return values[:]
    out: list[float] = []
    scale = len(values) / size
    for i in range(size):
        pos = (i + 0.5) * scale - 0.5
        left = max(0, min(len(values) - 1, math.floor(pos)))
        right = max(0, min(len(values) - 1, left + 1))
        frac = pos - left
        out.append(values[left] * (1.0 - frac) + values[right] * frac)
    return out


def feature_from_mask(mask: list[int], width: int, height: int) -> dict | None:
    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        offset = y * width
        for x in range(width):
            if mask[offset + x]:
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
        row_offset = y * box_w
        for x in range(box_w):
            value = cropped[row_offset + x]
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
        is_cyan = b > 85 and g > 75 and r < 115 and (b - r) > 30 and (g - r) > 22
        mask.append(1 if is_cyan else 0)
    return feature_from_mask(mask, width, height)


def scaled_region(region: dict, base: dict, scaled_w: int, scaled_h: int) -> tuple[int, int, int, int]:
    scale_x = scaled_w / base["w"]
    scale_y = scaled_h / base["h"]
    x = round((region["x"] - base["x"]) * scale_x)
    y = round((region["y"] - base["y"]) * scale_y)
    w = max(1, round(region["w"] * scale_x))
    h = max(1, round(region["h"] * scale_y))
    return x, y, w, h


def extract_rgb_region(frame: bytes, frame_w: int, x: int, y: int, w: int, h: int) -> bytes:
    out = bytearray()
    for row in range(y, y + h):
        start = (row * frame_w + x) * 3
        out.extend(frame[start : start + (w * 3)])
    return bytes(out)


def white_mask_from_rgb(frame: bytes, threshold: int) -> list[int]:
    mask: list[int] = []
    for i in range(0, len(frame), 3):
        r = frame[i]
        g = frame[i + 1]
        b = frame[i + 2]
        mask.append(1 if r >= threshold and g >= threshold and b >= threshold else 0)
    return mask


def component_parts(mask: list[int], width: int, height: int) -> list[tuple[list[int], int, int, tuple[int, int, int, int]]]:
    columns = [sum(mask[y * width + x] for y in range(height)) for x in range(width)]
    ranges: list[tuple[int, int]] = []
    in_run = False
    for x, value in enumerate(columns):
        if value > 0 and not in_run:
            start = x
            in_run = True
        if (value == 0 or x == width - 1) and in_run:
            end = x - 1 if value == 0 else x
            if end - start >= 1:
                ranges.append((start, end))
            in_run = False

    parts: list[tuple[list[int], int, int, tuple[int, int, int, int]]] = []
    for start, end in ranges:
        xs: list[int] = []
        ys: list[int] = []
        for y in range(height):
            row_offset = y * width
            for x in range(start, end + 1):
                if mask[row_offset + x]:
                    xs.append(x)
                    ys.append(y)
        if not xs:
            continue
        x1 = min(xs)
        x2 = max(xs)
        y1 = min(ys)
        y2 = max(ys)
        part_w = x2 - x1 + 1
        part_h = y2 - y1 + 1
        if part_w < 2 or part_h < 4:
            continue
        cropped: list[int] = []
        for y in range(y1, y2 + 1):
            cropped.extend(mask[y * width + x1 : y * width + x2 + 1])
        parts.append((cropped, part_w, part_h, (x1, x2, y1, y2)))
    return parts


def resize_mask(mask: list[int], width: int, height: int, target_h: int = 28) -> tuple[list[int], int, int]:
    target_w = max(1, round(width * target_h / height))
    out: list[int] = []
    for y in range(target_h):
        src_y = min(height - 1, int((y + 0.5) * height / target_h))
        for x in range(target_w):
            src_x = min(width - 1, int((x + 0.5) * width / target_w))
            out.append(mask[src_y * width + src_x])
    return out, target_w, target_h


def mask_distance(left: tuple[list[int], int, int], right: tuple[list[int], int, int]) -> float:
    left_mask, left_w, _ = left
    right_mask, right_w, _ = right
    width = max(left_w, right_w)
    height = 28
    diff = 0
    union = 0
    for y in range(height):
        for x in range(width):
            left_value = left_mask[y * left_w + x] if x < left_w else 0
            right_value = right_mask[y * right_w + x] if x < right_w else 0
            if left_value or right_value:
                union += 1
            if left_value != right_value:
                diff += 1
    return (diff / max(1, union)) + (0.1 * abs(math.log(max(left_w, 1) / max(right_w, 1))))


def mask_change_score(left: list[int], right: list[int]) -> float:
    diff = 0
    active = 0
    for a, b in zip(left, right):
        if a or b:
            active += 1
        if a != b:
            diff += 1
    return diff / max(1, active)


def extract_counter_frame(time_value: float, args: argparse.Namespace) -> bytes:
    crop = COUNTER_CROP
    seek_start = max(0.0, time_value - 1.0)
    seek_offset = time_value - seek_start
    vf = (
        f"crop={crop['w']}:{crop['h']}:{crop['x']}:{crop['y']},"
        f"scale={args.counter_scaled_w}:{args.counter_scaled_h},"
        "format=rgb24"
    )
    return subprocess.check_output(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{seek_start:.3f}",
            "-i",
            str(VIDEO_FILE),
            "-ss",
            f"{seek_offset:.3f}",
            "-frames:v",
            "1",
            "-vf",
            vf,
            "-an",
            "-f",
            "rawvideo",
            "-",
        ]
    )


def extract_review_frame(time_value: float) -> bytes:
    crop = SAMPLE_CROP
    return subprocess.check_output(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{time_value:.3f}",
            "-i",
            str(VIDEO_FILE),
            "-frames:v",
            "1",
            "-vf",
            f"crop={crop['w']}:{crop['h']}:{crop['x']}:{crop['y']},format=rgb24",
            "-an",
            "-f",
            "rawvideo",
            "-",
        ]
    )


def build_counter_templates(args: argparse.Namespace) -> dict[str, list[tuple[list[int], int, int]]]:
    templates: dict[str, list[tuple[list[int], int, int]]] = {ch: [] for ch in "0123456789/"}
    for number, time_value in COUNTER_TEMPLATE_TIMES.items():
        counter = extract_counter_frame(time_value, args)
        mask = white_mask_from_rgb(counter, args.counter_threshold)
        parts = component_parts(mask, args.counter_scaled_w, args.counter_scaled_h)
        labels = list(str(number))
        if len(parts) < len(labels) + 1:
            continue
        for label, part in zip(labels, parts):
            templates[label].append(resize_mask(part[0], part[1], part[2]))
        templates["/"].append(resize_mask(parts[len(labels)][0], parts[len(labels)][1], parts[len(labels)][2]))
        denom_labels = list("6556")
        denom_parts = parts[len(labels) + 1 : len(labels) + 1 + len(denom_labels)]
        for label, part in zip(denom_labels, denom_parts):
            templates[label].append(resize_mask(part[0], part[1], part[2]))

    missing = [label for label, items in templates.items() if not items]
    if missing:
        raise RuntimeError(f"failed to build counter templates for: {', '.join(missing)}")
    return templates


def classify_counter_part(
    part: tuple[list[int], int, int, tuple[int, int, int, int]],
    templates: dict[str, list[tuple[list[int], int, int]]],
) -> tuple[str, float]:
    resized = resize_mask(part[0], part[1], part[2])
    best_label = "?"
    best_score = 999.0
    for label, items in templates.items():
        for template in items:
            score = mask_distance(resized, template)
            if score < best_score:
                best_score = score
                best_label = label
    return best_label, best_score


def parse_counter_from_mask(
    mask: list[int],
    width: int,
    height: int,
    templates: dict[str, list[tuple[list[int], int, int]]],
    args: argparse.Namespace,
) -> tuple[int | None, float | None]:
    parts = component_parts(mask, width, height)
    if len(parts) < 6:
        return None, None

    labels: list[str] = []
    scores: list[float] = []
    for part in parts:
        label, score = classify_counter_part(part, templates)
        labels.append(label)
        scores.append(score)

    digits: list[str] = []
    for label, score in zip(labels, scores):
        if label == "/":
            break
        if not label.isdigit() or score > args.counter_max_distance:
            return None, None
        digits.append(label)
    if not digits:
        return None, None
    try:
        value = int("".join(digits))
    except ValueError:
        return None, None
    if not (1 <= value <= EXPECTED_CARDS):
        return None, None
    return value, sum(scores[: len(digits)]) / len(digits)


def parse_counter_from_rgb(
    counter: bytes,
    width: int,
    height: int,
    templates: dict[str, list[tuple[list[int], int, int]]],
    args: argparse.Namespace,
) -> tuple[int | None, float | None]:
    mask = white_mask_from_rgb(counter, args.counter_threshold)
    return parse_counter_from_mask(mask, width, height, templates, args)


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


def feature_score(card: dict, template: dict | None) -> float:
    if template is None:
        return 999.0
    col_delta = sum(abs(a - b) for a, b in zip(card["cols"], template["cols"])) / FEATURE_COLS
    row_delta = sum(abs(a - b) for a, b in zip(card["rows"], template["rows"])) / FEATURE_ROWS
    ratio_delta = abs(math.log(max(card["ratio"], 0.01) / max(template["ratio"], 0.01)))
    density_delta = abs(card["density"] - template["density"])
    return (2.0 * col_delta) + (0.7 * row_delta) + (0.75 * ratio_delta) + (0.7 * density_delta)


def feature_distance(left: dict | None, right: dict | None) -> float:
    if left is None or right is None:
        return 999.0
    col_delta = sum(abs(a - b) for a, b in zip(left["cols"], right["cols"])) / FEATURE_COLS
    row_delta = sum(abs(a - b) for a, b in zip(left["rows"], right["rows"])) / FEATURE_ROWS
    ratio_delta = abs(math.log(max(left["ratio"], 0.01) / max(right["ratio"], 0.01)))
    density_delta = abs(left["density"] - right["density"])
    return (2.0 * col_delta) + (0.7 * row_delta) + (0.75 * ratio_delta) + (0.7 * density_delta)


def parse_showinfo_times(log_file: Path) -> list[float]:
    pattern = re.compile(r"pts_time:([0-9.]+)")
    times: list[float] = []
    with log_file.open(encoding="utf-8", errors="ignore") as f:
        for line in f:
            match = pattern.search(line)
            if match:
                times.append(float(match.group(1)))
    return times


def sample_chunk(
    chunk_id: int,
    nominal_start: float,
    nominal_end: float,
    ffmpeg_start: float,
    ffmpeg_duration: float,
    args: argparse.Namespace,
) -> dict:
    raw_w = args.sample_scaled_w
    raw_h = args.sample_scaled_h
    frame_size = raw_w * raw_h * 3
    crop = TITLE_CROP
    vf = (
        f"crop={crop['w']}:{crop['h']}:{crop['x']}:{crop['y']},"
        f"scale={raw_w}:{raw_h},"
        f"fps={args.sample_fps},"
        "format=rgb24"
    )
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{ffmpeg_start:.3f}",
        "-t",
        f"{ffmpeg_duration:.3f}",
        "-i",
        str(VIDEO_FILE),
        "-vf",
        vf,
        "-an",
        "-f",
        "rawvideo",
        "-",
    ]
    samples: list[dict] = []
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    frame_index = 0
    last_ocr_mask: list[int] | None = None
    while True:
        frame = proc.stdout.read(frame_size)
        if not frame:
            break
        if len(frame) != frame_size:
            raise RuntimeError(f"short sampled frame in chunk {chunk_id}")
        time_value = ffmpeg_start + (frame_index / args.sample_fps)
        frame_index += 1
        if time_value < nominal_start or time_value >= nominal_end or time_value < args.min_time:
            continue
        feature = cyan_feature_from_rgb(frame, raw_w, raw_h)
        if feature is None:
            continue
        if feature["bbox_w"] < args.min_title_width or feature["ink"] < args.min_ink:
            continue
        samples.append({"time": time_value, "feature": feature})
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg sampled detection failed in chunk {chunk_id}")
    return {
        "chunkId": chunk_id,
        "nominalStart": nominal_start,
        "nominalEnd": nominal_end,
        "samples": samples,
    }


def counter_chunk(
    chunk_id: int,
    nominal_start: float,
    nominal_end: float,
    ffmpeg_start: float,
    ffmpeg_duration: float,
    args: argparse.Namespace,
    templates: dict[str, list[tuple[list[int], int, int]]],
) -> dict:
    crop = COUNTER_CROP
    raw_w = args.counter_scaled_w
    raw_h = args.counter_scaled_h
    frame_size = raw_w * raw_h * 3
    vf = (
        f"crop={crop['w']}:{crop['h']}:{crop['x']}:{crop['y']},"
        f"scale={raw_w}:{raw_h},"
        f"fps={args.sample_fps},"
        "format=rgb24"
    )
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{ffmpeg_start:.3f}",
        "-t",
        f"{ffmpeg_duration:.3f}",
        "-i",
        str(VIDEO_FILE),
        "-vf",
        vf,
        "-an",
        "-f",
        "rawvideo",
        "-",
    ]

    cards: dict[int, dict] = {}
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    frame_index = 0
    last_ocr_mask: list[int] | None = None
    while True:
        frame = proc.stdout.read(frame_size)
        if not frame:
            break
        if len(frame) != frame_size:
            raise RuntimeError(f"short counter frame in chunk {chunk_id}")
        time_value = ffmpeg_start + (frame_index / args.sample_fps)
        frame_index += 1
        if time_value < nominal_start or time_value >= nominal_end or time_value < args.min_time:
            continue

        mask = white_mask_from_rgb(frame, args.counter_threshold)
        if last_ocr_mask is not None and mask_change_score(last_ocr_mask, mask) < args.counter_change_threshold:
            continue

        counter_value, counter_score = parse_counter_from_mask(
            mask,
            raw_w,
            raw_h,
            templates,
            args,
        )
        if counter_value is None:
            continue
        last_ocr_mask = mask
        if counter_value in cards:
            continue

        cards[counter_value] = {
            "cardIndex": counter_value,
            "start": round(time_value, 3),
            "counterScore": round(counter_score or 0.0, 5),
        }

    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg counter detection failed in chunk {chunk_id}")
    return {
        "chunkId": chunk_id,
        "nominalStart": nominal_start,
        "nominalEnd": nominal_end,
        "cards": list(cards.values()),
    }


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
                raise RuntimeError(f"short raw frame in chunk {chunk_id}")
            features.append(cyan_feature_from_rgb(frame, raw_w, raw_h))
        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg scene detection failed in chunk {chunk_id}")

    times = parse_showinfo_times(log_file)
    if len(times) != len(features):
        raise RuntimeError(f"showinfo mismatch in chunk {chunk_id}: {len(times)} != {len(features)}")

    candidates: list[dict] = []
    for time_value, feature in zip(times, features):
        global_time = ffmpeg_start + time_value
        if global_time < args.min_time or feature is None:
            continue
        if global_time < nominal_start or global_time >= nominal_end:
            continue
        if feature["bbox_w"] < args.min_title_width or feature["ink"] < args.min_ink:
            continue
        candidates.append({"time": global_time, "feature": feature})

    return {
        "chunkId": chunk_id,
        "nominalStart": nominal_start,
        "nominalEnd": nominal_end,
        "candidates": candidates,
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


def collect_title_samples(args: argparse.Namespace, duration: float) -> list[dict]:
    chunks = build_detect_chunks(duration, args)
    jobs = args.jobs or min(4, os.cpu_count() or 1)
    jobs = max(1, min(jobs, len(chunks)))
    print(
        f"Sampling title features: {len(chunks)} chunks, {jobs} jobs, "
        f"fps={args.sample_fps}",
        flush=True,
    )
    samples: list[dict] = []
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as executor:
        future_map = {
            executor.submit(sample_chunk, chunk_id, start, end, ff_start, ff_dur, args): chunk_id
            for chunk_id, start, end, ff_start, ff_dur in chunks
        }
        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            result = future.result()
            completed += 1
            samples.extend(result["samples"])
            elapsed = time.time() - started
            print(
                f"  title chunk {completed}/{len(chunks)}: "
                f"+{len(result['samples'])}, total {len(samples)}, elapsed {elapsed:.1f}s",
                flush=True,
            )
    samples.sort(key=lambda item: item["time"])
    return samples


def attach_title_features(cards: list[dict], args: argparse.Namespace, duration: float) -> None:
    samples = collect_title_samples(args, duration)
    missing = 0
    cursor = 0
    for card in cards:
        while cursor + 1 < len(samples) and samples[cursor + 1]["time"] <= card["start"]:
            cursor += 1
        window = samples[max(0, cursor - 2) : min(len(samples), cursor + 5)]
        candidates = [
            sample
            for sample in window
            if card["start"] - 0.30 <= sample["time"] <= card["start"] + 0.45
        ]
        if not candidates:
            missing += 1
            continue
        best = min(candidates, key=lambda sample: abs(sample["time"] - card["start"]))
        card["feature"] = best["feature"]
        card["featureTime"] = round(best["time"], 3)
    if missing:
        print(f"WARNING: missing title features for {missing} counter cards", flush=True)


def counter_detect_cards(args: argparse.Namespace) -> list[dict]:
    WORK_DIR.mkdir(exist_ok=True)
    templates = build_counter_templates(args)
    duration = ffprobe_duration(VIDEO_FILE)
    chunks = build_detect_chunks(duration, args)
    jobs = args.jobs or min(4, os.cpu_count() or 1)
    jobs = max(1, min(jobs, len(chunks)))
    print(
        f"Detecting video cards by screen counter: {len(chunks)} chunks, "
        f"{jobs} jobs, fps={args.sample_fps}, duration {duration:.1f}s",
        flush=True,
    )

    by_index: dict[int, dict] = {}
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as executor:
        future_map = {
            executor.submit(counter_chunk, chunk_id, start, end, ff_start, ff_dur, args, templates): chunk_id
            for chunk_id, start, end, ff_start, ff_dur in chunks
        }
        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            result = future.result()
            completed += 1
            for card in result["cards"]:
                existing = by_index.get(card["cardIndex"])
                if existing is None or card["start"] < existing["start"]:
                    by_index[card["cardIndex"]] = card
            elapsed = time.time() - started
            print(
                f"  counter chunk {completed}/{len(chunks)}: "
                f"+{len(result['cards'])}, unique {len(by_index)}, elapsed {elapsed:.1f}s",
                flush=True,
            )

    missing = [idx for idx in range(1, EXPECTED_CARDS + 1) if idx not in by_index]
    cards = [by_index[idx] for idx in sorted(by_index)]
    for i, card in enumerate(cards):
        card["end"] = cards[i + 1]["start"] if i + 1 < len(cards) else round(duration, 3)

    attach_title_features(cards, args, duration)

    CARDS_FILE.write_text(json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Counter-detected {len(cards)} cards -> {CARDS_FILE}", flush=True)
    if missing:
        preview = ", ".join(str(idx) for idx in missing[:20])
        print(f"WARNING: missing {len(missing)} screen counters: {preview}", flush=True)
    return cards


def sample_detect_cards(args: argparse.Namespace) -> list[dict]:
    WORK_DIR.mkdir(exist_ok=True)
    duration = ffprobe_duration(VIDEO_FILE)
    chunks = build_detect_chunks(duration, args)
    jobs = args.jobs or min(4, os.cpu_count() or 1)
    jobs = max(1, min(jobs, len(chunks)))
    print(
        f"Sampling video cards: {len(chunks)} chunks, {jobs} jobs, "
        f"fps={args.sample_fps}, duration {duration:.1f}s",
        flush=True,
    )

    samples: list[dict] = []
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as executor:
        future_map = {
            executor.submit(sample_chunk, chunk_id, start, end, ff_start, ff_dur, args): chunk_id
            for chunk_id, start, end, ff_start, ff_dur in chunks
        }
        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            result = future.result()
            completed += 1
            samples.extend(result["samples"])
            elapsed = time.time() - started
            print(
                f"  sample chunk {completed}/{len(chunks)}: "
                f"+{len(result['samples'])}, total {len(samples)}, elapsed {elapsed:.1f}s",
                flush=True,
            )

    samples.sort(key=lambda item: item["time"])
    cards: list[dict] = []
    last_feature: dict | None = None
    last_start = -999.0
    for item in samples:
        feature = item["feature"]
        if not cards:
            cards.append({"cardIndex": 1, "start": round(item["time"], 3), "feature": feature})
            last_feature = feature
            last_start = item["time"]
            continue
        if item["time"] - last_start < args.min_gap:
            continue
        distance = feature_distance(last_feature, feature)
        if distance >= args.sample_change_threshold:
            cards.append(
                {
                    "cardIndex": len(cards) + 1,
                    "start": round(item["time"], 3),
                    "feature": feature,
                    "changeScore": round(distance, 5),
                }
            )
            last_feature = feature
            last_start = item["time"]

    for i, card in enumerate(cards):
        card["end"] = cards[i + 1]["start"] if i + 1 < len(cards) else round(duration, 3)

    CARDS_FILE.write_text(json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Sample-detected {len(cards)} cards -> {CARDS_FILE}", flush=True)
    if len(cards) != EXPECTED_CARDS:
        print(
            f"WARNING: expected {EXPECTED_CARDS} cards, got {len(cards)}. "
            "Tune --sample-fps or --sample-change-threshold before full build.",
            flush=True,
        )
    return cards


def scene_detect_cards(args: argparse.Namespace) -> list[dict]:
    WORK_DIR.mkdir(exist_ok=True)
    args.detect_log_dir = WORK_DIR / "detect_logs" / f"run_{int(time.time())}_{os.getpid()}"
    args.detect_log_dir.mkdir(parents=True, exist_ok=True)
    duration = ffprobe_duration(VIDEO_FILE)
    chunks = build_detect_chunks(duration, args)
    jobs = args.jobs or min(4, os.cpu_count() or 1)
    jobs = max(1, min(jobs, len(chunks)))
    print(
        f"Detecting video cards: {len(chunks)} chunks, {jobs} jobs, duration {duration:.1f}s",
        flush=True,
    )

    raw_cards: list[dict] = []
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as executor:
        future_map = {
            executor.submit(detect_chunk, chunk_id, start, end, ff_start, ff_dur, args): chunk_id
            for chunk_id, start, end, ff_start, ff_dur in chunks
        }
        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            result = future.result()
            completed += 1
            raw_cards.extend(result["candidates"])
            elapsed = time.time() - started
            print(
                f"  cards chunk {completed}/{len(chunks)}: "
                f"+{len(result['candidates'])}, total {len(raw_cards)}, elapsed {elapsed:.1f}s",
                flush=True,
            )

    raw_cards.sort(key=lambda item: item["time"])
    cards: list[dict] = []
    last_time = -999.0
    for item in raw_cards:
        if item["time"] - last_time < args.min_gap:
            continue
        cards.append(
            {
                "cardIndex": len(cards) + 1,
                "start": round(item["time"], 3),
                "feature": item["feature"],
            }
        )
        last_time = item["time"]

    for i, card in enumerate(cards):
        card["end"] = cards[i + 1]["start"] if i + 1 < len(cards) else round(duration, 3)

    CARDS_FILE.write_text(json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Scene-detected {len(cards)} cards -> {CARDS_FILE}", flush=True)
    if len(cards) != EXPECTED_CARDS:
        print(
            f"WARNING: expected {EXPECTED_CARDS} cards, got {len(cards)}. "
            "Tune --scene-threshold or --min-gap before full build.",
            flush=True,
        )
    return cards


def ensure_cards(args: argparse.Namespace) -> list[dict]:
    if CARDS_FILE.exists() and not args.rebuild_cards:
        cards = json.loads(CARDS_FILE.read_text(encoding="utf-8"))
        print(f"Loaded {len(cards)} video cards from {CARDS_FILE}", flush=True)
        return cards

    if args.detect_mode == "counter":
        return counter_detect_cards(args)
    if args.detect_mode == "scene":
        return scene_detect_cards(args)
    return sample_detect_cards(args)


def ensure_silence(args: argparse.Namespace) -> Path:
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
        f"Scanning audio silence: {duration:.1f}s, noise={args.silence_noise}, "
        f"d={args.silence_duration}",
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
                parsed = parse_time(value)
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
                print(f"  silence {current_time:.1f}/{duration:.1f}s ({percent:.1f}%)", flush=True)
                last_report = now
        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg silence detection failed: {proc.returncode}")
    print(f"Wrote silence log -> {SILENCE_FILE}", flush=True)
    return SILENCE_FILE


def parse_silence_file(path: Path, duration: float, min_duration: float) -> list[tuple[float, float]]:
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
    return [(s, e) for s, e in nonsilent if e - s >= min_duration]


def load_template_features(words: list[dict], fonts: tuple[str, ...], args: argparse.Namespace) -> dict:
    word_list = [item["w"] for item in words]
    cache_key = {
        "words": word_list,
        "fonts": list(fonts),
        "cols": FEATURE_COLS,
        "rows": FEATURE_ROWS,
    }
    if TEMPLATES_FILE.exists() and not args.rebuild_templates:
        cached = json.loads(TEMPLATES_FILE.read_text(encoding="utf-8"))
        if cached.get("cacheKey") == cache_key:
            return cached["features"]

    total = len(word_list) * len(fonts)
    jobs = args.template_jobs or min(4, os.cpu_count() or 1)
    jobs = max(1, min(jobs, total))
    print(f"Rendering {total} word templates with {jobs} jobs -> {TEMPLATES_FILE}", flush=True)
    features: dict[str, list[dict | None]] = {font: [None] * len(word_list) for font in fonts}
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
                print(f"  templates {completed}/{total}, elapsed {elapsed:.1f}s", flush=True)

    TEMPLATES_FILE.write_text(
        json.dumps({"cacheKey": cache_key, "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )
    return features


def recognize_cards(cards: list[dict], args: argparse.Namespace) -> tuple[list[dict], list[dict]]:
    words = read_words()
    fonts = tuple(part for part in args.fonts.split(",") if part)
    templates = load_template_features(words, fonts, args)
    n_cards = len(cards)
    n_words = len(words)
    max_skips = n_words - n_cards
    if max_skips < 0:
        raise RuntimeError(f"word list has fewer entries ({n_words}) than cards ({n_cards})")

    print(
        f"Recognizing card words by visual sequence alignment: "
        f"{n_cards} cards, {n_words} words, {max_skips} expected skips",
        flush=True,
    )

    score_cache: dict[tuple[int, int], float] = {}

    def best_score(card_i: int, word_i: int) -> float:
        key = (card_i, word_i)
        if key in score_cache:
            return score_cache[key]
        feature = cards[card_i]["feature"]
        value = min(feature_score(feature, templates[font][word_i]) for font in fonts)
        score_cache[key] = value
        return value

    prev: dict[int, float] = {0: best_score(0, 0)}
    backs: list[dict[int, int | None]] = [{0: None}]
    for i in range(1, n_cards):
        current: dict[int, float] = {}
        current_back: dict[int, int | None] = {}
        min_k = i
        max_k = min(n_words - 1, i + max_skips)
        for k in range(min_k, max_k + 1):
            visual = best_score(i, k)
            best_cost = float("inf")
            best_prev: int | None = None
            for prev_k, prev_cost in prev.items():
                if prev_k >= k:
                    continue
                gap = k - prev_k - 1
                if gap > args.max_gap:
                    continue
                cost = prev_cost + visual + args.gap_penalty * gap * gap
                if cost < best_cost:
                    best_cost = cost
                    best_prev = prev_k
            if best_prev is not None:
                current[k] = best_cost
                current_back[k] = best_prev
        if not current:
            raise RuntimeError(f"recognition alignment failed at card {i + 1}")
        prev = current
        backs.append(current_back)
        if i % 500 == 0:
            print(f"  recognized path {i}/{n_cards}", flush=True)

    end_index = n_words - 1 if n_words - 1 in prev else min(prev, key=prev.get)
    if end_index != n_words - 1:
        print(f"WARNING: alignment ended at word #{end_index + 1}, not #{n_words}", flush=True)
    path = [end_index]
    for i in range(n_cards - 1, 0, -1):
        parent = backs[i][path[-1]]
        if parent is None:
            raise RuntimeError("broken recognition backpointer")
        path.append(parent)
    path.reverse()

    records: list[dict] = []
    selected = set(path)
    skipped = [{"wordIndex": idx + 1, "word": words[idx]["w"]} for idx in range(n_words) if idx not in selected]
    for i, word_index in enumerate(path):
        word = words[word_index]["w"]
        records.append(
            {
                "cardIndex": i + 1,
                "wordIndex": word_index + 1,
                "recognizedWord": word,
                "visualScore": round(best_score(i, word_index), 5),
            }
        )
    print(f"Recognition produced {len(records)} records; skipped {len(skipped)} word-list entries", flush=True)
    return records, skipped


def assign_segments(cards: list[dict], recognitions: list[dict], args: argparse.Namespace) -> list[dict]:
    duration = ffprobe_duration(AUDIO_FILE)
    silence_path = ensure_silence(args)
    nonsilent = parse_silence_file(silence_path, duration, args.min_speech_duration)
    print(f"Loaded {len(nonsilent)} non-silent intervals from {silence_path}", flush=True)

    segments: list[dict] = []
    speech_cursor = 0
    for i, card in enumerate(cards):
        window_start = card["start"] - args.assign_pad_before
        window_end = card["end"] + args.assign_pad_after
        chosen: tuple[int, float, float] | None = None
        for idx in range(speech_cursor, len(nonsilent)):
            start, end = nonsilent[idx]
            mid = (start + end) / 2.0
            if window_start <= mid <= window_end:
                chosen = (idx, start, end)
                break
            if mid > window_end:
                break

        if chosen:
            speech_index, raw_start, raw_end = chosen
            speech_cursor = speech_index + 1
            clip_start = max(0.0, raw_start - args.clip_pad_before)
            clip_end = min(duration, raw_end + args.clip_pad_after)
            source = "silence"
        else:
            clip_start = max(0.0, card["start"])
            clip_end = min(duration, card["start"] + args.fallback_duration)
            speech_index = None
            source = "fallback_card_window"

        if clip_end <= clip_start:
            clip_end = min(duration, clip_start + args.fallback_duration)

        recognition = recognitions[i] if i < len(recognitions) else {}
        word = recognition.get("recognizedWord", "unknown")
        word_index = recognition.get("wordIndex")
        dirname = f"{card['cardIndex']:04d}_w{word_index:04d}_{safe_name(word)}" if word_index else f"{card['cardIndex']:04d}_unknown"
        segments.append(
            {
                "audioIndex": card["cardIndex"],
                "cardIndex": card["cardIndex"],
                "wordIndex": word_index,
                "recognizedWord": word,
                "visualScore": recognition.get("visualScore"),
                "start": round(clip_start, 3),
                "end": round(clip_end, 3),
                "mid": round((clip_start + clip_end) / 2.0, 3),
                "cardStart": card["start"],
                "cardEnd": card["end"],
                "speechIndex": speech_index,
                "segmentSource": source,
                "dir": dirname,
            }
        )
    return segments


def analyze_audio_interval(
    item: tuple[int, tuple[float, float]],
    templates: dict[str, list[tuple[list[int], int, int]]],
    args: argparse.Namespace,
) -> dict:
    interval_index, (start, end) = item
    mid = (start + end) / 2.0
    frame = extract_review_frame(mid)
    frame_w = SAMPLE_CROP["w"]
    counter_region = (
        COUNTER_CROP["x"] - SAMPLE_CROP["x"],
        COUNTER_CROP["y"] - SAMPLE_CROP["y"],
        COUNTER_CROP["w"],
        COUNTER_CROP["h"],
    )
    title_region = (
        TITLE_CROP["x"] - SAMPLE_CROP["x"],
        TITLE_CROP["y"] - SAMPLE_CROP["y"],
        TITLE_CROP["w"],
        TITLE_CROP["h"],
    )
    counter = extract_rgb_region(frame, frame_w, *counter_region)
    counter_value, counter_score = parse_counter_from_rgb(
        counter,
        counter_region[2],
        counter_region[3],
        templates,
        args,
    )
    title = extract_rgb_region(frame, frame_w, *title_region)
    feature = cyan_feature_from_rgb(title, title_region[2], title_region[3])
    return {
        "intervalIndex": interval_index,
        "start": start,
        "end": end,
        "mid": mid,
        "duration": end - start,
        "counter": counter_value,
        "counterScore": counter_score,
        "feature": feature,
    }


def choose_audio_interval(candidates: list[dict]) -> dict:
    return max(candidates, key=lambda item: (item["duration"], -item["intervalIndex"]))


def counter_assign_cost(item: dict, expected_counter: int) -> float:
    cost = 0.0
    counter = item.get("counter")
    if counter is None:
        cost += 1.5
    else:
        delta = abs(counter - expected_counter)
        if delta == 0:
            cost += min(float(item.get("counterScore") or 0.0), 0.5)
        elif delta <= 12:
            cost += 0.20 * delta
        else:
            cost += 8.0 + min(delta / 100.0, 10.0)
    if item.get("feature") is None:
        cost += 5.0
    duration = item["duration"]
    if duration < 0.18:
        cost += 1.0
    elif duration < 0.28:
        cost += 0.35
    cost -= min(duration, 0.9) * 0.03
    return cost


def counter_skip_cost(item: dict, expected_counter: int) -> float:
    cost = 0.08
    counter = item.get("counter")
    if counter == expected_counter:
        cost += 3.0
    elif counter is not None and abs(counter - expected_counter) <= 1:
        cost += 1.0
    if item["duration"] > 0.45:
        cost += 0.25
    return cost


def align_audio_intervals_to_counters(analyzed: list[dict], args: argparse.Namespace) -> list[dict]:
    items = [item for item in analyzed if item.get("feature") is not None]
    items.sort(key=lambda item: item["mid"])
    dropped = len(analyzed) - len(items)
    n = EXPECTED_CARDS
    m = len(items)
    if m < n:
        raise SystemExit(f"only {m} usable audio intervals for {n} counters; dropped {dropped}")
    extras = m - n
    print(f"Aligning {m} usable intervals to {n} counters; skipping {extras} extras", flush=True)

    inf = float("inf")
    prev = [[inf] * (extras + 1) for _ in range(n + 1)]
    back: list[list[tuple[int, int, str] | None]] = [
        [None] * (extras + 1) for _ in range(n + 1)
    ]
    prev[0][0] = 0.0

    for i in range(n + 1):
        for skipped in range(extras + 1):
            current = prev[i][skipped]
            if current == inf:
                continue
            consumed = i + skipped
            if consumed >= m:
                continue
            item = items[consumed]
            expected = i + 1
            if skipped < extras:
                value = current + counter_skip_cost(item, expected)
                if value < prev[i][skipped + 1]:
                    prev[i][skipped + 1] = value
                    back[i][skipped + 1] = (i, skipped, "skip")
            if i < n:
                value = current + counter_assign_cost(item, expected)
                if value < prev[i + 1][skipped]:
                    prev[i + 1][skipped] = value
                    back[i + 1][skipped] = (i, skipped, "assign")

    if prev[n][extras] == inf:
        raise SystemExit("failed to align audio intervals to 6556 counters")

    selected: list[dict] = []
    i = n
    skipped = extras
    while i > 0 or skipped > 0:
        parent = back[i][skipped]
        if parent is None:
            raise RuntimeError("broken audio-counter alignment backpointer")
        parent_i, parent_skipped, action = parent
        consumed_before = parent_i + parent_skipped
        if action == "assign":
            selected.append(items[consumed_before])
        i = parent_i
        skipped = parent_skipped
    selected.reverse()

    for counter, item in enumerate(selected, start=1):
        item["alignedCounter"] = counter
        item["alignmentCost"] = round(counter_assign_cost(item, counter), 5)
    mismatches = [
        item
        for item in selected
        if item.get("counter") is not None and item["counter"] != item["alignedCounter"]
    ]
    print(
        f"Audio-counter alignment selected {len(selected)} intervals; "
        f"{len(mismatches)} OCR mismatches corrected",
        flush=True,
    )
    if mismatches:
        preview = ", ".join(
            f"{item['alignedCounter']}<-ocr{item['counter']}" for item in mismatches[:20]
        )
        print(f"  corrected preview: {preview}", flush=True)
    return selected


def build_audio_counter_segments(args: argparse.Namespace) -> tuple[list[dict], list[dict]]:
    duration = ffprobe_duration(AUDIO_FILE)
    silence_path = ensure_silence(args)
    intervals = parse_silence_file(silence_path, duration, args.min_speech_duration)
    intervals = [(start, end) for start, end in intervals if ((start + end) / 2.0) >= args.min_time]
    templates = build_counter_templates(args)

    jobs = args.jobs or min(4, os.cpu_count() or 1)
    jobs = max(1, min(jobs, len(intervals)))
    print(
        f"Analyzing {len(intervals)} audio intervals by midpoint screenshot with {jobs} jobs",
        flush=True,
    )
    analyzed: list[dict] = []
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as executor:
        future_map = {
            executor.submit(analyze_audio_interval, item, templates, args): item[0]
            for item in enumerate(intervals, start=1)
        }
        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            result = future.result()
            analyzed.append(result)
            completed += 1
            if (
                completed == 1
                or completed % args.analysis_progress_every == 0
                or completed == len(intervals)
            ):
                elapsed = time.time() - started
                rate = completed / elapsed if elapsed else 0.0
                remaining = (len(intervals) - completed) / rate if rate else 0.0
                valid = sum(1 for item in analyzed if item["counter"] is not None)
                print(
                    f"  analyzed {completed}/{len(intervals)} "
                    f"({completed * 100 / len(intervals):.1f}%), "
                    f"valid counters {valid}, {rate:.2f}/s, eta {remaining:.0f}s",
                    flush=True,
                )

    invalid = [item for item in analyzed if item["counter"] is None or item["feature"] is None]
    print(f"Audio midpoint OCR invalid/featureless intervals: {len(invalid)}", flush=True)
    selected = align_audio_intervals_to_counters(analyzed, args)

    cards: list[dict] = []
    for counter, chosen in enumerate(selected, start=1):
        cards.append(
            {
                "cardIndex": counter,
                "start": round(chosen["mid"], 3),
                "end": round(chosen["mid"], 3),
                "feature": chosen["feature"],
                "featureTime": round(chosen["mid"], 3),
                "counterScore": round(chosen["counterScore"] or 0.0, 5),
                "sourceIntervalIndex": chosen["intervalIndex"],
                "ocrCounter": chosen.get("counter"),
                "alignmentCost": chosen.get("alignmentCost"),
            }
        )

    recognitions, skipped = recognize_cards(cards, args)
    recognition_by_counter = {record["cardIndex"]: record for record in recognitions}
    segments: list[dict] = []
    for card, chosen in zip(cards, selected):
        counter = card["cardIndex"]
        recognition = recognition_by_counter.get(counter, {})
        word = recognition.get("recognizedWord", "unknown")
        word_index = recognition.get("wordIndex")
        clip_start = max(0.0, chosen["start"] - args.clip_pad_before)
        clip_end = min(duration, chosen["end"] + args.clip_pad_after)
        dirname = (
            f"{counter:04d}_w{word_index:04d}_{safe_name(word)}"
            if word_index
            else f"{counter:04d}_unknown"
        )
        segments.append(
            {
                "audioIndex": counter,
                "cardIndex": counter,
                "wordIndex": word_index,
                "recognizedWord": word,
                "visualScore": recognition.get("visualScore"),
                "start": round(clip_start, 3),
                "end": round(clip_end, 3),
                "mid": round(chosen["mid"], 3),
                "cardStart": round(chosen["mid"], 3),
                "cardEnd": round(chosen["mid"], 3),
                "speechIndex": chosen["intervalIndex"],
                "segmentSource": "audio_counter_midpoint",
                "counterScore": round(chosen["counterScore"] or 0.0, 5),
                "ocrCounter": chosen.get("counter"),
                "alignmentCost": chosen.get("alignmentCost"),
                "dir": dirname,
            }
        )
    return segments, skipped


def ensure_segments(args: argparse.Namespace) -> list[dict]:
    if SEGMENTS_FILE.exists() and not args.rebuild_segments:
        payload = json.loads(SEGMENTS_FILE.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            segments = payload.get("segments", [])
            cached_mode = payload.get("segmentSourceMode")
        else:
            segments = payload
            cached_mode = None

        first_source = segments[0].get("segmentSource") if segments else None
        is_audio_counter = cached_mode == "audio-counter" or first_source == "audio_counter_midpoint"
        cache_matches = (
            (args.segment_source == "audio-counter" and is_audio_counter)
            or (args.segment_source == "cards" and not is_audio_counter)
        )
        if cache_matches:
            print(f"Loaded {len(segments)} segments from {SEGMENTS_FILE}", flush=True)
            return segments
        print(
            f"Ignoring stale segment cache in {SEGMENTS_FILE}; "
            f"requested source is {args.segment_source}",
            flush=True,
        )

    if args.segment_source == "audio-counter":
        segments, skipped = build_audio_counter_segments(args)
    else:
        cards = ensure_cards(args)
        if len(cards) != EXPECTED_CARDS and not args.allow_card_count_mismatch:
            raise SystemExit(
                f"card count is {len(cards)}, expected {EXPECTED_CARDS}; "
                "adjust detection parameters or pass --allow-card-count-mismatch for debugging"
            )
        recognitions, skipped = recognize_cards(cards, args)
        segments = assign_segments(cards, recognitions, args)
    payload = {
        "sourceVideo": VIDEO_FILE.name,
        "sourceAudio": AUDIO_FILE.name,
        "segmentSourceMode": args.segment_source,
        "count": len(segments),
        "expectedCount": EXPECTED_CARDS,
        "skippedWordCount": len(skipped),
        "skippedWords": skipped,
        "segments": segments,
    }
    SEGMENTS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(segments)} segment records -> {SEGMENTS_FILE}", flush=True)
    return segments


def selected_segments(segments: list[dict], args: argparse.Namespace) -> list[dict]:
    if args.indices:
        wanted = {int(part) for part in args.indices.split(",") if part.strip()}
        segments = [item for item in segments if item["audioIndex"] in wanted]
    if args.start and args.start > 1:
        segments = [item for item in segments if item["audioIndex"] >= args.start]
    if args.limit and args.limit > 0:
        segments = segments[: args.limit]
    return segments


def segment_dir(segment: dict) -> Path:
    return OUTPUT_DIR / segment["dir"]


def segment_files(segment: dict) -> list[Path]:
    out_dir = segment_dir(segment)
    return [
        out_dir / "audio.m4a",
        out_dir / "screenshot.png",
        out_dir / "word_crop.png",
        out_dir / "recognized_word.txt",
        out_dir / "meta.json",
    ]


def segment_complete(segment: dict) -> bool:
    return all(path.exists() and path.stat().st_size > 0 for path in segment_files(segment))


def write_manifest(segments: list[dict]) -> None:
    manifest_records = [
        {"audioIndex": segment["audioIndex"], "dir": segment["dir"]}
        for segment in segments
        if segment_complete(segment)
    ]
    manifest_records.sort(key=lambda item: item["audioIndex"])
    manifest = {
        "sourceVideo": VIDEO_FILE.name,
        "sourceAudio": AUDIO_FILE.name,
        "count": len(manifest_records),
        "expectedCount": EXPECTED_CARDS,
        "records": manifest_records,
    }
    (OUTPUT_DIR / "dataset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def render_segment(segment: dict, args: argparse.Namespace) -> dict:
    out_dir = segment_dir(segment)
    out_dir.mkdir(parents=True, exist_ok=True)
    audio_path = out_dir / "audio.m4a"
    screenshot_path = out_dir / "screenshot.png"
    crop_path = out_dir / "word_crop.png"
    recognized_path = out_dir / "recognized_word.txt"
    meta_path = out_dir / "meta.json"

    duration = max(0.05, segment["end"] - segment["start"])
    audio_cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{segment['start']:.3f}",
        "-i",
        str(AUDIO_FILE),
        "-t",
        f"{duration:.3f}",
        "-vn",
    ]
    if args.reencode_audio:
        audio_cmd.extend(["-c:a", "aac", "-b:a", "96k"])
    else:
        audio_cmd.extend(["-c", "copy"])
    audio_cmd.append(str(audio_path))
    run(audio_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    screenshot_cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{segment['mid']:.3f}",
        "-i",
        str(VIDEO_FILE),
        "-frames:v",
        "1",
        str(screenshot_path),
    ]
    run(screenshot_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    crop = TITLE_CROP
    crop_cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{segment['mid']:.3f}",
        "-i",
        str(VIDEO_FILE),
        "-vf",
        f"crop={crop['w']}:{crop['h']}:{crop['x']}:{crop['y']}",
        "-frames:v",
        "1",
        str(crop_path),
    ]
    run(crop_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    recognized_path.write_text(f"{segment['recognizedWord']}\n", encoding="utf-8")
    meta = {
        "audioIndex": segment["audioIndex"],
        "cardIndex": segment["cardIndex"],
        "wordIndex": segment.get("wordIndex"),
        "recognizedWord": segment["recognizedWord"],
        "visualScore": segment.get("visualScore"),
        "start": segment["start"],
        "end": segment["end"],
        "mid": segment["mid"],
        "cardStart": segment["cardStart"],
        "cardEnd": segment["cardEnd"],
        "speechIndex": segment.get("speechIndex"),
        "segmentSource": segment["segmentSource"],
        "expectedScreenCounter": segment["cardIndex"],
        "ocrCounter": segment.get("ocrCounter"),
        "counterScore": segment.get("counterScore"),
        "alignmentCost": segment.get("alignmentCost"),
        "audio": "audio.m4a",
        "screenshot": "screenshot.png",
        "wordCrop": "word_crop.png",
        "sourceAudio": AUDIO_FILE.name,
        "sourceVideo": VIDEO_FILE.name,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"audioIndex": segment["audioIndex"], "dir": segment["dir"]}


def prepare_output(args: argparse.Namespace) -> None:
    if OUTPUT_DIR.exists() and args.force:
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(exist_ok=True)


def build_dataset(args: argparse.Namespace) -> None:
    all_segments = ensure_segments(args)
    segments = selected_segments(all_segments, args)
    if not segments:
        raise SystemExit("no segments selected")
    prepare_output(args)
    if args.rerender_existing:
        to_render = segments
        skipped_existing = 0
    else:
        to_render = [segment for segment in segments if not segment_complete(segment)]
        skipped_existing = len(segments) - len(to_render)
    if not to_render:
        write_manifest(all_segments)
        print(
            f"All {len(segments)} selected directories are already complete; "
            f"manifest -> {OUTPUT_DIR / 'dataset_manifest.json'}",
            flush=True,
        )
        return
    jobs = args.jobs or min(4, os.cpu_count() or 1)
    jobs = max(1, min(jobs, len(to_render)))
    print(
        f"Rendering {len(to_render)} review directories with {jobs} jobs -> {OUTPUT_DIR} "
        f"({skipped_existing} already complete)",
        flush=True,
    )
    started = time.time()
    manifest_records: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as executor:
        future_map = {executor.submit(render_segment, segment, args): segment for segment in to_render}
        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            result = future.result()
            manifest_records.append(result)
            completed += 1
            if completed == 1 or completed % args.progress_every == 0 or completed == len(to_render):
                elapsed = time.time() - started
                rate = completed / elapsed if elapsed else 0.0
                remaining = (len(to_render) - completed) / rate if rate else 0.0
                print(
                    f"  rendered {completed}/{len(to_render)} "
                    f"({completed * 100 / len(to_render):.1f}%), "
                    f"{rate:.2f}/s, eta {remaining:.0f}s",
                    flush=True,
                )

    write_manifest(all_segments)
    print(f"Done. Dataset manifest -> {OUTPUT_DIR / 'dataset_manifest.json'}", flush=True)


def print_plan(args: argparse.Namespace) -> None:
    segments = ensure_segments(args)
    selected = selected_segments(segments, args)
    print(f"Total segments: {len(segments)}")
    print(f"Selected segments: {len(selected)}")
    for item in selected[:20]:
        print(
            f"{item['audioIndex']:04d}: {item['recognizedWord']} "
            f"{item['start']:.3f}-{item['end']:.3f}s mid={item['mid']:.3f}s "
            f"source={item['segmentSource']}"
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--jobs", type=int, default=0, help="parallel jobs; default min(4, CPU count)")
    common.add_argument("--segment-source", choices=["audio-counter", "cards"], default="audio-counter")
    common.add_argument("--analysis-progress-every", type=int, default=100)
    common.add_argument("--scene-threshold", type=float, default=0.018)
    common.add_argument("--detect-mode", choices=["counter", "sample", "scene"], default="sample")
    common.add_argument("--sample-fps", type=float, default=4.0)
    common.add_argument("--sample-change-threshold", type=float, default=0.08)
    common.add_argument("--sample-scaled-w", type=int, default=180)
    common.add_argument("--sample-scaled-h", type=int, default=30)
    common.add_argument("--counter-scaled-w", type=int, default=260)
    common.add_argument("--counter-scaled-h", type=int, default=60)
    common.add_argument("--counter-threshold", type=int, default=80)
    common.add_argument("--counter-max-distance", type=float, default=0.35)
    common.add_argument("--counter-change-threshold", type=float, default=0.03)
    common.add_argument("--min-time", type=float, default=6.5)
    common.add_argument("--min-gap", type=float, default=0.45)
    common.add_argument("--min-title-width", type=int, default=25)
    common.add_argument("--min-ink", type=int, default=80)
    common.add_argument("--chunk-duration", type=float, default=300.0)
    common.add_argument("--chunk-overlap", type=float, default=2.0)
    common.add_argument("--max-chunks", type=int, default=0)
    common.add_argument("--rebuild-cards", action="store_true")
    common.add_argument("--rebuild-silence", action="store_true")
    common.add_argument("--rebuild-templates", action="store_true")
    common.add_argument("--rebuild-segments", action="store_true")
    common.add_argument("--allow-card-count-mismatch", action="store_true")
    common.add_argument("--silence-file", default="")
    common.add_argument("--silence-noise", default="-35dB")
    common.add_argument("--silence-duration", type=float, default=0.18)
    common.add_argument("--min-speech-duration", type=float, default=0.08)
    common.add_argument("--assign-pad-before", type=float, default=0.25)
    common.add_argument("--assign-pad-after", type=float, default=0.25)
    common.add_argument("--clip-pad-before", type=float, default=0.02)
    common.add_argument("--clip-pad-after", type=float, default=0.04)
    common.add_argument("--fallback-duration", type=float, default=1.2)
    common.add_argument("--fonts", default=",".join(DEFAULT_FONTS))
    common.add_argument("--template-jobs", type=int, default=0)
    common.add_argument("--gap-penalty", type=float, default=0.005)
    common.add_argument("--max-gap", type=int, default=20)
    common.add_argument("--start", type=int, default=0)
    common.add_argument("--limit", type=int, default=0)
    common.add_argument("--indices", default="", help="comma-separated audio/card indices, e.g. 1,5410")

    plan = sub.add_parser("plan", parents=[common], help="build metadata and print selected segments")
    plan.set_defaults(func=print_plan)

    build = sub.add_parser("build", parents=[common], help="create review directories")
    build.add_argument("--force", action="store_true", help="remove existing audio_review_dataset first")
    build.add_argument("--rerender-existing", action="store_true", help="overwrite complete directories too")
    build.add_argument("--reencode-audio", action="store_true", help="re-encode clips instead of stream copy")
    build.add_argument("--progress-every", type=int, default=100)
    build.set_defaults(func=build_dataset)

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
