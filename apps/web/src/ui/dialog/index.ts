// Re-export reka primitives as they gain consumers — knip treats a speculative
// barrel export as dead code, so this list tracks real usage rather than the
// full surface reka offers.
export { DialogRoot as Dialog, DialogTrigger } from "reka-ui";

export { default as DialogClose } from "./DialogClose.vue";
export { default as DialogContent } from "./DialogContent.vue";
export { default as DialogDescription } from "./DialogDescription.vue";
export { default as DialogFooter } from "./DialogFooter.vue";
export { default as DialogHeader } from "./DialogHeader.vue";
export { default as DialogTitle } from "./DialogTitle.vue";
