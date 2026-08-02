// Fixtures are written to a temporary directory rather than committed as .vue files, so
// the repository's own lint, format, type-check and knip passes never see deliberately bad
// components. See `scripts/oxlint-rule-test.mjs` for how they are linted.

import { resolve } from "node:path";

import { createRuleTester } from "./oxlint-rule-test.mjs";
import plugin from "./oxlint-vue-cohesion.mjs";

const ruleTest = createRuleTester({
  plugin,
  path: resolve(import.meta.dirname, "oxlint-vue-cohesion.mjs"),
});

const sfc = (script, attrs = ' setup lang="ts"') =>
  `<script${attrs}>\n${script}\n</script>\n\n<template><div /></template>\n`;

/**
 * The one report `script-setup-cohesion` makes, spelled as its breakdown.
 *
 * Naming the classification — "7 state, 2 effect, 5 handler" — rather than its total says
 * what the rule saw, not merely how much of it there was.
 */
const tooLoose = (breakdown, max = 0) => {
  const count = breakdown.split(", ").reduce((total, part) => total + Number.parseInt(part, 10), 0);
  return [
    {
      messageId: "tooLoose",
      data: { count, units: count === 1 ? "unit" : "units", max, breakdown },
    },
  ];
};

const rename = (name) => [
  {
    messageId: "rename",
    data: { name, suggestion: `use${name[0].toUpperCase()}${name.slice(1)}` },
  },
];

// Linting at `max: 0` makes every classified unit visible, so a case that reports nothing
// is one the rule considers genuinely free rather than merely under budget.
const strict = [{ max: 0 }];

