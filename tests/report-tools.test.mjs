import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkReport } from "../scripts/check-report.mjs";
import { createReport } from "../scripts/create-report.mjs";
import { renderReport } from "../scripts/render-report.mjs";

test("generated fixture passes report checks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deep-research-report-"));
  try {
    await createReport(root);
    const result = await checkReport(path.join(root, "report.html"));
    assert.equal(result.ok, true, result.errors.join(" | "));
    assert.ok(result.metrics.citations > 0);
    assert.ok(result.metrics.sources > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing citation target fails closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deep-research-report-"));
  try {
    const { report_html: reportHtml } = await createReport(root);
    const html = await readFile(reportHtml, "utf8");
    await writeFile(reportHtml, html.replace('href="#source-1"', 'href="#source-does-not-exist"'));
    const result = await checkReport(reportHtml);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((message) => message.includes("#source-does-not-exist")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("create-report refuses accidental overwrite", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deep-research-report-"));
  try {
    await createReport(root);
    await assert.rejects(() => createReport(root), /use --overwrite only intentionally/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("render-report refuses accidental PDF overwrite", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deep-research-report-"));
  try {
    const { report_html: reportHtml } = await createReport(root);
    const output = path.join(root, "report.pdf");
    await writeFile(output, "existing-pdf-placeholder");
    await assert.rejects(() => renderReport(reportHtml, output), /use --overwrite only intentionally/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
