// Enforce the "inline composables" pattern in Vue SFCs. See docs/vue-components.md.
//
// oxlint hands JS plugins one Program per `<script>` block of a .vue file, with source
// positions mapped back to the SFC. It does not say which block a Program came from, and
// it visits the plain `<script>` block too — so the rules read the SFC's own script tags
// to find the one they are about.

import { readFileSync } from "node:fs";

const DOCS = "https://github.com/alexanderop/MetaClanker/blob/main/docs/vue-components.md";

// Reactive state. `useTemplateRef` and `storeToRefs` are listed for the naming rule's
// benefit; at the top level a `use*` call is already a named unit and never costs a point.
const REACTIVE_FACTORIES = new Set([
  "ref",
  "shallowRef",
  "customRef",
  "computed",
  "reactive",
  "shallowReactive",
  "toRef",
  "toRefs",
  "storeToRefs",
  "useTemplateRef",
]);

// Effect calls that are not already named `use*` — anything use*-prefixed is a
// named unit by construction and is always free.
const EFFECT_CALLS = new Set([
  "watch",
  "watchEffect",
  "watchPostEffect",
  "watchSyncEffect",
  "onMounted",
  "onUpdated",
  "onUnmounted",
  "onBeforeMount",
  "onBeforeUnmount",
  "onBeforeUpdate",
  "onActivated",
  "onDeactivated",
  "onErrorCaptured",
  "onScopeDispose",
  "onKeyStroke",
  "onClickOutside",
  "onLongPress",
  "onStartTyping",
  "onBeforeRouteLeave",
  "onBeforeRouteUpdate",
  "provide",
]);

const COMPILER_MACROS = new Set([
  "defineProps",
  "defineEmits",
  "defineModel",
  "defineSlots",
  "defineExpose",
  "defineOptions",
  "withDefaults",
]);

// ---------------------------------------------------------------------------
// Locating the <script setup> block
// ---------------------------------------------------------------------------

const SCRIPT_TAG = /<script\b([^>]*)>/giu;
const SETUP_ATTRIBUTE = /(?:^|\s)setup(?=\s|$)/u;

/** Every `<script>` block of an SFC, in source order, with its body text. */
const scriptBlocks = (source) => {
  const blocks = [];
  SCRIPT_TAG.lastIndex = 0;
  for (let tag = SCRIPT_TAG.exec(source); tag !== null; tag = SCRIPT_TAG.exec(source)) {
    const close = source.indexOf("</script>", SCRIPT_TAG.lastIndex);
    if (close === -1) break;
    blocks.push({
      setup: SETUP_ATTRIBUTE.test(tag[1]),
      body: source.slice(SCRIPT_TAG.lastIndex, close),
    });
    SCRIPT_TAG.lastIndex = close;
  }
  return blocks;
};

// A lint run visits a file's blocks back to back, so one slot is enough.
let cachedFilename = null;
let cachedBlocks = null;

const blocksOf = (filename) => {
  if (filename !== cachedFilename) {
    cachedFilename = filename;
    try {
      cachedBlocks = scriptBlocks(readFileSync(filename, "utf8"));
    } catch {
      // Unreadable (a virtual path, a race with an editor). Assume the pattern applies.
      cachedBlocks = null;
    }
  }
  return cachedBlocks;
};

/**
 * Is this Program the SFC's `<script setup>` block?
 *
 * `context.sourceCode.text` is the block's body, so it identifies the block by content —
 * oxlint exposes no marker, and Program offsets are block-relative. The match is
 * containment rather than equality because oxlint drops the newline that follows the
 * opening tag.
 */
const isScriptSetup = (context) => {
  if (!context.filename.endsWith(".vue")) return false;
  const blocks = blocksOf(context.filename);
  if (blocks === null) return true;
  const text = context.sourceCode.text;
  return blocks.find((block) => block.body.includes(text))?.setup ?? false;
};

// ---------------------------------------------------------------------------
// Reading the AST
// ---------------------------------------------------------------------------

const isComposableName = (name) => name !== null && /^use[A-Z]/u.test(name);

const isFunctionish = (node) =>
  node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";

/** Strip the wrappers a call can hide behind: `await x()`, `x() as T`, `x()!`. */
const unwrap = (node) => {
  if (node === null || node === undefined) return null;
  switch (node.type) {
    case "AwaitExpression":
      return unwrap(node.argument);
    case "TSNonNullExpression":
    case "TSAsExpression":
      return unwrap(node.expression);
    default:
      return node;
  }
};

/** Name a call is written under, whether `ref()` or `vue.ref()`. */
const calleeName = (node) => {
  const call = unwrap(node);
  if (call?.type !== "CallExpression") return null;
  const { callee } = call;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
    return callee.property.name;
  }
  return null;
};