ruleTest("script-setup-cohesion", {
  valid: [
    {
      name: "the target shape: every unit is a named use*() call",
      options: strict,
      code: sfc(`
import { computed, ref, watch, onMounted } from "vue";
import { useRoute } from "vue-router";

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: [] }>();
const route = useRoute();

const { draft, updateDraft } = useDraft();
const { sending, send } = useSend(draft);
const active = useActivity();
useAutoScroll();

function useDraft() {
  const draft = ref("");
  watch(() => props.id, () => { draft.value = ""; });
  const updateDraft = (event: Event): void => { draft.value = String(event); };
  return { draft, updateDraft };
}

function useActivity() {
  return computed(() => route.name === "thread");
}

function useSend(draft) {
  const sending = ref(false);
  const send = async (): Promise<void> => {
    sending.value = true;
    try { await Promise.resolve(draft.value); } finally { sending.value = false; }
  };
  return { sending, send };
}

function useAutoScroll() {
  onMounted(() => { window.scrollTo(0, 0); });
}
`),
    },
    {
      name: "a wall of use*() calls is exactly what the rule wants",
      options: strict,
      code: sfc(`
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const workspace = useWorkspaceStore();
const { draft, updateDraft } = useDraft();
const { sending, send, onKeydown } = useSend();
const { discardOpen, discard } = useDiscard();
const { attachments, addAttachment } = useAttachments();
const { paletteOpen, closePalette } = useCommandPalette();
const browser = useDirectoryBrowser();
const settings = useSettingsDialog();
const projects = useSidebarProjects();
const { showHidden } = useHiddenFolders();
const focus = useComposerFocus();
const graph = useFlowGraph();
`),
    },
    {
      name: "Options API components are out of scope for the pattern",
      options: strict,
      code: sfc(
        `
import { defineComponent, ref } from "vue";

export default defineComponent({
  props: { id: { type: String, required: true } },
  setup() {
    const a = ref(1);
    const b = ref(2);
    const c = ref(3);
    const d = ref(4);
    const e = ref(5);
    const f = ref(6);
    const g = ref(7);
    const h = ref(8);
    const i = ref(9);
    const j = ref(10);
    const k = ref(11);
    const l = ref(12);
    return { a, b, c, d, e, f, g, h, i, j, k, l };
  },
});
`,
        ' lang="ts"',
      ),
    },
    {
      name: "no script block at all must not crash the rule",
      options: strict,
      code: `<template><div class="empty">no script here</div></template>\n`,
    },
    {
      name: "an empty script setup must not crash the rule",
      options: strict,
      code: `<script setup lang="ts"></script>\n\n<template><div /></template>\n`,
    },
    {
      name: "component and async-component definitions are not reactive state",
      options: strict,
      code: sfc(`
import { defineAsyncComponent, markRaw, h } from "vue";

const AgentMap = defineAsyncComponent(() => import("./AgentMap.vue"));
const ReviewPanel = defineAsyncComponent(() => import("./ReviewPanel.vue"));
const Icon = markRaw({ render: () => h("svg") });
const formatter = new Intl.DateTimeFormat("en");
const collator = new Intl.Collator("en");
const controller = new AbortController();
const decoder = new TextDecoder();
`),
    },
    {
      name: "handlers bound only to imports and constants own no component state",
      options: strict,
      code: sfc(`
import { api } from "./api.js";

const LABEL = "save";

const save = () => api.save(LABEL);
const load = () => api.load();
function reset() { return api.reset(); }
`),
    },
    {
      name: "a composable file's worth of refs is free once it lives inside a use* function",
      options: strict,
      code: sfc(`
import { ref, computed, watch } from "vue";

const state = useEverything();

function useEverything() {
  const a = ref(0);
  const b = ref(0);
  const c = ref(0);
  const d = ref(0);
  const e = ref(0);
  const f = ref(0);
  const g = ref(0);
  const h = ref(0);
  const i = ref(0);
  const j = ref(0);
  const k = computed(() => a.value + b.value);
  watch(a, () => {});
  watch(b, () => {});
  return { a, b, c, d, e, f, g, h, i, j, k };
}
`),
    },
    {
      name: "a local function that borrows a reactive name is not reactive",
      options: strict,
      code: sfc(`
const computed = (value: number): number => value * 2;
const reactive = (value: object): object => ({ ...value });

const a = computed(1);
const b = computed(2);
const c = reactive({});
`),
    },
    {
      name: "a module-scope <script> is not a setup block, however loose it looks",
      options: strict,
      code: `<script lang="ts">
import { ref } from "vue";

const projectOpen = ref(false);
const paletteOpen = ref(false);
const settingsOpen = ref(false);
const path = ref("");
const name = ref("");

export default { setup: () => ({ projectOpen }) };
</script>

<template><div /></template>
`,
    },
    {
      name: "`setup` must be an attribute of its own, not a substring of another value",
      options: strict,
      code: `<script lang="ts">
import { ref } from "vue";

const open = ref(false);

export default { name: "setup" };
</script>

<template><div /></template>
`,
    },
    {
      name: "`t` from useI18n() can be declared an ambient binding",
      options: [{ max: 0, freeBindings: ["t"] }],
      code: sfc(`
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const relativeAge = (timestamp: string): string => t("time.now", { count: 1 });
`),
    },
    {
      name: "ten units sit within the default budget",
      code: sfc(`
import { ref } from "vue";
${Array.from({ length: 10 }, (_, index) => `const s${index} = ref(0);`).join("\n")}
`),
    },
  ],

  invalid: [
    {
      name: "styling constants and lookup tables are not component logic",
      options: strict,
      errors: tooLoose("1 state"),
      code: sfc(`
import { ref } from "vue";

const codeBlockClass = "m-0 mx-3 mb-3 max-h-[14rem] overflow-auto rounded-xs";
const filterClass = "min-h-[2.15rem] pr-[1.7rem] text-[0.65rem]";
const inspectorRowClass = "grid grid-cols-[6rem_1fr] gap-2 border-t";
const sectionHeadingClass = "m-0 mb-[0.65rem] flex items-center";
const proseClass = "mt-[0.35rem] mb-[0.8rem] text-[0.68rem]";
const previewRowClass = "flex justify-between gap-4 text-[0.63rem]";
const centerStateClass = "grid h-full place-items-center content-center";
const ACTIVITY_PAGE_SIZE = 200;
const SHOW_HIDDEN = "vue-ui.show-hidden-folders";
const SCROLL_ANCHOR_SLACK = 96;
const ACTIVE_STATUSES = new Set(["starting", "running", "waiting"]);
const PROVIDER_LABELS = { codex: "Codex", claude: "Claude" };
const EFFORTS = ["low", "medium", "high"];
const PATH_PATTERN = /^[a-z0-9/_-]+$/i;

const open = ref(false);
`),
    },
    {
      name: "compiler macros are declarations, not logic",
      options: strict,
      errors: tooLoose("1 state"),
      code: sfc(`
import { ref } from "vue";

const props = withDefaults(defineProps<{ size?: string }>(), { size: "md" });
const emit = defineEmits<{ close: []; save: [value: string] }>();
const model = defineModel<string>();
const slots = defineSlots<{ default(): unknown }>();
defineOptions({ inheritAttrs: false });
defineExpose({ focus: () => {} });

const open = ref(false);
`),
    },
    {
      name: "type declarations carry no runtime cost",
      options: strict,
      errors: tooLoose("1 state"),
      code: sfc(`
import type { Ref } from "vue";
import { ref } from "vue";

type Surface = "conversation" | "map";
type Density = "comfortable" | "compact";
interface Row { label: string; value: string }
interface Column { key: string; width: number }
type Handler = (event: Event) => void;
type Loader<T> = () => Promise<T>;
type Maybe<T> = T | null;
type Pair = [Surface, Density];

const surface = ref<Surface>("conversation");
`),
    },
    {
      name: "arrow functions that touch no reactive state are utils, not component logic",
      options: strict,
      errors: tooLoose("1 state"),
      code: sfc(`
import { ref } from "vue";

const open = ref(false);

const selection = (target: HTMLTextAreaElement) => ({
  cursorStart: target.selectionStart,
  cursorEnd: target.selectionEnd,
});
const commandChord = (key: string) => (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === key;
const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
const clamp = (value: number, max: number): number => Math.min(value, max);
const titleCase = (value: string): string => value[0].toUpperCase() + value.slice(1);
const byOrder = (left: { order: number }, right: { order: number }) => left.order - right.order;
const isBlank = (value: string): boolean => value.trim().length === 0;
const toLabel = (provider: string): string => (provider === "codex" ? "Codex" : "Claude");
`),
    },
    {
      name: "a bare use*() side-effect call is still a named unit",
      options: strict,
      errors: tooLoose("1 state"),
      code: sfc(`
import { ref } from "vue";

const open = ref(false);

useDeepLinkedDialogs({ openAddProject: () => {}, openSettings: () => {} });
useKeyboardShortcuts();
useDocumentTitle();
useResetCwdOnLeave();
useEventListener(window, "resize", () => {});
useIntervalFn(() => {}, 1000);
`),
    },
    {
      name: "twelve ungrouped refs",
      options: strict,
      errors: tooLoose("12 state"),
      code: sfc(`
import { ref, computed } from "vue";

const projectOpen = ref(false);
const paletteOpen = ref(false);
const settingsOpen = ref(false);
const path = ref("");
const name = ref("");
const saving = ref(false);
const addError = ref<string | null>(null);
const browsing = ref(false);
const browseError = ref<string | null>(null);
const theme = ref("system");
const density = ref("comfortable");
const visible = computed(() => projectOpen.value || paletteOpen.value);
`),
    },
    {
      name: "ungrouped watchers and lifecycle hooks",
      options: strict,
      errors: tooLoose("3 state, 7 effect"),
      code: sfc(`
import { ref, watch, watchEffect, onMounted, onUpdated, onBeforeUnmount } from "vue";
import { onKeyStroke } from "@vueuse/core";

const a = ref(0);
const b = ref(0);
const c = ref(0);

watch(a, () => {});
watch(b, () => {});
watchEffect(() => {});
onMounted(() => {});
onUpdated(() => {});
onBeforeUnmount(() => {});
onKeyStroke("k", () => {});
`),
    },
    {
      name: "top-level mutable `let` is component state even without ref()",
      options: strict,
      errors: tooLoose("8 state, 1 effect"),
      code: sfc(`
import { ref, onMounted } from "vue";

let anchoredToBottom = true;
let lastScrollTop = 0;
let pendingFrame: number | null = null;
let observer: ResizeObserver | null = null;
let retries = 0;
let cachedHeight = 0;
let dragging = false;

const element = ref<HTMLElement | null>(null);

onMounted(() => { anchoredToBottom = true; });
`),
    },
    {
      name: "the ProjectSidebar shape: state, handlers and effects, all flat",
      options: strict,
      errors: tooLoose("7 state, 2 effect, 5 handler"),
      code: sfc(`
import { ref, computed, watch, onMounted } from "vue";

const open = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const items = ref<string[]>([]);
const query = ref("");
const selected = ref<string | null>(null);
const filtered = computed(() => items.value.filter((i) => i.includes(query.value)));

const load = async (): Promise<void> => { busy.value = true; items.value = []; busy.value = false; };
const select = (item: string): void => { selected.value = item; };
const clear = (): void => { query.value = ""; error.value = null; };
const toggle = (): void => { open.value = !open.value; };
const retry = async (): Promise<void> => { error.value = null; await load(); };

watch(query, () => { void load(); });
onMounted(() => { void load(); });
`),
    },
    {
      name: "parameters shadowing top-level refs must not make a helper look stateful",
      options: strict,
      errors: tooLoose("2 state"),
      code: sfc(`
import { ref } from "vue";

const open = ref(false);
const busy = ref(false);

const render = (open: boolean, busy: boolean) => (open && busy ? "x" : "y");
const pick = ({ open }: { open: boolean }) => open;
function format(busy: string) { return busy.trim(); }
`),
    },
    {
      name: "shadowing inside a nested closure is still shadowing",
      options: strict,
      errors: tooLoose("1 state"),
      code: sfc(`
import { ref } from "vue";

const items = ref<string[]>([]);

const build = (): number => {
  const render = (items: string[]): number => items.length;
  return render([]);
};
`),
    },
    {
      name: "a handler that reaches state through another handler still counts",
      options: strict,
      errors: tooLoose("1 state, 3 handler"),
      code: sfc(`
import { ref } from "vue";

const busy = ref(false);

const setBusy = (value: boolean): void => { busy.value = value; };
const load = async (): Promise<void> => { setBusy(true); };
const retry = async (): Promise<void> => { await load(); };
const unrelated = (value: string): string => value.trim();
`),
    },
    {
      name: "self-recursion must terminate and must not make a pure helper impure",
      options: strict,
      errors: tooLoose("1 state, 1 handler"),
      code: sfc(`
import { ref } from "vue";

const depth = ref(0);

const walk = (n: number): number => { depth.value = n; return n > 0 ? walk(n - 1) : 0; };
const pureWalk = (n: number): number => (n > 0 ? pureWalk(n - 1) : 0);
`),
    },
    {
      name: "mutually recursive handlers must reach a fixpoint, not loop forever",
      options: strict,
      errors: tooLoose("1 state, 2 handler"),
      code: sfc(`
import { ref } from "vue";

const flag = ref(false);

const ping = (n: number): boolean => (n > 0 ? pong(n - 1) : flag.value);
const pong = (n: number): boolean => (n > 0 ? ping(n - 1) : false);
`),
    },
    {
      name: "a handler declared before the state it touches must still be classified",
      options: strict,
      errors: tooLoose("1 state, 1 effect, 1 handler"),
      code: sfc(`
import { ref, onMounted } from "vue";

const boot = (): void => { open.value = true; };
const open = ref(false);

onMounted(boot);
`),
    },
    {
      name: "documented judgment call: `t` costs a unit unless declared ambient",
      options: strict,
      errors: tooLoose("1 handler"),
      code: sfc(`
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const relativeAge = (timestamp: string): string => t("time.now", { count: 1 });
`),
    },
    {
      name: "storeToRefs and toRefs produce reactive state even though they destructure",
      options: strict,
      errors: tooLoose("2 state"),
      code: sfc(`
import { storeToRefs, toRefs } from "pinia";

const store = useWorkspaceStore();
const { projects, threads } = storeToRefs(store);
const { theme, density } = toRefs(store.settings);
`),
    },
    {
      name: "documented blind spot: handlers hidden in an object literal are not counted",
      options: strict,
      errors: tooLoose("1 state"),
      code: sfc(`
import { ref } from "vue";

const open = ref(false);

const handlers = {
  toggle: () => { open.value = !open.value; },
  reset: () => { open.value = false; },
};
`),
    },
    {
      name: "as const, satisfies, enum and declare must not be mistaken for state",
      options: strict,
      errors: tooLoose("1 state"),
      code: sfc(`
import { ref } from "vue";

const MODES = ["a", "b"] as const;
const config = { mode: "a" } satisfies { mode: string };
const element = ref<HTMLElement | null>(null);
const cast = (value: unknown): string => (value as string).trim();

enum Kind { A, B }
declare const ambient: string;
`),
    },
    {
      name: "async setup must not crash or miscount",
      options: strict,
      errors: tooLoose("1 state"),
      code: sfc(`
import { ref } from "vue";
import { api } from "./api.js";

const data = await api.load();
const rows = (await api.rows()).map((row) => row.id);
const selected = ref<string | null>(null);
`),
    },
    {
      name: "factories are resolved through their binding, so an alias is still `ref`",
      options: strict,
      errors: tooLoose("3 state"),
      code: sfc(`
import { ref as state, computed as derived } from "vue";

const a = state(0);
const b = state(0);
const c = derived(() => a.value);
`),
    },
    {
      name: "a member call has no binding to resolve, so the property name is the signal",
      options: strict,
      errors: tooLoose("3 state"),
      code: sfc(`
import * as vue from "vue";

const a = vue.ref(0);
const b = vue.ref(0);
const c = vue.computed(() => a.value);
`),
    },
    {
      name: "an unresolved global is an auto-import, where the written name is all there is",
      options: strict,
      errors: tooLoose("3 state"),
      code: sfc(`
const a = ref(0);
const b = ref(0);
const c = computed(() => a.value);
`),
    },
    {
      name: "only the setup block of a two-block SFC is classified",
      options: strict,
      errors: tooLoose("2 state"),
      code: `<script lang="ts">
import { ref } from "vue";

const shared = ref(0);
const alsoShared = ref(0);

export const ROUTE_NAME = "thread";
</script>

<script setup lang="ts">
import { ref } from "vue";

const open = ref(false);
const busy = ref(false);
</script>

<template><div /></template>
`,
    },
    {
      name: "block order does not decide which block is the setup block",
      options: strict,
      errors: tooLoose("2 state"),
      code: `<script setup lang="ts">
import { ref } from "vue";

const open = ref(false);
const busy = ref(false);
</script>

<script lang="ts">
import { ref } from "vue";

const shared = ref(0);
const alsoShared = ref(0);

export const ROUTE_NAME = "thread";
</script>

<template><div /></template>
`,
    },
    {
      name: "the generic= attribute must not hide the setup attribute",
      options: strict,
      errors: tooLoose("1 state"),
      code: sfc(
        `
import { ref } from "vue";

const props = defineProps<{ items: T[] }>();
const selected = ref<T | null>(null);
`,
        ' setup lang="ts" generic="T"',
      ),
    },
    {
      name: "eleven units exceed the default budget of ten",
      errors: tooLoose("11 state", 10),
      code: sfc(`
import { ref } from "vue";
${Array.from({ length: 11 }, (_, index) => `const s${index} = ref(0);`).join("\n")}
`),
    },
  ],
});

