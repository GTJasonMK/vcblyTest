#!/usr/bin/env python3
"""将红宝书英音全集音频切分为每个单词的独立音频文件。"""

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = ROOT / "media" / "source"
AUDIO_FILE = MEDIA_DIR / "2023考研红宝书英音全集.m4a"
SILENCE_FILE = Path("/tmp/silence_data.txt")
WORDS_FILE = ROOT / "data" / "words_data.js"
OUTPUT_DIR = ROOT / "word_audio"
BATCH_SCRIPT = Path("/tmp/split_ffmpeg.sh")

# 1. 解析静音检测数据
silence_starts = []
silence_ends = []

with open(SILENCE_FILE) as f:
    for line in f:
        line = line.strip()
        if "silence_start:" in line:
            v = float(re.search(r"silence_start:\s*([\d.]+)", line).group(1))
            silence_starts.append(v)
        elif "silence_end:" in line:
            v = float(re.search(r"silence_end:\s*([\d.]+)", line).group(1))
            silence_ends.append(v)

print(f"静音起点数: {len(silence_starts)}")
print(f"静音终点数: {len(silence_ends)}")

# 2. 计算每个单词的时间段
# 单词段: (0, ss[0]), (se[0], ss[1]), ..., (se[n], EOF)
segments = []
segments.append((0.0, silence_starts[0]))  # 第一个单词从0开始

for i in range(len(silence_ends) - 1):
    start_t = silence_ends[i]
    end_t = silence_starts[i + 1]
    segments.append((start_t, end_t))

# 最后一个单词
if len(silence_ends) == len(silence_starts):
    # 最后一个静音终点到音频结束
    segments.append((silence_ends[-1], None))

print(f"切分段数: {len(segments)}")

# 3. 读取单词列表
with open(WORDS_FILE) as f:
    data = f.read()
words = re.findall(r'"w":\s*"([^"]+)"', data)
print(f"单词列表: {len(words)} 个")

# 4. 匹配: 跳过第一个段 (大概率是片头)，从第二个段开始对应单词列表
# 如果段数 > 单词数，尾部多余的丢弃
# 如果单词数 > 段数，尾部单词没有音频（记录警告）
match_start = 1  # 跳过片头
word_idx = 0  # 从第一个单词开始

print(f"匹配: 从第{match_start + 1}个音频段对应第1个单词 '{words[0]}'")

# 5. 生成 ffmpeg 批处理脚本
os.makedirs(OUTPUT_DIR, exist_ok=True)

with open(BATCH_SCRIPT, 'w') as script:
    script.write("#!/bin/bash\n")
    script.write(f'INPUT="{AUDIO_FILE}"\n')
    script.write(f'OUTDIR="{OUTPUT_DIR}"\n')
    script.write('set -e\n')

    count = 0
    for seg_idx in range(match_start, len(segments)):
        if word_idx >= len(words):
            print(f"警告: 音频段多于单词数，剩余 {len(segments) - seg_idx} 段被丢弃")
            break

        start_t, end_t = segments[seg_idx]
        if start_t is None:
            continue

        word = words[word_idx]
        # 文件名：序号_单词.m4a（序号用于保持顺序，也避免文件名非法字符问题）
        # 对文件名中的特殊字符做处理
        safe_word = word.replace('/', '_').replace('\\', '_').replace(':', '_')
        out_name = f"{word_idx + 1:04d}_{safe_word}.m4a"

        if end_t is None:
            # 最后一段，只指定起始时间
            script.write(
                f'ffmpeg -y -loglevel error -ss {start_t:.6f} -i "$INPUT" '
                f'-c copy "$OUTDIR/{out_name}"\n'
            )
        else:
            duration = end_t - start_t
            script.write(
                f'ffmpeg -y -loglevel error -ss {start_t:.6f} -i "$INPUT" '
                f'-t {duration:.6f} -c copy "$OUTDIR/{out_name}"\n'
            )

        count += 1
        word_idx += 1

    if word_idx < len(words):
        print(f"警告: 单词多于音频段，最后 {len(words) - word_idx} 个单词无对应音频")

print(f"生成 {count} 个音频文件")
print(f"批处理脚本: {BATCH_SCRIPT}")

# 打印部分示例
print("\n--- 前10个文件示例 ---")
with open(BATCH_SCRIPT) as f:
    lines = [l for l in f if l.startswith('ffmpeg')]
    for l in lines[:10]:
        out = re.search(r'\$OUTDIR/([^"]+)', l).group(1)
        print(f"  {out}")
