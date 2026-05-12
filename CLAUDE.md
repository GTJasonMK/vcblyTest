# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

考研词汇随机测试的**纯静态网站**：HTML + CSS + 浏览器原生 ES 模块，无任何构建步骤、打包器或 npm 依赖。仓库根目录直接由 GitHub Pages（`.github/workflows/deploy.yml`，从 `master` 分支）部署。

`AGENTS.md` 是协作者指南（与本文件互补），描述了仓库结构、提交风格与手动测试要点；本文件聚焦于代码架构和工作流。

## 常用命令

```bash
# 本地开发：必须用 HTTP 服务器（js/main.js 通过 ES 模块加载，file:// 会失败）
bash serve.sh                 # 自动找可用端口并打开浏览器
python3 -m http.server 8000   # 或手工指定端口

# 音频流水线（仅在重新生成 word_audio/ 时用）
python3 scripts/audio/build_audio_review_dataset.py   # 从 media/source/ 重建 audio_review_dataset/
python3 scripts/audio/write_review_audio_manifest.py  # 重写 data/audio_manifest.js
python3 scripts/audio/split_audio.py                  # 从 /tmp/silence_data.txt 生成 ffmpeg 批脚本
python3 scripts/audio/run_split.py                    # 执行 /tmp/ffmpeg_cmds_fixed.txt 中的拆分
```

无构建命令、无 lint、无自动化测试。变更后必须本地起服务器并手动跑通：开始测试 → 选项 → 下一题 → 结果 → 错词本 → 历史 → localStorage 行为。

## 架构核心

### 模块职责（`js/`）

入口 `main.js` 把会话动作挂到 `window.*`，因为 `index.html` 中按钮使用 inline `onclick`。修改公共动作签名时务必同步 main.js 的 `window.xxx = …` 桥接。

- `state.js` —— 单例状态：`allWords`、`settings`、`session`。`session` 形状由 `createEmptySession()` 定义；新增字段后必须同步 `restoreSession`、`saveSession` 的 slim 字段、以及导入/导出。
- `session.js` —— 测试主流程（开始/选答/标记不会/下一题/结束/复习）和**加权抽样算法**。
- `ui.js` —— UI 主入口（barrel）：测试 / 结果 / 复习 / 历史 / 首页统计 / 恢复横幅 / 设置 input。同时 re-export 三个子模块的公开接口供 `import * as UI from './ui.js'` 使用。
- `ui-common.js` —— UI 共用工具：`escapeHtml` / `renderAudioButton` / `preloadWordWindow` / `showPanel` / `toast` / `wrongCountOf` / `AUDIO_ICON` / 错词本 gamepad 模板。子模块都从这里取，避免反向依赖 ui.js 形成循环。
- `ui-badges.js` —— 徽章馆 + 称号 + 首页成就面板：`TITLE_LEVELS` / `BADGE_DEFINITIONS` / 评估、`renderBadgePage` / `openBadgeModal` / `closeBadgeModal` / `renderAchievements` / `positionAchievePanel`。
- `ui-notebook.js` —— 错词本：日历、Tab（日历/趋势）、错词回顾分栏、移动手柄按钮、柱状图。模块顶层挂 `window.calPrevMonth` / `calNextMonth` / `calSelectDate` / `showWordDetail` / `selectReviewSession` / `notebook*` / `switchNbTab`。
- `ui-word-map.js` —— 概率地图 + KDE 分布图：`renderWordMap` 是公开 API，模块顶层用 `DOMContentLoaded` 注册 mousemove/click/range input 监听器，并挂 `window.testMapRange`。
- `storage.js` —— localStorage 5 个 key 的读写 + 全量数据导入/导出 + 形状校验（`sanitizeHistoryEntry`、`sanitizeWordStats`）。
- `audio.js` + `audio-cache.js` —— 音频播放和三层缓存。
- `sw.js` —— Service Worker，拦截 `.m4a` 请求并支持 HTTP Range，缓存名带 manifest 版本号。
- `constants.js` —— `PANEL`（DOM ID）、`STORAGE_KEY`（localStorage 键）、默认值。

**ESM 依赖图（无循环）**：`ui.js → ui-common.js / ui-badges.js / ui-notebook.js / ui-word-map.js`；子模块 `→ ui-common.js`；`ui-word-map.js → ui-badges.js`（用 positionAchievePanel）；`ui.js / ui-word-map.js → session.js`（用 getWordProbabilities，与 `session.js → ui.js` 形成 live-binding 循环，但所有调用都在加载完成后触发，安全）。

### 加权抽样（学过越错越易出现）

`session.js::buildWeightedOrder` 为每个词计算权重 `2.5 + (wrong / tested) * 1.5`（全对 2.5、全错 4.0），新词权重 5.0；用 `Math.pow(Math.random(), 1.0 / weight)` 作为 key 排序，得到一次**无放回**的全词序列。`recordWordResult(idx, isCorrect)` 在每次作答时更新 `vocab_word_stats` localStorage key。`getWordProbabilities()` 暴露归一化概率给词汇地图可视化。