/** The callee's identifier, when the call is a bare `name()` that a scope can resolve. */
const calleeIdentifier = (node) => {
  const call = unwrap(node);
  if (call?.type !== "CallExpression" || call.callee.type !== "Identifier") return null;
  return call.callee;
};

/** Name a variable was imported under, or null if it is not an import binding. */
const importedName = (variable) => {
  for (const definition of variable.defs) {
    if (definition.type !== "ImportBinding") continue;
    const specifier = definition.node;
    if (specifier.type !== "ImportSpecifier") return null;
    return specifier.imported.type === "Identifier" ? specifier.imported.name : null;
  }
  return null;
};

/** Every identifier reference in the file, mapped to the binding it resolves to. */
const resolveReferences = (scopeManager) => {
  const bindings = new Map();
  for (const scope of scopeManager.scopes) {
    for (const reference of scope.references)
      bindings.set(reference.identifier, reference.resolved);
  }
  return bindings;
};

/**
 * Name under which a call reaches Vue's reactivity, or null if it does not.
 *
 * Resolved through the scope manager, so `import { ref as state }` still reads as `ref`
 * and a local `const computed = (v) => v * 2` does not read as one. A callee that
 * resolves to no binding is a global or an auto-import, where its own name is the only
 * signal available; a member call (`vue.ref()`) has no binding to resolve at all.
 */
const factoryName = (node, bindings) => {
  const identifier = calleeIdentifier(node);
  if (identifier === null) return calleeName(node);
  const variable = bindings.get(identifier);
  if (variable === null || variable === undefined) return identifier.name;
  return importedName(variable);
};

const isReactiveFactory = (node, bindings) => {
  const name = factoryName(node, bindings);
  return name !== null && REACTIVE_FACTORIES.has(name);
};

const isEffectCall = (node, bindings) => {
  const name = factoryName(node, bindings);
  return name !== null && EFFECT_CALLS.has(name);
};

// Free variables of a function: references that escape its own scope, already
// propagated up from nested scopes. Scope-accurate, so a parameter that shadows
// a top-level ref does not count as touching it.
const freeVariables = (scopeManager, fnNode) => {
  const scope = scopeManager.acquire(fnNode);
  if (scope === null || scope === undefined) return [];
  return (scope.through ?? [])
    .map((reference) => reference.resolved)
    .filter((variable) => variable !== null && variable !== undefined);
};

/** Does anything under `node` create reactive state or register an effect? */
const containsReactiveCall = (node, bindings, visitorKeys) => {
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (isReactiveFactory(current, bindings) || isEffectCall(current, bindings)) return true;
    // Walk by visitor keys rather than every own property: `parent` would loop, and
    // `range`/`start`/`end` are noise.
    for (const key of visitorKeys[current.type] ?? []) stack.push(current[key]);
  }
  return false;
};

