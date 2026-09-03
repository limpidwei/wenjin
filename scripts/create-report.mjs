#!/usr/bin/env node

import { copyFile, cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);

function parseArgs(argv) {
  const options = { overwrite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output-dir") options.outputDir = argv[++index];
    else if (value === "--overwrite") options.overwrite = true;
    else if (value === "--help" || value === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
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

async function copyFontPackage(packageName, outputCss, outputLicense, outputFontsDir) {
  const packageDir = path.join(skillDir, "node_modules", "@fontsource-variable", packageName);
  const packageCss = path.join(packageDir, "index.css");
  const packageFiles = path.join(packageDir, "files");
  const packageLicense = path.join(packageDir, "LICENSE");
  if (!(await exists(packageCss)) || !(await exists(packageFiles)) || !(await exists(packageLicense))) {
    throw new Error(
      `Missing ${packageName} font assets. Run npm install in ${skillDir} before creating a report.`,
    );
  }
  await copyFile(packageCss, path.join(outputFontsDir, outputCss));
  await copyFile(packageLicense, path.join(outputFontsDir, outputLicense));
  await cp(packageFiles, path.join(outputFontsDir, "files"), { recursive: true, force: true });
}

export async function createReport(outputDir, { overwrite = false } = {}) {
  if (!outputDir) throw new Error("--output-dir is required");
  const destination = path.resolve(outputDir);
  const reportPath = path.join(destination, "report.html");
  const stylePath = path.join(destination, "report.css");
  const fontsDir = path.join(destination, "fonts");

  if (!overwrite && ((await exists(reportPath)) || (await exists(stylePath)))) {
    throw new Error(`Report assets already exist in ${destination}; use --overwrite only intentionally.`);
  }

  await mkdir(fontsDir, { recursive: true });
  await copyFile(path.join(skillDir, "assets", "report-template.html"), reportPath);
  await copyFile(path.join(skillDir, "assets", "report.css"), stylePath);
  await copyFontPackage("noto-sans-sc", "noto-sans-sc.css", "OFL-Noto-Sans-SC.txt", fontsDir);
  await copyFontPackage("noto-serif-sc", "noto-serif-sc.css", "OFL-Noto-Serif-SC.txt", fontsDir);

  return {
    ok: true,
    output_dir: destination,
    report_html: reportPath,
    report_css: stylePath,
    fonts: ["Noto Sans SC Variable", "Noto Serif SC Variable"],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: create-report.mjs --output-dir <dir> [--overwrite]\n");
    return;
  }
  const result = await createReport(options.outputDir, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
