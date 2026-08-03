import { delimiter, isAbsolute, relative, resolve } from "node:path";

export const configuredProjectBrowserRoots = (configured?: string): ReadonlyArray<string> => {
  const roots = configured === undefined ? [process.cwd()] : configured.split(delimiter);
  return roots.filter((root) => root.trim().length > 0).map((root) => resolve(root));
};

export const isWithinProjectBrowserRoot = (candidate: string, root: string): boolean => {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
};
