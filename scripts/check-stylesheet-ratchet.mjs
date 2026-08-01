import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/*
 * The global stylesheet only shrinks. Every migration slice deletes the rules whose
 * last consumer it removed and lowers this ceiling to the resulting line count.
 * Without the ratchet the migration predictably stalls partway and the repository
 * carries two styling systems permanently.
 *
 * Raising this number is not a routine edit: a new rule belongs in a `src/ui`
 * primitive unless it is a token, a reset, shell layout, or a third-party override.
 */
const ceiling = 766;

const stylesheet = fileURLToPath(new URL("../apps/web/src/shared/styles.css", import.meta.url));
const contents = await readFile(stylesheet, "utf8");
const lines = contents.split("\n").length - (contents.endsWith("\n") ? 1 : 0);

if (lines > ceiling) {
  console.error(
    `apps/web/src/shared/styles.css is ${String(lines)} lines, over its ${String(ceiling)}-line ceiling.\n` +
      `Style the surface with a src/ui primitive and token-backed utilities instead of adding a rule here.`,
  );
  process.exit(1);
}

if (lines < ceiling) {
  console.error(
    `apps/web/src/shared/styles.css is ${String(lines)} lines, under its ${String(ceiling)}-line ceiling.\n` +
      `Lower \`ceiling\` in scripts/check-stylesheet-ratchet.mjs to ${String(lines)} so the deletion is locked in.`,
  );
  process.exit(1);
}