ruleTest("inline-composable-naming", {
  valid: [
    {
      name: "already named use*",
      code: sfc(`
import { ref, watch } from "vue";

const { showHidden } = useHiddenFolders();

function useHiddenFolders() {
  const showHidden = ref(false);
  watch(showHidden, (value) => { localStorage.setItem("k", String(value)); });
  return { showHidden };
}
`),
    },
    {
      name: "an arrow composable already named use* is fine too",
      code: sfc(`
import { ref } from "vue";

const { value } = useThing();

const useThing = () => {
  const value = ref(0);
  return { value };
};
`),
    },
    {
      name: "returns an object but owns no reactive state — a plain factory",
      code: sfc(`
import { ref } from "vue";

const open = ref(false);
const rows = buildRows("a", "b");

function buildRows(left: string, right: string) {
  const joined = left + right;
  return { left, right, joined };
}

function inspectorRows(status: string, activity: string) {
  return { status, activity, label: status + activity };
}
`),
    },
    {
      name: "helpers nested inside a composable are private and need no use* prefix",
      code: sfc(`
import { ref } from "vue";

const { value } = useThing();

function useThing() {
  const value = ref(0);
  function reset() {
    value.value = 0;
    return { value };
  }
  return { value, reset };
}
`),
    },
    {
      name: "documented blind spot: only a literal return object is recognised",
      code: sfc(`
import { ref } from "vue";

function thing() {
  const items = ref<string[]>([]);
  const result = { items };
  return result;
}
`),
    },
    {
      name: "a local function that borrows a reactive name owns no state",
      code: sfc(`
const computed = (value: number): number => value * 2;

function rows() {
  const total = computed(2);
  return { total };
}
`),
    },
    {
      name: "a composable in a plain <script> block is out of scope for the pattern",
      code: `<script lang="ts">
import { ref } from "vue";

function hiddenFolders() {
  const showHidden = ref(false);
  return { showHidden };
}

export default { setup: hiddenFolders };
</script>

<template><div /></template>
`,
    },
  ],

  invalid: [
    {
      name: "declares reactive state and returns an object, but is not use*",
      errors: rename("hiddenFolders"),
      code: sfc(`
import { ref, watch } from "vue";

const { showHidden } = hiddenFolders();

function hiddenFolders() {
  const showHidden = ref(false);
  watch(showHidden, (value) => { localStorage.setItem("k", String(value)); });
  return { showHidden };
}
`),
    },
    {
      name: "the same shape written as an arrow const",
      errors: rename("hiddenFolders"),
      code: sfc(`
import { ref, watch } from "vue";

const { showHidden } = hiddenFolders();

const hiddenFolders = () => {
  const showHidden = ref(false);
  watch(showHidden, (value) => { localStorage.setItem("k", String(value)); });
  return { showHidden };
};
`),
    },
    {
      name: "state is reactive even when the mutator is a returned closure",
      errors: rename("timeline"),
      code: sfc(`
import { ref } from "vue";

const { items } = timeline();

function timeline() {
  const items = ref<string[]>([]);
  return { items, reload: () => { items.value = []; } };
}
`),
    },
    {
      name: "async inline composables need the use* prefix too",
      errors: rename("loadThings"),
      code: sfc(`
import { ref } from "vue";

async function loadThings() {
  const items = ref<string[]>([]);
  await Promise.resolve();
  return { items };
}
`),
    },
    {
      name: "reactivity behind an alias still marks the function as a composable",
      errors: rename("timeline"),
      code: sfc(`
import { ref as state } from "vue";

function timeline() {
  const items = state<string[]>([]);
  return { items };
}
`),
    },
  ],
});
