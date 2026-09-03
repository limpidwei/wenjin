#!/usr/bin/env node

import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { pdf } from "pdf-to-img";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { checkReport, launchChromium } from "./check-report.mjs";

function parseArgs(argv) {
  const options = { overwrite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") options.input = argv[++index];
    else if (value === "--output") options.output = argv[++index];
    else if (value === "--overwrite") options.overwrite = true;
    else if (value === "--help" || value === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

async function assertInput(target) {
  if (!target) throw new Error("--input is required");
  const resolved = path.resolve(target);
  const info = await stat(resolved);
  if (!info.isFile() || info.size === 0) throw new Error(`Input must be a non-empty HTML file: ${resolved}`);
  return resolved;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function sha256File(target) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest("hex");
}

async function inspectPdfLinks(target) {
  const document = await getDocument({ url: pathToFileURL(target).href }).promise;
  let internal = 0;
  let external = 0;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const annotations = await page.getAnnotations();
      for (const annotation of annotations) {
        if (annotation.subtype !== "Link") continue;
        if (annotation.url) external += 1;
        else if (annotation.dest) internal += 1;
      }
    }
  } finally {
    await document.destroy();
  }
  return { internal, external, total: internal + external };
}

export async function renderReport(input, output, { overwrite = false } = {}) {
  const inputPath = await assertInput(input);
  if (!output) throw new Error("--output is required");
  const outputPath = path.resolve(output);
  if (path.extname(outputPath).toLowerCase() !== ".pdf") throw new Error("--output must end in .pdf");
  if (!overwrite && (await exists(outputPath))) {
    throw new Error(`Output already exists: ${outputPath}; use --overwrite only intentionally.`);
  }

  const check = await checkReport(inputPath);
  if (!check.ok) throw new Error(`Report check failed: ${check.errors.join(" | ")}`);

  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(inputPath).href, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: temporaryPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      outline: true,
      tagged: true,
      scale: 1,
    });
  } finally {
    await browser.close();
  }

  let links;
  try {
    links = await inspectPdfLinks(temporaryPath);
    if (check.metrics.citations > 0 && links.internal === 0) {
      throw new Error("PDF lost all internal citation/navigation links.");
    }
    if (check.metrics.sources > 0 && links.external === 0) {
      throw new Error("PDF lost all external source links.");
    }
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }

  const document = await pdf(outputPath, { scale: 1 });
  const pages = document.length;
  if (typeof document.destroy === "function") await document.destroy();
  const info = await stat(outputPath);
  return {
    ok: true,
    input: inputPath,
    output: outputPath,
    pages,
    bytes: info.size,
    sha256: await sha256File(outputPath),
    links,
    warnings: check.warnings,
    visual_review: "pending",
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: render-report.mjs --input <report.html> --output <report.pdf> [--overwrite]\n");
    return;
  }
  const result = await renderReport(options.input, options.output, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
