import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createExpandedModuleSources } from "./unpack-charx.js";

const RPACK_MAP_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "vendor",
  "rpack",
  "rpack_map.bin",
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEmptyOutputDirectory(outputDirectory) {
  if (!fs.existsSync(outputDirectory)) {
    return;
  }
  assert(
    fs.statSync(outputDirectory).isDirectory(),
    `Output path is not a directory: ${outputDirectory}`,
  );
  assert(
    fs.readdirSync(outputDirectory).length === 0,
    `Output directory is not empty: ${outputDirectory}`,
  );
}

function decodeRPack(data, decodeMap) {
  for (let index = 0; index < data.length; index += 1) {
    data[index] = decodeMap[data[index]];
  }
  return data;
}

function readExactly(fileDescriptor, length, position, label) {
  const data = Buffer.allocUnsafe(length);
  let read = 0;
  while (read < length) {
    const count = fs.readSync(fileDescriptor, data, read, length - read, position + read);
    assert(count > 0, `${label} is truncated at byte ${position + read}`);
    read += count;
  }
  return data;
}

function sanitizeAssetName(name: string, fallback: string): string {
  const sanitized = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 ? "_" : character,
  )
    .join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return sanitized.slice(0, 180) || fallback;
}

function detectAssetExtension(data, fallback) {
  if (data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "png";
  }
  if (data.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) {
    return "jpg";
  }
  if (
    data.subarray(0, 6).toString("ascii") === "GIF87a" ||
    data.subarray(0, 6).toString("ascii") === "GIF89a"
  ) {
    return "gif";
  }
  if (
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  if (data.subarray(4, 12).toString("ascii").includes("ftypavif")) {
    return "avif";
  }
  return /^[a-z0-9]+$/i.test(fallback ?? "") ? fallback.toLowerCase() : "bin";
}

function takeAssetPath(asset, data, index, takenPaths) {
  const extension = detectAssetExtension(data, asset[2]);
  const baseName = sanitizeAssetName(asset[0] ?? "", `asset_${index + 1}`);
  let candidate = `assets/${baseName}.${extension}`;
  let collision = 1;
  while (takenPaths.has(candidate)) {
    collision += 1;
    candidate = `assets/${baseName}_${collision}.${extension}`;
  }
  takenPaths.add(candidate);
  return candidate;
}

function writeSources(outputDirectory, decodedModule, assetSources) {
  const card = {
    data: {
      name: decodedModule.module.name,
    },
  };
  const sources = createExpandedModuleSources(card, decodedModule);
  const manifestSource = sources.get("charx.json");
  assert(manifestSource, "Expanded module sources do not contain charx.json");
  const manifest = JSON.parse(manifestSource.toString("utf8"));
  manifest.assets = assetSources;
  sources.set("charx.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));

  for (const [name, data] of sources) {
    const destination = path.join(outputDirectory, ...name.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data);
  }
}

function unpackRisuM(inputPath: string, outputPath: string): string {
  const resolvedInputPath = path.resolve(inputPath);
  const resolvedOutputPath = path.resolve(outputPath);
  assertEmptyOutputDirectory(resolvedOutputPath);

  const map = fs.readFileSync(RPACK_MAP_PATH);
  assert(map.length >= 512, `Invalid RPack map: ${RPACK_MAP_PATH}`);
  const decodeMap = map.subarray(256, 512);
  const fileDescriptor = fs.openSync(resolvedInputPath, "r");

  try {
    const fileSize = fs.fstatSync(fileDescriptor).size;
    const header = readExactly(fileDescriptor, 6, 0, "RISUM header");
    assert(header.readUInt8(0) === 111, "Invalid RISUM magic number");
    assert(header.readUInt8(1) === 0, `Unsupported RISUM version: ${header.readUInt8(1)}`);

    const payloadLength = header.readUInt32LE(2);
    const payload = readExactly(fileDescriptor, payloadLength, 6, "RISUM module payload");
    const decodedModule = JSON.parse(decodeRPack(payload, decodeMap).toString("utf8"));
    assert(
      decodedModule?.type === "risuModule" && decodedModule.module,
      "RISUM does not contain a Risu module",
    );

    const assetMetadata = decodedModule.module.assets ?? [];
    const assetSources: any[] = [];
    const takenPaths = new Set<string>();
    let assetIndex = 0;
    let position = 6 + payloadLength;

    fs.mkdirSync(path.join(resolvedOutputPath, "assets"), { recursive: true });
    while (position < fileSize) {
      const marker = readExactly(fileDescriptor, 1, position, "RISUM asset marker").readUInt8(0);
      position += 1;
      if (marker === 0) {
        break;
      }
      assert(marker === 1, `Invalid RISUM asset marker at byte ${position - 1}: ${marker}`);
      assert(
        assetIndex < assetMetadata.length,
        "RISUM contains more asset blocks than asset metadata entries",
      );

      const lengthData = readExactly(fileDescriptor, 4, position, "RISUM asset length");
      const assetLength = lengthData.readUInt32LE(0);
      position += 4;
      const encodedAsset = readExactly(
        fileDescriptor,
        assetLength,
        position,
        `RISUM asset ${assetIndex + 1}`,
      );
      position += assetLength;

      const metadata = assetMetadata[assetIndex];
      assert(metadata, `RISUM asset ${assetIndex + 1} has no metadata`);
      const decodedAsset = decodeRPack(encodedAsset, decodeMap);
      const sourcePath = takeAssetPath(metadata, decodedAsset, assetIndex, takenPaths);
      const destination = path.join(resolvedOutputPath, ...sourcePath.split("/"));
      fs.writeFileSync(destination, decodedAsset);
      assetSources.push({
        extension: path.extname(sourcePath).slice(1),
        file: sourcePath,
        name: metadata[0],
      });
      assetIndex += 1;

      if (assetIndex % 500 === 0) {
        console.log(`Extracted ${assetIndex} / ${assetMetadata.length} assets`);
      }
    }

    assert(
      assetIndex === assetMetadata.length,
      `RISUM contains ${assetIndex} asset blocks but declares ${assetMetadata.length}`,
    );
    assert(
      position === fileSize,
      `RISUM contains ${fileSize - position} trailing bytes after the end marker`,
    );
    writeSources(resolvedOutputPath, decodedModule, assetSources);

    const relativeOutput = path.relative(process.cwd(), resolvedOutputPath) || ".";
    console.log(`Unpacked ${assetIndex} assets and module sources to ${relativeOutput}`);
    return resolvedOutputPath;
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

export { unpackRisuM };
