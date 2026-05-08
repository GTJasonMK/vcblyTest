#!/usr/bin/env python3
"""批量执行 ffmpeg 音频切分，带进度显示和错误处理。"""

import os
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CMDS_FILE = Path("/tmp/ffmpeg_cmds_fixed.txt")
OUT_DIR = ROOT / "word_audio"

os.makedirs(OUT_DIR, exist_ok=True)

with open(CMDS_FILE) as f:
    cmds = [line.strip() for line in f if line.strip()]

total = len(cmds)
print(f"总命令数: {total}")

success = 0
failed = 0
start_time = time.time()

for i, cmd in enumerate(cmds):
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, timeout=10)
        if result.returncode == 0:
            success += 1
        else:
            failed += 1
            err = result.stderr.decode()[:100] if result.stderr else "unknown"
            if failed <= 5:
                print(f"  [{i+1}] 失败: {err}")
    except subprocess.TimeoutExpired:
        failed += 1
        print(f"  [{i+1}] 超时")
    except Exception as e:
        failed += 1
        print(f"  [{i+1}] 异常: {e}")

    # 每500个报告进度
    if (i + 1) % 500 == 0:
        elapsed = time.time() - start_time
        rate = (i + 1) / elapsed
        eta = (total - i - 1) / rate
        print(f"进度: {i+1}/{total} ({100*(i+1)/total:.1f}%) | "
              f"速率: {rate:.1f}/s | 预计剩余: {eta:.0f}s | "
              f"成功: {success} 失败: {failed}")

elapsed = time.time() - start_time
print(f"\n完成! 耗时: {elapsed:.0f}s | 成功: {success} | 失败: {failed}")
print(f"输出目录: {OUT_DIR}")
print(f"文件总数: {len(os.listdir(OUT_DIR))}")
