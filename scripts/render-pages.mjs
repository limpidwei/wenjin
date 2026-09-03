#!/usr/bin/env node

import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);

function parseArgs(argv) {
  const options = { overwrite: false, scale: 2 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") options.input = argv[++index];
    else if (value === "--output-dir") options.outputDir = argv[++index];
    else if (value === "--scale") options.scale = Number(argv[++index]);
    else if (value === "--overwrite") options.overwrite = true;
    else if (value === "--help" || value === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!Number.isFinite(options.scale) || options.scale < 0.5 || options.scale > 4) {
    throw new Error("--scale must be between 0.5 and 4");
  }
  return options;
}

async function assertPdf(target) {
  if (!target) throw new Error("--input is required");
  const resolved = path.resolve(target);
  const info = await stat(resolved);
  if (!info.isFile() || info.size === 0) throw new Error(`Input must be a non-empty PDF: ${resolved}`);
  return resolved;
}

async function loadPdfRenderer() {
  const candidates = [
    process.env.DEEP_RESEARCH_CHROMIUM_LIBS,
    path.resolve(skillDir, "..", "..", ".tooling", "chromium-root"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    try {
      if (!(await stat(root)).isDirectory()) continue;
      const configPath = path.join(os.tmpdir(), "deep-research-pdf-fontconfig.xml");
      const fontDir = path.join(root, "usr", "share", "fonts");
      const cacheDir = path.join(os.tmpdir(), "deep-research-pdf-font-cache");
      await mkdir(cacheDir, { recursive: true });
      await writeFile(
        configPath,
        `<?xml version="1.0"?><fontconfig><dir>${fontDir}</dir><cachedir>${cacheDir}</cachedir><config></config></fontconfig>`,
        "utf8",
      );
      process.env.FONTCONFIG_FILE = configPath;
      delete process.env.FONTCONFIG_PATH;
      delete process.env.FONTCONFIG_SYSROOT;
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return import("pdf-to-img");
}

function isGeneratedImage(name) {
  return /^page-\d{3}\.png$/.test(name) || name === "contact-sheet.png";
}

async function prepareOutput(outputDir, overwrite) {
  if (!outputDir) throw new Error("--output-dir is required");
  const resolved = path.resolve(outputDir);
  if (resolved === path.parse(resolved).root) throw new Error("Refusing to use a filesystem root as --output-dir");
  await mkdir(resolved, { recursive: true });
  const generated = (await readdir(resolved)).filter(isGeneratedImage);
  if (generated.length && !overwrite) {
    throw new Error(`Generated page images already exist in ${resolved}; use a new directory or --overwrite.`);
  }
  if (overwrite) {
    for (const name of generated) await unlink(path.join(resolved, name));
  }
  return resolved;
}

async function makeTile(imageBuffer, pageNumber, width, height, labelHeight) {
  const label = Buffer.from(
    `<svg width="${width}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="100%" height="100%" fill="#1a1a2e"/>` +
    `<text x="${width / 2}" y="${labelHeight * 0.67}" text-anchor="middle" ` +
    `font-family="sans-serif" font-size="14" font-weight="700" fill="#ffffff">PAGE ${String(pageNumber).padStart(2, "0")}</text>` +
    `</svg>`,
  );
  return sharp(imageBuffer)
    .resize({ width, height, fit: "contain", background: "#ffffff" })
    .extend({ bottom: labelHeight, background: "#1a1a2e" })
    .composite([{ input: label, top: height, left: 0 }])
    .png()
    .toBuffer();
}

async function makeContactSheet(buffers, outputPath) {
  const columns = Math.min(4, Math.max(1, buffers.length));
  const tileWidth = 240;
  const tileHeight = 340;
  const labelHeight = 28;
  const gap = 18;
  const margin = 22;
  const rows = Math.ceil(buffers.length / columns);
  const width = margin * 2 + columns * tileWidth + (columns - 1) * gap;
  const height = margin * 2 + rows * (tileHeight + labelHeight) + (rows - 1) * gap;
  const composites = [];

  for (let index = 0; index < buffers.length; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    composites.push({
      input: await makeTile(buffers[index], index + 1, tileWidth, tileHeight, labelHeight),
      left: margin + column * (tileWidth + gap),
      top: margin + row * (tileHeight + labelHeight + gap),
    });
  }

  await sharp({ create: { width, height, channels: 4, background: "#dfe2e7" } })
    .composite(composites)
    .png()
    .toFile(outputPath);
}

export async function renderPages(input, outputDir, { overwrite = false, scale = 2 } = {}) {
  const inputPath = await assertPdf(input);
  const destination = await prepareOutput(outputDir, overwrite);
  const { pdf } = await loadPdfRenderer();
  const document = await pdf(inputPath, { scale });
  const buffers = [];
  let pageNumber = 0;
  try {
    for await (const image of document) {
      pageNumber += 1;
      const buffer = Buffer.from(image);
      buffers.push(buffer);
      await writeFile(path.join(destination, `page-${String(pageNumber).padStart(3, "0")}.png`), buffer);
    }
  } finally {
    if (typeof document.destroy === "function") await document.destroy();
  }
  if (buffers.length === 0) throw new Error("PDF rasterizer returned no pages");
  const contactSheet = path.join(destination, "contact-sheet.png");
  await makeContactSheet(buffers, contactSheet);
  return {
    ok: true,
    input: inputPath,
    output_dir: destination,
    pages: buffers.length,
    contact_sheet: contactSheet,
    visual_review: "required",
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: render-pages.mjs --input <report.pdf> --output-dir <dir> [--scale 2] [--overwrite]\n");
    return;
  }
  const result = await renderPages(options.input, options.outputDir, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
