import { readFileSync } from "node:fs";
import { join, parse as parsePath } from "node:path";

import { buildCharX } from "./build-charx.js";
import { bundleLua } from "./bundle.js";
import { parseModuleBlock } from "./inspect-risusave.js";
import { unpackCharX } from "./unpack-charx.js";
import { unpackRisuM } from "./unpack-risum.js";

const COMMANDS = [
  "build-charx",
  "bundle-lua",
  "inspect-risusave",
  "unpack-charx",
  "unpack-risum",
] as const;

type Command = (typeof COMMANDS)[number];

const COMMAND_USAGE: Record<Command, string> = {
  "build-charx": "Usage: risupack build-charx <manifest.json> [output.charx]",
  "bundle-lua": "Usage: risupack bundle-lua <entry.lua> <output.lua>",
  "inspect-risusave": "Usage: risupack inspect-risusave <database.bin> [namespace-or-name]",
  "unpack-charx": "Usage: risupack unpack-charx <input.charx> [output-directory]",
  "unpack-risum": "Usage: risupack unpack-risum <input.risum> [output-directory]",
};

function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function printUsage(toError = false): void {
  const output = `Usage: risupack <command> [arguments]

Commands:
  build-charx <manifest.json> [output.charx]
  bundle-lua <entry.lua> <output.lua>
  inspect-risusave <database.bin> [namespace-or-name]
  unpack-charx <input.charx> [output-directory]
  unpack-risum <input.risum> [output-directory]`;

  if (toError) {
    console.error(output);
  } else {
    console.log(output);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "--help" || command === "-h" || command === "help") {
    const target = args[0] as Command | undefined;
    if (target && target in COMMAND_USAGE) {
      console.log(COMMAND_USAGE[target]);
      return;
    }
    printUsage(false);
    return;
  }

  try {
    switch (command) {
      case "build-charx": {
        if (hasHelpFlag(args)) {
          console.log(COMMAND_USAGE["build-charx"]);
          return;
        }
        const [manifestPath, outputPath] = args;
        if (!manifestPath) {
          throw new Error("build-charx requires a manifest path");
        }
        buildCharX(manifestPath, outputPath);
        return;
      }
      case "bundle-lua": {
        if (hasHelpFlag(args)) {
          console.log(COMMAND_USAGE["bundle-lua"]);
          return;
        }
        const [entryPath, outputPath] = args;
        if (!entryPath || !outputPath) {
          throw new Error("bundle-lua requires entry and output paths");
        }
        bundleLua(entryPath, outputPath);
        return;
      }
      case "inspect-risusave": {
        if (hasHelpFlag(args)) {
          console.log(COMMAND_USAGE["inspect-risusave"]);
          return;
        }
        const [databasePath, query] = args;
        if (!databasePath) {
          throw new Error("inspect-risusave requires a database path");
        }
        const modules = parseModuleBlock(readFileSync(databasePath));
        const selected = query
          ? modules.filter(
              (module) =>
                module.namespace === query || module.name === query || module.id === query,
            )
          : modules;
        process.stdout.write(`${JSON.stringify(selected, null, 2)}\n`);
        return;
      }
      case "unpack-charx": {
        if (hasHelpFlag(args)) {
          console.log(COMMAND_USAGE["unpack-charx"]);
          return;
        }
        const [inputPath, outputPath] = args;
        if (!inputPath) {
          throw new Error("unpack-charx requires an input path");
        }
        const parsedInput = parsePath(inputPath);
        unpackCharX(inputPath, outputPath ?? join(parsedInput.dir, parsedInput.name));
        return;
      }
      case "unpack-risum": {
        if (hasHelpFlag(args)) {
          console.log(COMMAND_USAGE["unpack-risum"]);
          return;
        }
        const [inputPath, outputPath] = args;
        if (!inputPath) {
          throw new Error("unpack-risum requires an input path");
        }
        const parsedInput = parsePath(inputPath);
        unpackRisuM(inputPath, outputPath ?? join(parsedInput.dir, parsedInput.name));
        return;
      }
      default: {
        printUsage(Boolean(command));
        process.exitCode = command ? 1 : 0;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

await main();
