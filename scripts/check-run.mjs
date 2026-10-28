#!/usr/bin/env node
// Zero-dependency gate check for a wenjin research run.
// Usage: node check-run.mjs <run-dir> --stage write|deliver

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = /^(|[-—_\s]*|<[^>]*>|todo|tbd|待填|待补|.*__.*)$/i;
const OPEN_STATUS = "待研究";
const VALID_STATUS = ["直接回答", "代理或推论", "当前未知"];

function sections(markdown) {
  const out = {};
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(\d+)\./);
    if (heading) {
      current = heading[1];
      out[current] = [];
    } else if (current) {
      out[current].push(line);
    }
  }
  return out;
}

// "- 标签：值" lines; label is text before the first full-width or ASCII colon.
function fields(lines = []) {
  const out = [];
  for (const line of lines) {
    const match = line.match(/^\s*-\s*([^：:]+)[：:]\s*(.*)$/);
    if (match) out.push({ label: match[1].trim(), value: match[2].trim() });
  }
  return out;
}

function filled(value) {
  return !PLACEHOLDER.test(value.trim());
}

function checkFieldsFilled(errors, lines, sectionName, { optional = [] } = {}) {
  const list = fields(lines);
  if (list.length === 0) errors.push(`${sectionName}：找不到任何字段`);
  for (const { label, value } of list) {
    if (optional.some((key) => label.includes(key))) continue;
    if (!filled(value)) errors.push(`${sectionName}：「${label}」未填写`);
  }
  return list;
}

function decision(list) {
  const item = list.find(({ label }) => label.startsWith("决定"));
  return item ? item.value : "";
}

function evidenceRows(lines = []) {
  const rows = [];
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3 || cells[0] === "#" || /^-+$/.test(cells[0])) continue;
    rows.push({ id: cells[0], question: cells[1], status: cells[2] });
  }
  return rows;
}

export async function checkRun(runDir, stage) {
  const errors = [];
  const notesPath = path.join(runDir, "notes.md");
  let notes;
  try {
    notes = await readFile(notesPath, "utf8");
  } catch {
    return { ok: false, errors: [`找不到 ${notesPath}`] };
  }
  const s = sections(notes);

  // Write gate: brief, evidence map, judgement, pre-write review.
  checkFieldsFilled(errors, s["1"], "§1 Brief");

  const rows = evidenceRows(s["2"]).filter((row) => row.question);
  if (rows.length === 0) errors.push("§2 问题—证据表：没有填写任何核心问题");
  for (const row of rows) {
    if (row.status.includes(OPEN_STATUS)) errors.push(`§2 问题 ${row.id}「${row.question}」仍是"待研究"`);
    else if (!VALID_STATUS.some((v) => row.status.includes(v))) {
      errors.push(`§2 问题 ${row.id} 的状态「${row.status}」不是 ${VALID_STATUS.join(" / ")} 之一`);
    }
  }

  checkFieldsFilled(errors, s["4"], "§4 当前判断与反证");

  const review = checkFieldsFilled(errors, s["5"], "§5 写作前检查");
  const writeDecision = decision(review);
  if (!/^(可以写作|降低结论后写作)$/.test(writeDecision)) {
    errors.push(`§5 决定是「${writeDecision || "空"}」，需要是"可以写作"或"降低结论后写作"`);
  }

  if (stage === "deliver") {
    const delivery = checkFieldsFilled(errors, s["6"], "§6 交付前检查");
    if (decision(delivery) !== "可以交付") {
      errors.push(`§6 决定是「${decision(delivery) || "空"}」，需要是"可以交付"`);
    }
    checkFieldsFilled(errors, s["7"], "§7 运行记录");

    const reportPath = path.join(runDir, "report.md");
    let report = "";
    try {
      if ((await stat(reportPath)).size > 0) report = await readFile(reportPath, "utf8");
    } catch {
      /* handled below */
    }
    if (!report) {
      errors.push(`找不到或为空：${reportPath}`);
    } else {
      const front = report.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!front) errors.push("report.md 缺少 frontmatter");
      else {
        for (const key of ["title", "date", "decision", "revisit"]) {
          const line = front[1].match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
          if (!line || !filled(line[1])) errors.push(`report.md frontmatter 缺少 ${key}`);
        }
      }
      if (!/https?:\/\//.test(report)) errors.push("report.md 没有任何来源链接");
      if (!/^##\s*来源/m.test(report) && !/^##\s*Sources/im.test(report)) errors.push("report.md 缺少「来源」章节");
    }
  }

  return { ok: errors.length === 0, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const runDir = args.find((arg) => !arg.startsWith("--"));
  const stageIndex = args.indexOf("--stage");
  const stage = stageIndex >= 0 ? args[stageIndex + 1] : "write";
  if (!runDir || !["write", "deliver"].includes(stage)) {
    console.error("用法: node check-run.mjs <run-dir> --stage write|deliver");
    process.exit(2);
  }
  const result = await checkRun(path.resolve(runDir), stage);
  if (result.ok) {
    console.log(`[通过] ${stage} 检查`);
  } else {
    console.log(`[未通过] ${stage} 检查，共 ${result.errors.length} 项：`);
    for (const error of result.errors) console.log(`- ${error}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
