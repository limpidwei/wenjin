import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkRun } from "../scripts/check-run.mjs";

const template = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "research-notes.md");

function fill(notes) {
  return notes
    .replace(/^(- [^：\n]+：)\s*$/gm, "$1 已填写")
    .replace("预估：搜索约 __ 次 / 约 __ 分钟", "预估：搜索约 20 次 / 约 40 分钟")
    .replace("实际：搜索约 __ 次 / 约 __ 分钟", "实际：搜索约 25 次 / 约 50 分钟")
    .replace("| 1 |  | 待研究 |  |  |  |  |", "| 1 | 市场规模 | 直接回答 | 统计局 | 直接 | 细分口径 | 无 |")
    .replace(/- 决定（可以写作[^：]*：.*$/m, "- 决定（可以写作 / 降低结论后写作 / 返回研究）：可以写作")
    .replace(/- 决定（可以交付[^：]*：.*$/m, "- 决定（可以交付 / 返回修改）：可以交付");
}

const report = `---
title: 测试
date: 2026-10-27
decision: 是否进入
tier: standard
revisit: 2027 年复查
---

## 结论
示例 [1](https://example.com)

## 来源
1. https://example.com
`;

async function withRun(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wenjin-run-"));
  try {
    await copyFile(template, path.join(dir, "notes.md"));
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("blank template fails the write gate", () =>
  withRun(async (dir) => {
    const result = await checkRun(dir, "write");
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("要改善的决定")));
    assert.ok(result.errors.some((e) => e.includes("没有填写任何核心问题")));
  }));

test("filled notes pass write but deliver needs report.md", () =>
  withRun(async (dir) => {
    const notesPath = path.join(dir, "notes.md");
    await writeFile(notesPath, fill(await readFile(notesPath, "utf8")));
    assert.deepEqual(await checkRun(dir, "write"), { ok: true, errors: [] });
    const deliver = await checkRun(dir, "deliver");
    assert.equal(deliver.ok, false);
    assert.ok(deliver.errors.some((e) => e.includes("report.md")));
    await writeFile(path.join(dir, "report.md"), report);
    assert.deepEqual(await checkRun(dir, "deliver"), { ok: true, errors: [] });
  }));

test("open evidence row and 返回研究 decision block writing", () =>
  withRun(async (dir) => {
    const notesPath = path.join(dir, "notes.md");
    let notes = fill(await readFile(notesPath, "utf8"));
    notes = notes.replace("| 1 | 市场规模 | 直接回答", "| 1 | 市场规模 | 待研究").replace("：可以写作", "：返回研究");
    await writeFile(notesPath, notes);
    const result = await checkRun(dir, "write");
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("仍是\"待研究\"")));
    assert.ok(result.errors.some((e) => e.includes("返回研究")));
  }));