const returnsObjectLiteral = (fn) => {
  const body = fn.body;
  if (body === null || body?.type !== "BlockStatement") return false;
  const last = body.body.at(-1);
  return last?.type === "ReturnStatement" && last.argument?.type === "ObjectExpression";
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify every top-level statement of `<script setup>`.
 *
 * Free: imports, types, compiler macros, `use*()` calls, plain constants, and
 * helper functions that never touch component state.
 *
 * Costed: reactive state (`ref`/`computed`/…, and top-level `let`), effects
 * (`watch`/lifecycle), and handlers that close over component state.
 */
const classifyBody = (body, scopeManager, bindings, freeBindings) => {
  const stateVariables = new Set();
  const handlers = [];
  const costs = [];

  const declare = (node) => {
    for (const variable of scopeManager.getDeclaredVariables(node) ?? []) {
      if (!freeBindings.has(variable.name)) stateVariables.add(variable);
    }
  };

  // Pass 1 — collect the component's reactive surface and defer handlers.
  for (const statement of body) {
    switch (statement.type) {
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
      case "ExportAllDeclaration":
      case "TSTypeAliasDeclaration":
      case "TSInterfaceDeclaration":
      case "TSEnumDeclaration":
      case "TSModuleDeclaration":
      case "TSDeclareFunction":
      case "EmptyStatement":
        break;

      case "VariableDeclaration": {
        // A top-level `let`/`var` is mutable component state even without ref().
        const mutable = statement.kind !== "const";
        for (const declarator of statement.declarations) {
          const name = calleeName(declarator.init);

          if (name !== null && COMPILER_MACROS.has(name)) {
            declare(declarator);
            continue;
          }
          if (isComposableName(name)) {
            declare(declarator);
            continue;
          }
          if (isReactiveFactory(declarator.init, bindings) || mutable) {
            declare(declarator);
            costs.push("state");
            continue;
          }
          if (isFunctionish(declarator.init) && declarator.id.type === "Identifier") {
            handlers.push({ declarator, node: declarator.init });
            continue;
          }
          // Plain constant: lookup table, class string, formatter, component ref.
        }
        break;
      }

      case "FunctionDeclaration": {
        if (isComposableName(statement.id?.name ?? null)) break;
        if (statement.id !== null) handlers.push({ declarator: statement, node: statement });
        break;
      }

      case "ExpressionStatement": {
        const name = calleeName(statement.expression);
        if (name !== null && COMPILER_MACROS.has(name)) break;
        if (isComposableName(name)) break;
        if (isEffectCall(statement.expression, bindings)) costs.push("effect");
        break;
      }

      default:
        break;
    }
  }

  // Pass 2 — a handler costs a point only if it reaches component state, directly
  // or through another impure handler. Fixpoint, because handlers call handlers;
  // it terminates because `impure` only ever grows and is bounded by `handlers`.
  const impure = new Set();
  const settled = new Set();
  const pending = handlers.map((handler) => ({
    variables: scopeManager.getDeclaredVariables(handler.declarator) ?? [],
    free: freeVariables(scopeManager, handler.node),
  }));

  let changed = true;
  while (changed) {
    changed = false;
    for (const handler of pending) {
      if (settled.has(handler)) continue;
      const reaches = handler.free.some(
        (variable) =>
          stateVariables.has(variable) ||
          (impure.has(variable) && !handler.variables.includes(variable)),
      );
      if (!reaches) continue;
      settled.add(handler);
      for (const variable of handler.variables) impure.add(variable);
      costs.push("handler");
      changed = true;
    }
  }

  return costs;
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const plugin = {
  meta: { name: "vue-cohesion" },
  rules: {
    "script-setup-cohesion": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Group loose <script setup> logic into inline composables.",
          url: DOCS,
        },
        messages: {
          tooLoose:
            "<script setup> has {{count}} ungrouped top-level {{units}} ({{breakdown}}); limit is {{max}}. Group related state, effects and handlers into named `use*()` inline composables.",
        },
        defaultOptions: [{ max: 10 }],
        schema: [
          {
            type: "object",
            properties: {
              max: { type: "integer", minimum: 0 },
              // Bindings that look like state but read as ambient utilities —
              // `t` from useI18n() is the usual one.
              freeBindings: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
          },
        ],
      },
      create(context) {
        const { max } = context.options[0];
        const freeBindings = new Set(context.options[0].freeBindings ?? []);

        return {
          Program(node) {
            if (!isScriptSetup(context)) return;

            const { scopeManager } = context.sourceCode;
            const bindings = resolveReferences(scopeManager);
            const costs = classifyBody(node.body, scopeManager, bindings, freeBindings);
            if (costs.length <= max) return;

            const tally = costs.reduce((acc, cost) => {
              acc[cost] = (acc[cost] ?? 0) + 1;
              return acc;
            }, {});
            const breakdown = ["state", "effect", "handler"]
              .filter((kind) => tally[kind] !== undefined)
              .map((kind) => `${tally[kind]} ${kind}`)
              .join(", ");

            context.report({
              node: node.body[0] ?? node,
              messageId: "tooLoose",
              data: {
                count: costs.length,
                units: costs.length === 1 ? "unit" : "units",
                max,
                breakdown,
              },
            });
          },
        };
      },
    },

    "inline-composable-naming": {
      meta: {
        type: "suggestion",
        docs: { description: "Inline composables must be named use*.", url: DOCS },
        messages: {
          rename:
            "`{{name}}()` owns reactive state and returns an object — name it `{{suggestion}}()` so it reads as an inline composable.",
        },
      },
      create(context) {
        let bindings = null;

        const check = (name, fn, reportNode) => {
          if (name === null || isComposableName(name)) return;
          if (!returnsObjectLiteral(fn)) return;
          const { visitorKeys } = context.sourceCode;
          if (!containsReactiveCall(fn.body, bindings, visitorKeys)) return;
          context.report({
            node: reportNode,
            messageId: "rename",
            data: { name, suggestion: `use${name[0].toUpperCase()}${name.slice(1)}` },
          });
        };

        return {
          Program() {
            // Only resolved once the block is known to be the one this rule governs.
            bindings = isScriptSetup(context)
              ? resolveReferences(context.sourceCode.scopeManager)
              : null;
          },
          "Program > FunctionDeclaration"(node) {
            if (bindings === null) return;
            check(node.id?.name ?? null, node, node.id ?? node);
          },
          "Program > VariableDeclaration > VariableDeclarator"(node) {
            if (bindings === null) return;
            if (!isFunctionish(node.init) || node.id.type !== "Identifier") return;
            check(node.id.name, node.init, node.id);
          },
        };
      },
    },
  },
};

export default plugin;
