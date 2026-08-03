import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testFilePattern = /(?:^|\.)(?:browser\.)?(?:test|spec)(?:-d)?\.[^.]+$/u;

/**
 * Every one of these carries its failure type as the second type argument. `unknown`
 * there forces the caller to re-derive the error's identity by structural inspection,
 * which is a string comparison the compiler cannot check.
 */
const errorAtSecondArgument = new Set([
  "Effect",
  "Layer",
  "Stream",
  "Deferred",
  "Queue",
  "Dequeue",
  "Fiber",
  "Exit",
  "Cause",
]);

const referenceName = (node) => {
  const name = node.typeName;
  if (ts.isIdentifier(name)) return name.text;
  return ts.isQualifiedName(name) ? name.right.text : null;
};

const mentionsUnknown = (node) => {
  if (node.kind === ts.SyntaxKind.UnknownKeyword) return true;
  if (ts.isUnionTypeNode(node)) return node.types.some(mentionsUnknown);
  return false;
};

export const unknownErrorChannels = (source, filename) => {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found = [];
  const visit = (node) => {
    if (ts.isTypeReferenceNode(node) && node.typeArguments !== undefined) {
      const name = referenceName(node);
      const failure = node.typeArguments[1];
      if (
        name !== null &&
        errorAtSecondArgument.has(name) &&
        failure !== undefined &&
        mentionsUnknown(failure)
      ) {
        found.push({
          reference: name,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

const sourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      if (!entry.isFile() || extname(entry.name) !== ".ts") return [];
      if (testFilePattern.test(entry.name)) return [];
      return [path];
    }),
  );
  return files.flat();
};

export const findUnknownErrorChannels = async (root = repositoryRoot) => {
  const roots = [
    resolve(root, "packages/acp-client/src"),
    resolve(root, "packages/application/src"),
    resolve(root, "packages/contracts/src"),
    resolve(root, "packages/domain/src"),
    resolve(root, "packages/git/src"),
    resolve(root, "packages/persistence/src"),
    resolve(root, "apps/server/server"),
  ];
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const found of unknownErrorChannels(source, file)) {
      violations.push({ file: relative(root, file), ...found });
    }
  }
  return violations.toSorted((left, right) =>
    `${left.file}:${String(left.line).padStart(6, "0")}`.localeCompare(
      `${right.file}:${String(right.line).padStart(6, "0")}`,
    ),
  );
};

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const violations = await findUnknownErrorChannels();
  for (const violation of violations) {
    console.error(
      `${violation.file}:${String(violation.line)}: ${violation.reference} declares unknown in its error channel`,
    );
  }
  if (violations.length > 0) process.exitCode = 1;
}
