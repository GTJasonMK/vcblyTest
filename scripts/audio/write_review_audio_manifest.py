#!/usr/bin/env python3
"""Write data/audio_manifest.js from audio_review_dataset metadata."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEGMENTS_FILE = ROOT / ".audio_review_work" / "segments.json"
WORDS_FILE = ROOT / "words.json"
OUTPUT_DIR = ROOT / "audio_review_dataset"
MANIFEST_JS = ROOT / "data" / "audio_manifest.js"


def write_manifest(*, allow_missing: bool = False) -> None:
    segments = json.loads(SEGMENTS_FILE.read_text(encoding="utf-8"))["segments"]
    words = json.loads(WORDS_FILE.read_text(encoding="utf-8"))

    records: list[dict] = []
    by_index: dict[str, str] = {}
    by_word: dict[str, str] = {}
    missing: list[tuple[int, str]] = []

    for segment in sorted(segments, key=lambda item: item["audioIndex"]):
        word_index = segment.get("wordIndex")
        dirname = segment.get("dir")
        if not isinstance(word_index, int) or not dirname:
            continue

        audio_path = OUTPUT_DIR / dirname / "audio.m4a"
        if not audio_path.exists() or audio_path.stat().st_size <= 0:
            missing.append((segment["audioIndex"], dirname))
            continue

        word = words[word_index - 1]["w"] if 1 <= word_index <= len(words) else dirname.rsplit("_", 1)[-1]
        rel_path = f"{OUTPUT_DIR.name}/{dirname}/audio.m4a"
        by_index.setdefault(str(word_index), rel_path)
        by_word.setdefault(word, rel_path)
        records.append(
            {
                "audioIndex": segment["audioIndex"],
                "wordIndex": word_index,
                "word": word,
                "audio": rel_path,
            }
        )

    if missing and not allow_missing:
        preview = ", ".join(f"{idx}:{dirname}" for idx, dirname in missing[:10])
        raise SystemExit(f"missing audio files: {preview}")

    meta = {
        "source": OUTPUT_DIR.name,
        "count": len(records),
        "indexCount": len(by_index),
        "wordCount": len(by_word),
        "missing": len(missing),
    }
    lines = [
        "// Generated from audio_review_dataset. Do not edit by hand.",
        f"var AUDIO_MANIFEST_META = {json.dumps(meta, ensure_ascii=False, indent=2)};",
        f"var AUDIO_MANIFEST_BY_WORD_INDEX = {json.dumps(by_index, ensure_ascii=False, indent=2)};",
        f"var AUDIO_MANIFEST = {json.dumps(by_word, ensure_ascii=False, indent=2)};",
        "",
    ]
    MANIFEST_JS.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {len(records)} audio records -> {MANIFEST_JS}")
    print(f"Unique word indexes: {len(by_index)}; unique spellings: {len(by_word)}; missing: {len(missing)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-missing", action="store_true", help="write manifest even when some audio files are absent")
    args = parser.parse_args()
    write_manifest(allow_missing=args.allow_missing)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
