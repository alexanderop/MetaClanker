import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx", ".vue"]);
const testFilePattern = /(?:^|\.)(?:browser\.)?(?:test|spec)(?:-d)?\.[^.]+$/u;

const normalize = (path) => resolve(path).split(sep).join("/");

const pathWithin = (path, directory) => {
  const child = normalize(path);
  const parent = normalize(directory);
  return child === parent || child.startsWith(`${parent}/`);
};

const webArea = (path, root) => {
  const sourceRoot = resolve(root, "apps/web/src");
  if (!pathWithin(path, sourceRoot)) return null;
  return relative(sourceRoot, resolve(path)).split(sep)[0] ?? null;
};

const featureName = (path, root) => {
  const featuresRoot = resolve(root, "apps/web/src/features");
  if (!pathWithin(path, featuresRoot)) return null;
  return relative(featuresRoot, resolve(path)).split(sep)[0] ?? null;
};

const packageName = (path, root) => {
  const packagesRoot = resolve(root, "packages");
  if (!pathWithin(path, packagesRoot)) return null;
  return relative(packagesRoot, resolve(path)).split(sep)[0] ?? null;
};

const resolveImportTarget = (importer, specifier, root) => {
  if (specifier.startsWith("@/")) {
    return resolve(root, "apps/web/src", specifier.slice(2));
  }
  if (specifier.startsWith("@metaclanker/")) {
    const [packagePart, ...rest] = specifier.slice("@metaclanker/".length).split("/");
    if (packagePart === "server") return resolve(root, "apps/server/src", ...rest);
    return resolve(root, "packages", packagePart, "src", ...rest);
  }
  if (specifier.startsWith(".")) return resolve(dirname(importer), specifier);
  return null;
};

export const architectureViolationForImport = (importer, specifier, root = repositoryRoot) => {
  const target = resolveImportTarget(importer, specifier, root);
  if (target === null) return null;

  const sourceArea = webArea(importer, root);
  const targetArea = webArea(target, root);
  if (sourceArea === "shared" && (targetArea === "features" || targetArea === "views")) {
    return "web shared code cannot import features or views";
  }
  if (
    sourceArea === "ui" &&
    (targetArea === "shared" || targetArea === "features" || targetArea === "views")
  ) {
    return "web UI primitives cannot import shared code, features, or views";
  }
  if (sourceArea === "features") {
    const sourceFeature = featureName(importer, root);
    const targetFeature = featureName(target, root);
    if (targetArea === "views" || (targetFeature !== null && targetFeature !== sourceFeature)) {
      return "web features cannot import views or other features";
    }
  }

  const sourcePackage = packageName(importer, root);
  const targetPackage = packageName(target, root);
  if (
    (sourcePackage === "contracts" ||
      sourcePackage === "domain" ||
      sourcePackage === "application") &&
    (targetPackage === "acp-client" ||
      targetPackage === "git" ||
      targetPackage === "persistence" ||
      pathWithin(target, resolve(root, "apps/server")))
  ) {
    return "core packages cannot import infrastructure implementations";
  }
  return null;
};

const scriptSources = (source, filename) => {
  if (extname(filename) !== ".vue") return [source];
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)].map(
    (match) => match[1] ?? "",
  );
};

export const importedSpecifiers = (source, filename) => {
  const specifiers = [];
  for (const script of scriptSources(source, filename)) {
    const sourceFile = ts.createSourceFile(
      filename,
      script,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        specifiers.push(node.moduleSpecifier.text);
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        specifiers.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return specifiers;
};

const sourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      if (!entry.isFile() || !sourceExtensions.has(extname(entry.name))) return [];
      if (testFilePattern.test(entry.name)) return [];
      return [path];
    }),
  );
  return files.flat();
};

export const findArchitectureViolations = async (root = repositoryRoot) => {
  const roots = [
    resolve(root, "apps/web/src"),
    resolve(root, "packages/contracts/src"),
    resolve(root, "packages/domain/src"),
    resolve(root, "packages/application/src"),
  ];
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const specifier of importedSpecifiers(source, file)) {
      const reason = architectureViolationForImport(file, specifier, root);
      if (reason !== null) {
        violations.push({ file: relative(root, file), specifier, reason });
      }
    }
  }
  return violations.toSorted((left, right) =>
    `${left.file}:${left.specifier}`.localeCompare(`${right.file}:${right.specifier}`),
  );
};

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const violations = await findArchitectureViolations();
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.file}: ${violation.reason}: ${violation.specifier}`);
    }
    process.exitCode = 1;
  }
}
