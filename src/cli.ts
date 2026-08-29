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

function printUsage(): void {
  console.error(`Usage: risupack <command> [arguments]

Commands:
  build-charx <manifest.json> [output.charx]
  bundle-lua <entry.lua> <output.lua>
  inspect-risusave <database.bin> [namespace-or-name]
  unpack-charx <input.charx> [output-directory]
  unpack-risum <input.risum> [output-directory]`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  try {
    switch (command) {
      case "build-charx": {
        const [manifestPath, outputPath] = args;
        if (!manifestPath) {
          throw new Error("build-charx requires a manifest path");
        }
        buildCharX(manifestPath, outputPath);
        return;
      }
      case "bundle-lua": {
        const [entryPath, outputPath] = args;
        if (!entryPath || !outputPath) {
          throw new Error("bundle-lua requires entry and output paths");
        }
        bundleLua(entryPath, outputPath);
        return;
      }
      case "inspect-risusave": {
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
        const [inputPath, outputPath] = args;
        if (!inputPath) {
          throw new Error("unpack-charx requires an input path");
        }
        const parsedInput = parsePath(inputPath);
        unpackCharX(inputPath, outputPath ?? join(parsedInput.dir, parsedInput.name));
        return;
      }
      case "unpack-risum": {
        const [inputPath, outputPath] = args;
        if (!inputPath) {
          throw new Error("unpack-risum requires an input path");
        }
        const parsedInput = parsePath(inputPath);
        unpackRisuM(inputPath, outputPath ?? join(parsedInput.dir, parsedInput.name));
        return;
      }
      default: {
        printUsage();
        process.exitCode =
          command && !COMMANDS.includes(command as (typeof COMMANDS)[number]) ? 1 : 0;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

await main();
