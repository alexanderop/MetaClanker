import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["apps", "packages", "tests"];
const ignoredDirectories = new Set([
  ".nitro",
  ".output",
  ".packaging",
  ".stryker-tmp",
  "artifacts",
  "dist",
  "node_modules",
]);
const testFile = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u;
const disabledTest = /\b(?:describe|it|test)\s*\.\s*(?:only|skip|todo)\s*\(/gu;

const files = [];
const visit = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (testFile.test(entry.name) && extname(entry.name) !== ".map") files.push(path);
  }
};

await Promise.all(roots.map(visit));
const violations = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(disabledTest)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${file}:${String(line)} ${match[0]}`);
  }
}

if (violations.length > 0) {
  console.error("Focused, skipped, and todo tests are forbidden:\n" + violations.join("\n"));
  process.exitCode = 1;
}
