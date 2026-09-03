#!/usr/bin/env node

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") options.input = argv[++index];
    else if (value === "--json") options.json = argv[++index];
    else if (value === "--help" || value === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

async function assertFile(target, label) {
  if (!target) throw new Error(`${label} is required`);
  const resolved = path.resolve(target);
  const info = await stat(resolved);
  if (!info.isFile() || info.size === 0) throw new Error(`${label} must be a non-empty file: ${resolved}`);
  return resolved;
}

async function chromiumEnvironment() {
  const candidates = [
    process.env.DEEP_RESEARCH_CHROMIUM_LIBS,
    path.resolve(skillDir, "..", "..", ".tooling", "chromium-root"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    try {
      if ((await stat(root)).isDirectory()) {
        const localLibraries = [
          path.join(root, "lib", "x86_64-linux-gnu"),
          path.join(root, "usr", "lib", "x86_64-linux-gnu"),
        ].join(path.delimiter);
        return {
          ...process.env,
          LD_LIBRARY_PATH: [localLibraries, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter),
          FONTCONFIG_FILE: path.join(root, "etc", "fonts", "fonts.conf"),
          FONTCONFIG_PATH: path.join(root, "etc", "fonts"),
          FONTCONFIG_SYSROOT: root,
        };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return process.env;
}

export async function launchChromium() {
  return chromium.launch({ headless: true, env: await chromiumEnvironment() });
}

export async function checkReport(input) {
  const inputPath = await assertFile(input, "--input");
  const browser = await launchChromium();
  const errors = [];
  const warnings = [];
  const consoleErrors = [];
  const failedRequests = [];

  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("requestfailed", (request) => {
      failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "failed"}`);
    });

    await page.goto(pathToFileURL(inputPath).href, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);

    const inspection = await page.evaluate(() => {
      const internalLinks = [...document.querySelectorAll('a[href^="#"]')];
      const missingAnchors = internalLinks
        .map((link) => link.getAttribute("href"))
        .filter((href) => href && href !== "#" && !document.getElementById(href.slice(1)));
      const remoteResources = [...document.querySelectorAll("img[src], script[src], link[rel='stylesheet'][href], source[src]")]
        .map((node) => node.getAttribute("src") || node.getAttribute("href"))
        .filter(Boolean)
        .map((value) => new URL(value, document.baseURI))
        .filter((url) => url.protocol === "http:" || url.protocol === "https:")
        .map((url) => url.href);
      const emptyHeadings = [...document.querySelectorAll("h1, h2, h3, h4")]
        .filter((heading) => !heading.textContent.trim())
        .map((heading) => heading.outerHTML.slice(0, 120));
      const bodyRect = document.body.getBoundingClientRect();
      const overflowElements = [...document.querySelectorAll("table, pre, svg, .metric-grid, .comparison-grid, .talking-points")]
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.right > bodyRect.right + 2 || rect.left < bodyRect.left - 2 || node.scrollWidth > node.clientWidth + 2;
        })
        .map((node) => `${node.tagName.toLowerCase()}.${node.className || ""}`.slice(0, 100));
      const sourceEntries = [...document.querySelectorAll(".source-entry")];
      const sourceEntriesWithoutUrl = sourceEntries
        .filter((entry) => !entry.querySelector('a[href^="http://"], a[href^="https://"]'))
        .map((entry) => entry.id || entry.textContent.trim().slice(0, 80));
      const cssText = [...document.styleSheets]
        .flatMap((sheet) => {
          try { return [...sheet.cssRules].map((rule) => rule.cssText); }
          catch { return []; }
        })
        .join("\n");
      return {
        title: document.title.trim(),
        lang: document.documentElement.lang,
        hasCover: Boolean(document.querySelector(".cover")),
        hasToc: Boolean(document.querySelector(".toc")),
        hasSources: sourceEntries.length > 0,
        citationCount: document.querySelectorAll(".citation").length,
        sourceCount: sourceEntries.length,
        missingAnchors: [...new Set(missingAnchors)],
        remoteResources: [...new Set(remoteResources)],
        emptyHeadings,
        overflowElements,
        sourceEntriesWithoutUrl,
        hasPrintCss: cssText.includes("@media print") || cssText.includes("@page"),
        linkedStylesheets: [...document.querySelectorAll('link[rel="stylesheet"][href]')].map((link) => link.href),
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
      };
    });

    if (!inspection.hasPrintCss) {
      for (const stylesheet of inspection.linkedStylesheets) {
        if (!stylesheet.startsWith("file:")) continue;
        const css = await readFile(fileURLToPath(stylesheet), "utf8");
        if (css.includes("@media print") || css.includes("@page")) {
          inspection.hasPrintCss = true;
          break;
        }
      }
    }

    if (!inspection.title) errors.push("Document title is empty.");
    if (!inspection.lang) warnings.push("The html element has no lang attribute.");
    if (!inspection.hasPrintCss) errors.push("No @page or @media print CSS was detected.");
    if (inspection.missingAnchors.length) errors.push(`Missing internal anchors: ${inspection.missingAnchors.join(", ")}`);
    if (inspection.remoteResources.length) errors.push(`Remote render resources are not deterministic: ${inspection.remoteResources.join(", ")}`);
    if (inspection.emptyHeadings.length) errors.push(`Empty headings: ${inspection.emptyHeadings.join(" | ")}`);
    if (inspection.sourceEntriesWithoutUrl.length) errors.push(`Source entries without an original URL: ${inspection.sourceEntriesWithoutUrl.join(", ")}`);
    if (!inspection.hasCover) warnings.push("No .cover element found.");
    if (!inspection.hasToc) warnings.push("No .toc element found.");
    if (!inspection.hasSources) warnings.push("No .source-entry elements found.");
    if (inspection.citationCount === 0) warnings.push("No inline .citation links found.");
    if (inspection.overflowElements.length) warnings.push(`Possible horizontal overflow: ${inspection.overflowElements.join(", ")}`);
    if (inspection.bodyScrollWidth > inspection.bodyClientWidth + 2) warnings.push("Document body has horizontal overflow.");
    if (consoleErrors.length) errors.push(`Browser console errors: ${consoleErrors.join(" | ")}`);
    if (failedRequests.length) errors.push(`Failed resource requests: ${failedRequests.join(" | ")}`);

    return {
      ok: errors.length === 0,
      input: inputPath,
      errors,
      warnings,
      metrics: {
        citations: inspection.citationCount,
        sources: inspection.sourceCount,
      },
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: check-report.mjs --input <report.html> [--json <result.json>]\n");
    return;
  }
  const result = await checkReport(options.input);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.json) await writeFile(path.resolve(options.json), serialized, "utf8");
  process.stdout.write(serialized);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