### 数据形状约定

词条永远是 `{w, uk, us, d}`（拼写 / 英音 / 美音 / 释义）。`words.json`（源，被 `.gitignore` 排除）→ `data/words_data.js`（`var WORDS_DATA = [...]` 全局变量，由 `<script>` 同步加载）→ 在 `state.js::initWords` 中读到 `allWords`。

音频清单 `data/audio_manifest.js` 暴露三个全局：
- `AUDIO_MANIFEST_BY_WORD_INDEX`：`{ "1": "word_audio/0001_perform.m4a", … }`（注意 key 是**1-based 字符串**）
- `AUDIO_MANIFEST`：按拼写映射（后备）
- `AUDIO_MANIFEST_META`：版本元数据，参与 Cache 名构造与 Service Worker 注册查询参数

`audio.js::getAudioPath(word, zeroBasedIndex)` 优先按索引（+1）查 `BY_WORD_INDEX`，缺失则退到拼写匹配。

### 三层音频缓存

`audio-cache.js` 实现：
1. **内存 LRU**：`memoryCache: Map<path, {url: blobURL, size, lastAccess}>`，上限 50 条 / 10MB；`putMemory` 创建 Object URL，`removeMemory` 必须 `revokeObjectURL` 防泄漏。
2. **持久化 Cache API**：缓存名 `vcbly-audio-v1-<manifestVersion>`，依设备分级（桌面 60MB / 移动 30MB / saveData 20MB）。LRU 淘汰时优先丢弃 `prefetchedOnly: true`（即从未真正播放过的预取项）。
3. **Service Worker** (`sw.js`)：拦截同源 `.m4a` 请求，自行处理 Range 请求（音频元素的 seek 会发 Range）。

`cacheAudioAfterPlay()` 在播放后延迟 350ms 把记录从 `prefetchedOnly` 升级为 hot 项，避免被淘汰。`clearAudioCache()` 必须递增 `cacheEpoch` 让 inflight 任务自废。

### 状态持久化与断点续测

5 个 localStorage key（`constants.js::STORAGE_KEY`）：
- `vocab_history` —— 历史测试列表，超 60 条自动裁剪（`MAX_HISTORY_ITEMS`）
- `vocab_settings` —— 仅 `{ maxUnknown }`
- `vocab_theme` —— `'dark' | 'light' | 'auto'`
- `vocab_session` —— 未完成测试的精简快照；首页 `renderResumeButton` 据此显示"继续测试"
- `vocab_word_stats` —— `{ [idx]: { tested, wrong } }`，加权抽样的依据

`saveSession` 只持久化必要字段（不保存 options/correctIdx，因为 `resumeSession` 会重新生成）。但 `awaitingNext: true` 时要保留"已答错待点下一个"的状态——此时**不**重新出题，而是直接显示释义。

### 面板路由

`window.showPanel(name)` 切换 `.panel.active` 类，并按需触发渲染（首页要重渲三块：总览统计、恢复横幅、词汇地图）。徽章馆是**模态**而非面板，由 `openBadgeModal/closeBadgeModal` 控制。`#panel=xxx` query 参数和 `location.hash` 都可深链到面板（见 `showHashPanel`）。

### 键盘快捷键

`main.js` 的全局 keydown 按面板分派：测试面板用 `1-4` 选答 / `Space|Enter` 下一题；复习面板用 ←→ / `a` `d` 翻页；错词本用 jk/上下选词、ad/左右切换会话、p 播放、Enter/Space 选中词。`isEditableTarget` 防止在 input 中误触。

## 修改时的关键约束

- 改 `session` 形状 → 同步 4 处：`createEmptySession`、`saveSession` 的 slim、`restoreSession`、`importAll`/`exportAll`。
- 新增 localStorage key → 加进 `STORAGE_KEY`，并在 `clearAll` 与 `exportAll`/`importAll` 中处理。
- 改音频文件命名 `0123_guide.m4a` 形式或 manifest 字段名会同时影响 `data/audio_manifest.js`、`audio.js::getAudioPath`、`scripts/audio/write_review_audio_manifest.py`，以及 `audio-cache.js` 中基于 `AUDIO_MANIFEST_META` 计算的缓存版本——版本不变则旧 Cache 不会失效。
- 用户面 UI 文案保持中文。代码标识符保持 camelCase。JS/CSS/HTML 缩进为 2 空格。
- 不引入框架、构建器或 npm 依赖（项目刻意保持零工具链）。

## .gitignore 重点

`.claude/`、`AGENTS.md`、`.agents/`、`.codex/` 都被忽略；`words.json`、`word_audio/`、`audio_review_dataset/*/screenshot.png` 与 `*/word_crop.png` 也被忽略，但 `audio_review_dataset/**/audio.m4a` 与元数据 JSON 通过 `!` 例外纳入。`.nojekyll` 文件是 GitHub Pages 直发根目录所必需。
