import fs from "node:fs";
import path from "node:path";

const REQUIRE_PATTERN = /require\s*\(?["']([^"']+)["']\)?/g;

interface BundleState {
  entryPath: string;
  hoistedComments: string[];
  includedModules: Set<string>;
  preloads: string[];
  totalInputBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }

  const base = 1024;
  const sizes = ["B", "KB", "MB"];
  const index = Math.floor(Math.log(bytes) / Math.log(base));
  return `${Number.parseFloat((bytes / Math.pow(base, index)).toFixed(2))} ${sizes[index]}`;
}

function resolveModulePath(moduleName: string): string {
  return `${moduleName.replace(/\./g, "/")}.lua`;
}

function minifyLua(content: string, hoistedComments: string[]): string {
  const tokenPattern =
    /(--\[(=*)\[[\s\S]*?\]\2\])|(--.*)|(\[(=*)\[[\s\S]*?\]\5\])|("([^"\\]|\\.)*")|('([^'\\]|\\.)*')/g;

  return content
    .replace(
      tokenPattern,
      (match: string, longComment?: string, _equals?: string, shortComment?: string) => {
        if (!longComment && !shortComment) {
          return match;
        }
        if (shortComment?.startsWith("--!") || (longComment && /^--\[(=*)\[!/.test(match))) {
          hoistedComments.push(match);
        }
        return " ";
      },
    )
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function processModule(moduleName: string, state: BundleState): void {
  if (state.includedModules.has(moduleName)) {
    return;
  }

  const rootDirectory = path.dirname(path.resolve(state.entryPath));
  const modulePath = path.join(rootDirectory, resolveModulePath(moduleName));
  if (!fs.existsSync(modulePath)) {
    console.warn(`Warning: Module '${moduleName}' not found`);
    return;
  }

  const rawContent = fs.readFileSync(modulePath, "utf8");
  state.includedModules.add(moduleName);
  state.totalInputBytes += fs.statSync(modulePath).size;

  for (const match of rawContent.matchAll(new RegExp(REQUIRE_PATTERN.source, "g"))) {
    const dependency = match[1];
    if (dependency) {
      processModule(dependency, state);
    }
  }

  const minifiedContent = minifyLua(rawContent, state.hoistedComments);
  state.preloads.push(`package.preload["${moduleName}"]=function(...)${minifiedContent} end`);
}

function bundleLua(entryPath: string, outputArgument: string): string {
  const resolvedEntryPath = path.resolve(entryPath);
  if (!fs.existsSync(resolvedEntryPath)) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  let outputPath = path.resolve(outputArgument);
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory()) {
    outputPath = path.join(outputPath, path.basename(resolvedEntryPath));
  }
  if (path.extname(outputPath) !== ".lua") {
    outputPath += ".lua";
  }

  const state: BundleState = {
    entryPath: resolvedEntryPath,
    hoistedComments: [],
    includedModules: new Set(),
    preloads: [],
    totalInputBytes: fs.statSync(resolvedEntryPath).size,
  };
  const mainContent = fs.readFileSync(resolvedEntryPath, "utf8");

  for (const match of mainContent.matchAll(new RegExp(REQUIRE_PATTERN.source, "g"))) {
    const moduleName = match[1];
    if (moduleName) {
      processModule(moduleName, state);
    }
  }

  const mainMinified = minifyLua(mainContent, state.hoistedComments);
  const hoisted = state.hoistedComments.length > 0 ? `${state.hoistedComments.join("\n")}\n` : "";
  const output = `${hoisted}${state.preloads.join("\n")}\n${mainMinified}`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, "utf8");

  const outputBytes = fs.statSync(outputPath).size;
  const reduction = ((state.totalInputBytes - outputBytes) / state.totalInputBytes) * 100;
  console.log(
    `Bundled ${path.relative(process.cwd(), resolvedEntryPath)} to ${path.relative(process.cwd(), outputPath)}`,
  );
  console.log(
    `${state.includedModules.size} modules, ${formatBytes(state.totalInputBytes)} to ${formatBytes(outputBytes)}, ${reduction.toFixed(2)}% reduction`,
  );
  return outputPath;
}

export { bundleLua };
