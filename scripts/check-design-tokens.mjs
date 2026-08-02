import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * The token ratchet's counterpart. `check-stylesheet-ratchet.mjs` stops the global
 * stylesheet from growing back; this stops the values it used to hold from being
 * re-scattered across components as arbitrary utilities.
 *
 * A design system is only as good as the surfaces that consume it: one
 * `text-[0.63rem]` next to a `text-xs` is how a scale stops describing the product,
 * and nothing about it is visible in review. So a size, weight, radius, shadow, or
 * colour written as a literal is an error, and the fix is to use the scale step —
 * or, when the surface genuinely needs a value the scale lacks, to add the step in
 * `apps/web/src/shared/styles.css` where the next surface can find it too.
 *
 * Expressions are not literals: `w-[min(31rem,calc(100vw-2rem))]`, a grid track
 * list, and an `em` size relative to inherited type are layout and are allowed.
 */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const componentRoot = resolve(repositoryRoot, "apps/web/src");
const stylesheet = resolve(componentRoot, "shared/styles.css");

const scaled = [
  "p",
  "px",
  "py",
  "pt",
  "pb",
  "pl",
  "pr",
  "m",
  "mx",
  "my",
  "mt",
  "mb",
  "ml",
  "mr",
  "gap",
  "gap-x",
  "gap-y",
  "size",
  "w",
  "h",
  "min-w",
  "min-h",
  "max-w",
  "max-h",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "text",
  "leading",
  "tracking",
  "rounded",
  "shadow",
  "blur",
  "backdrop-blur",
  "outline-offset",
  "z",
];

const arbitraryUtility = new RegExp(String.raw`\b(${scaled.join("|")})-\[([^\]]*)\]`, "gu");
const literalValue = /^-?[0-9.]+(?:rem|px)?$/u;
const arbitraryWeight = /\bfont-\[[^\]]*\]/gu;
const hexColour = /#[0-9a-fA-F]{3,8}\b/u;
const colourFunction = /\b(?:rgba?|hsla?|oklch|oklab|color-mix)\(/u;
const paletteReference = /--ink-[a-z-]+/u;

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.(?:vue|ts)$/u.test(entry.name)) files.push(path);
  }
  return files;
};

const failures = [];
const report = (path, line, message) => {
  failures.push(
    `${relative(repositoryRoot, path).split(sep).join("/")}:${String(line)} ${message}`,
  );
};

for (const file of await walk(componentRoot)) {
  const lines = (await readFile(file, "utf8")).split("\n");

  lines.forEach((text, index) => {
    const line = index + 1;

    for (const [match, property, value] of text.matchAll(arbitraryUtility)) {
      if (!literalValue.test(value)) continue;
      report(file, line, `\`${match}\` is a literal; use a \`${property}-\` scale step.`);
    }

    for (const [match] of text.matchAll(arbitraryWeight)) {
      report(file, line, `\`${match}\` is a literal weight; use font-medium/semibold/bold.`);
    }

    if (hexColour.test(text) || colourFunction.test(text)) {
      report(file, line, "declares a colour value; use a token-backed colour utility.");
    }

    if (paletteReference.test(text)) {
      report(file, line, "names a palette ink; components consume semantic tokens only.");
    }
  });
}

/*
 * Inside the stylesheet the same rule applies one level up: raw ink belongs to the
 * palette block at the top of the file and nowhere else, so a re-skin is one edit.
 */
const stylesheetLines = (await readFile(stylesheet, "utf8")).split("\n");
const paletteEnd = stylesheetLines.findIndex(
  (text, index) => index > stylesheetLines.indexOf(":root {") && text === "}",
);

stylesheetLines.forEach((text, index) => {
  if (index <= paletteEnd) return;
  if (!hexColour.test(text)) return;
  report(stylesheet, index + 1, "declares a hex colour outside the palette block.");
});

if (failures.length > 0) {
  console.error(
    `Design tokens are bypassed in ${String(failures.length)} place(s):\n${failures.join("\n")}\n\n` +
      "Add the step to apps/web/src/shared/styles.css if the scale is genuinely missing one.",
  );
  process.exit(1);
}
