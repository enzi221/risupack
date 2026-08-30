import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import { bundleLua } from "./bundle.js";

const DEFAULT_ICON = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69v17QAAAABJRU5ErkJggg==",
  "base64",
);
const RPACK_MAP_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "vendor",
  "rpack",
  "rpack_map.bin",
);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((value & 1) !== 0) {
        value = 0xedb88320 ^ (value >>> 1);
      } else {
        value >>>= 1;
      }
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function calculateCRC32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function createUUID(seed) {
  const bytes = crypto.createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function detectImageType(data) {
  if (data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "PNG";
  }
  if (data.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) {
    return "JPEG";
  }
  if (
    data.subarray(0, 6).toString("ascii") === "GIF87a" ||
    data.subarray(0, 6).toString("ascii") === "GIF89a"
  ) {
    return "GIF";
  }
  if (
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "WEBP";
  }
  return "Unknown";
}

function getAssetCategory(extension) {
  const audio = new Set(["flac", "mp3", "ogg", "wav"]);
  const code = new Set(["js", "lua", "ts"]);
  const fonts = new Set(["otf", "ttf", "woff", "woff2"]);
  const images = new Set(["avif", "gif", "jpeg", "jpg", "png", "webp"]);
  const models = new Set(["mmd", "obj"]);
  const video = new Set(["avi", "mkv", "mov", "mp4", "webm"]);

  if (audio.has(extension)) {
    return "audio";
  }
  if (code.has(extension)) {
    return "code";
  }
  if (fonts.has(extension)) {
    return "fonts";
  }
  if (images.has(extension)) {
    return "image";
  }
  if (models.has(extension)) {
    return "model";
  }
  if (extension === "onnx" || extension === "safetensors" || extension === "cpkt") {
    return "ai";
  }
  if (video.has(extension)) {
    return "video";
  }
  return "other";
}

function readSource(manifestDirectory, source, label) {
  if (typeof source === "string") {
    return fs.readFileSync(path.resolve(manifestDirectory, source), "utf8");
  }
  assert(source && typeof source === "object", `${label} must be a file path or source object`);
  if (typeof source.content === "string") {
    return source.content;
  }
  assert(typeof source.file === "string", `${label}.file must be a string`);
  return fs.readFileSync(path.resolve(manifestDirectory, source.file), "utf8");
}

function sanitizeArchiveName(name: string): string {
  const sanitized = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 ? "_" : character,
  )
    .join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim();
  return sanitized.slice(0, 100) || "asset";
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        sorted[key] = sortKeysDeep(value[key]);
      }
    }
    return sorted;
  }
  return value;
}

function parseFrontmatter(content, fileName) {
  const normalized = content.replace(/\r\n/g, "\n");
  assert(normalized.startsWith("---\n"), `Missing frontmatter in ${fileName}`);
  const end = normalized.indexOf("\n---\n", 4);
  assert(end !== -1, `Unclosed frontmatter in ${fileName}`);
  const metadata: Record<string, string | boolean> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const separator = line.indexOf(":");
    assert(separator !== -1, `Invalid frontmatter line in ${fileName}: ${line}`);
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    assert(key !== "", `Empty frontmatter key in ${fileName}`);
    if (rawValue === "true") {
      metadata[key] = true;
    } else if (rawValue === "false") {
      metadata[key] = false;
    } else {
      metadata[key] = rawValue;
    }
  }
  return {
    body: normalized.slice(end + 5),
    metadata,
  };
}

function parseRegexBody(content, fileName) {
  const normalized = content.replace(/^\n+/, "").replace(/\n$/, "");
  const match = normalized.match(/^IN:\s*\n([\s\S]*?)\nOUT:\s*(?:\n([\s\S]*))?$/);
  assert(match, `Invalid regex body in ${fileName}`);
  return {
    in: match[1],
    out: match[2] ?? "",
  };
}

function parseRegexDocument(content, fileName) {
  const { body, metadata } = parseFrontmatter(content, fileName);
  const parsed = parseRegexBody(body, fileName);
  return {
    ableFlag: metadata.ableFlag ?? true,
    comment: metadata.comment ?? "",
    flag: metadata.flag,
    in: parsed.in,
    out: parsed.out,
    type: metadata.type ?? "editdisplay",
  };
}

function buildRegexScripts(manifestDirectory, regexGroups: any[] = []) {
  const scripts: any[] = [];
  for (const group of regexGroups) {
    if (typeof group === "string") {
      scripts.push(
        parseRegexDocument(readSource(manifestDirectory, group, `regex ${group}`), group),
      );
      continue;
    }
    if (group.in !== undefined || group.out !== undefined) {
      assert(
        typeof group.in === "string" && typeof group.out === "string",
        "Inline regex entries require in and out",
      );
      scripts.push({
        ableFlag: group.ableFlag ?? true,
        comment: group.comment ?? "",
        flag: group.flag,
        in: group.in,
        out: group.out,
        type: group.type ?? "editdisplay",
      });
      continue;
    }

    assert(
      typeof group.file === "string",
      "Regex entries require a file path, or inline in and out fields",
    );
    scripts.push(
      parseRegexDocument(
        readSource(manifestDirectory, group.file, `regex ${group.file}`),
        group.file,
      ),
    );
  }
  return scripts;
}

function buildLorebook(manifest, manifestDirectory) {
  const folderKeys = new Map<string, string>();
  const folderNames = new Set<string>(manifest.folders ?? []);
  for (const entry of manifest.lorebook ?? []) {
    if (entry.folder) {
      folderNames.add(entry.folder);
    }
  }
  for (const name of folderNames) {
    folderKeys.set(
      name,
      `\uf000folder:${createUUID(`${manifest.namespace ?? manifest.name}:folder:${name}`)}`,
    );
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "risums-charx-lorebook-"));
  try {
    const lorebook = (manifest.lorebook ?? []).map((entry, index) => {
      let content;
      if (entry.bundle) {
        assert(
          typeof entry.file === "string",
          `Bundled lorebook ${entry.comment ?? index + 1} requires a file`,
        );
        const entryPath = path.resolve(manifestDirectory, entry.file);
        const outputPath = entry.bundleOutput
          ? path.resolve(manifestDirectory, entry.bundleOutput)
          : path.join(temporaryDirectory, `lorebook-${index}.lua`);
        content = readBundledLua(entryPath, outputPath);
      } else {
        content = readSource(
          manifestDirectory,
          entry,
          `lorebook ${entry.comment ?? entry.file ?? ""}`,
        );
      }
      return {
        activationPercent: entry.activationPercent,
        alwaysActive: entry.alwaysActive ?? false,
        bookVersion: entry.bookVersion ?? 2,
        comment: entry.comment ?? path.basename(entry.file ?? "Lorebook"),
        content,
        extentions: entry.extentions,
        folder: entry.folder ? folderKeys.get(entry.folder) : undefined,
        insertorder: entry.insertOrder ?? 100,
        key: entry.key ?? "",
        mode: entry.mode ?? "normal",
        secondkey: entry.secondaryKey ?? "",
        selective: entry.selective ?? false,
        useRegex: entry.useRegex ?? false,
      };
    });

    for (const name of folderNames) {
      lorebook.push({
        alwaysActive: false,
        bookVersion: 2,
        comment: name,
        content: "",
        insertorder: 100,
        key: folderKeys.get(name),
        mode: "folder",
        secondkey: "",
        selective: false,
        useRegex: false,
      });
    }
    return lorebook;
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function readBundledLua(entryPath: string, outputPath: string): string {
  bundleLua(entryPath, outputPath);
  return fs.readFileSync(outputPath, "utf8");
}

function buildTriggers(manifest, manifestDirectory) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "risums-charx-"));
  try {
    return (manifest.triggers ?? []).map((trigger, index) => {
      let effect = trigger.effect;
      if (trigger.lua) {
        const entryPath = path.resolve(manifestDirectory, trigger.lua);
        let code;
        if (trigger.bundle ?? true) {
          const outputPath = trigger.bundleOutput
            ? path.resolve(manifestDirectory, trigger.bundleOutput)
            : path.join(temporaryDirectory, `trigger-${index}.lua`);
          code = readBundledLua(entryPath, outputPath);
        } else {
          code = fs.readFileSync(entryPath, "utf8");
        }
        effect = [{ code, type: "triggerlua" }];
      }
      assert(Array.isArray(effect), `Trigger ${index + 1} requires lua or effect`);
      return {
        comment: trigger.comment ?? "",
        conditions: trigger.conditions ?? [],
        effect,
        lowLevelAccess: trigger.lowLevelAccess,
        type: trigger.type ?? "start",
      };
    });
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function createRisuM(module, encodeMap) {
  const payload = Buffer.from(
    JSON.stringify(sortKeysDeep({ module, type: "risuModule" }), null, 2),
    "utf8",
  );
  const encoded = Buffer.allocUnsafe(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    encoded[index] = encodeMap[payload[index]];
  }
  const header = Buffer.alloc(6);
  header.writeUInt8(111, 0);
  header.writeUInt8(0, 1);
  header.writeUInt32LE(encoded.length, 2);
  return Buffer.concat([header, encoded, Buffer.from([0])]);
}

function createAssetFiles(manifest, manifestDirectory) {
  const cardAssets: any[] = [];
  const files: Array<{ data: Buffer; name: string }> = [];
  const takenNames = new Set<string>();

  function addAsset({ data, extension, name, type }) {
    const category = getAssetCategory(extension);
    const baseDirectory = `assets/${type === "icon" ? "icon" : "other"}/${category}`;
    const baseName = sanitizeArchiveName(name);
    let archiveName = baseName;
    let suffix = 0;
    while (takenNames.has(archiveName)) {
      suffix += 1;
      archiveName = `${baseName}_${suffix}`;
    }
    const archivePath = `${baseDirectory}/${archiveName}.${extension}`;
    takenNames.add(archiveName);
    cardAssets.push({
      ext: extension,
      name,
      type,
      uri: `embeded://${archivePath}`,
    });
    files.push({ data, name: archivePath });
    files.push({
      data: Buffer.from(JSON.stringify({ type: detectImageType(data) }, null, 2)),
      name: `x_meta/${archiveName}.json`,
    });
  }

  if (manifest.icon) {
    const iconPath = path.resolve(manifestDirectory, manifest.icon);
    const extension = path.extname(iconPath).slice(1).toLowerCase() || "png";
    addAsset({ data: fs.readFileSync(iconPath), extension, name: "main", type: "icon" });
  } else {
    addAsset({ data: DEFAULT_ICON, extension: "png", name: "main", type: "icon" });
  }

  for (const asset of manifest.assets ?? []) {
    assert(typeof asset.file === "string", "Asset file must be a string");
    const assetPath = path.resolve(manifestDirectory, asset.file);
    const extension = (asset.extension ?? path.extname(assetPath).slice(1)).toLowerCase();
    assert(extension !== "", `Cannot determine extension for ${asset.file}`);
    assert(/^[a-z0-9]+$/.test(extension), `Invalid extension for ${asset.file}: ${extension}`);
    addAsset({
      data: fs.readFileSync(assetPath),
      extension,
      name: asset.name ?? path.basename(assetPath, path.extname(assetPath)),
      type: "x-risu-asset",
    });
  }
  return { cardAssets, files };
}

function createCard(manifest, lorebook, cardAssets, sourceCard?: Record<string, any>) {
  const sourceData = sourceCard?.data ?? {};
  const sourceExtensions = sourceData.extensions ?? {};
  const sourceRisuAI = sourceExtensions.risuai ?? {};
  const entries = lorebook.map((entry) => ({
    case_sensitive: entry.extentions?.risu_case_sensitive ?? false,
    comment: entry.comment,
    constant: entry.alwaysActive,
    content: entry.content,
    enabled: true,
    extensions: {
      ...entry.extentions,
      risu_activationPercent: entry.activationPercent,
      risu_loreCache: entry.loreCache,
    },
    folder: entry.folder,
    insertion_order: entry.insertorder,
    keys: entry.key.split(",").map((key) => key.trim()),
    mode: entry.mode,
    name: entry.comment,
    secondary_keys: entry.selective
      ? entry.secondkey.split(",").map((key) => key.trim())
      : undefined,
    selective: entry.selective,
    use_regex: entry.useRegex,
  }));
  return {
    ...sourceCard,
    data: {
      ...sourceData,
      alternate_greetings: sourceData.alternate_greetings ?? [],
      assets: cardAssets,
      character_book: {
        entries,
        extensions: { risu_fullWordMatching: false },
      },
      character_version: manifest.version ?? sourceData.character_version ?? "",
      creation_date: sourceData.creation_date ?? 0,
      creator: manifest.creator ?? sourceData.creator ?? "",
      creator_notes: manifest.description ?? sourceData.creator_notes ?? "",
      description: sourceData.description ?? "",
      extensions: {
        ...sourceExtensions,
        moduleNoneImage: manifest.icon ? undefined : true,
        risuai: {
          ...sourceRisuAI,
          additionalText: sourceRisuAI.additionalText ?? "",
          backgroundHTML: manifest.CSS
            ? readSource(path.dirname(manifest.__path), manifest.CSS, "CSS")
            : "",
          bias: sourceRisuAI.bias ?? [],
          defaultVariables: sourceRisuAI.defaultVariables ?? "",
          hideChatIcon: manifest.hideIcon ?? false,
          inlayViewScreen: sourceRisuAI.inlayViewScreen ?? false,
          largePortrait: sourceRisuAI.largePortrait ?? false,
          license: manifest.license ?? "",
          lorePlus: sourceRisuAI.lorePlus ?? false,
          lowLevelAccess: manifest.lowLevelAccess ?? false,
          moduleNamespace: manifest.namespace,
          newGenData: sourceRisuAI.newGenData,
          prebuiltAssetCommand: sourceRisuAI.prebuiltAssetCommand ?? "",
          prebuiltAssetExclude: sourceRisuAI.prebuiltAssetExclude ?? [],
          prebuiltAssetStyle: sourceRisuAI.prebuiltAssetStyle ?? "",
          sdData: sourceRisuAI.sdData ?? [],
          toggles: manifest.toggles
            ? readSource(path.dirname(manifest.__path), manifest.toggles, "toggles")
            : "",
          utilityBot: sourceRisuAI.utilityBot ?? false,
          viewScreen: "none",
          virtualscript: sourceRisuAI.virtualscript ?? "",
          vits: sourceRisuAI.vits ?? {},
        },
      },
      first_mes: sourceData.first_mes ?? "",
      group_only_greetings: sourceData.group_only_greetings ?? [],
      mes_example: sourceData.mes_example ?? "",
      modification_date: process.env.SOURCE_DATE_EPOCH
        ? Number(process.env.SOURCE_DATE_EPOCH)
        : Math.floor(Date.now() / 1000),
      name: manifest.name,
      nickname: sourceData.nickname ?? "",
      personality: sourceData.personality ?? "",
      post_history_instructions: sourceData.post_history_instructions ?? "",
      scenario: sourceData.scenario ?? "",
      source: sourceData.source ?? [],
      system_prompt: sourceData.system_prompt ?? "",
      tags: manifest.tags ?? sourceData.tags ?? [],
    },
    spec: sourceCard?.spec ?? "chara_card_v3",
    spec_version: sourceCard?.spec_version ?? "3.0",
  };
}

function getDOSDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
  };
}

function createZIP(files, timestamp) {
  assert(files.length <= 0xffff, "ZIP contains too many files");
  const centralRecords: Buffer[] = [];
  const localRecords: Buffer[] = [];
  let offset = 0;
  const { date, time } = getDOSDateTime(timestamp);

  for (const file of files) {
    const data = Buffer.from(file.data);
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    const fileName = Buffer.from(file.name.replace(/\\/g, "/"), "utf8");
    const CRC32 = calculateCRC32(data);
    assert(
      data.length <= 0xffffffff && compressed.length <= 0xffffffff,
      `${file.name} exceeds ZIP32 limits`,
    );

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(CRC32, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localRecords.push(localHeader, fileName, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(CRC32, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralRecords.push(centralHeader, fileName);
    offset += localHeader.length + fileName.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

function buildCharX(manifestPath: string, outputArgument?: string): string {
  const resolvedManifestPath = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(resolvedManifestPath);
  const manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, "utf8"));
  manifest.__path = resolvedManifestPath;
  assert(typeof manifest.name === "string" && manifest.name !== "", "Manifest name is required");

  const lorebook = buildLorebook(manifest, manifestDirectory);
  const regex = buildRegexScripts(manifestDirectory, manifest.regex);
  const trigger = buildTriggers(manifest, manifestDirectory);
  const { cardAssets, files: assetFiles } = createAssetFiles(manifest, manifestDirectory);
  const sourceCard = manifest.card
    ? JSON.parse(readSource(manifestDirectory, manifest.card, "card"))
    : undefined;
  const card = createCard(manifest, lorebook, cardAssets, sourceCard);
  const module = {
    description: `Module for ${manifest.name}`,
    id: createUUID(`${manifest.namespace ?? manifest.name}:module`),
    lorebook,
    name: `${manifest.name} Module`,
    regex,
    trigger,
  };

  const map = fs.readFileSync(RPACK_MAP_PATH);
  assert(map.length >= 256, `Invalid RPack map: ${RPACK_MAP_PATH}`);
  const files = [
    ...assetFiles,
    { data: Buffer.from(JSON.stringify(sortKeysDeep(card), null, 2)), name: "card.json" },
    { data: createRisuM(sortKeysDeep(module), map.subarray(0, 256)), name: "module.risum" },
  ].sort((left, right) => left.name.localeCompare(right.name));

  const outputPath = outputArgument
    ? path.resolve(outputArgument)
    : path.resolve(
        manifestDirectory,
        manifest.output ?? `../dist/${sanitizeArchiveName(manifest.name)}.charx`,
      );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const timestamp = process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000)
    : new Date();
  fs.writeFileSync(outputPath, createZIP(files, timestamp));
  console.log(`Built ${path.relative(process.cwd(), outputPath)} (${files.length} files)`);
  return outputPath;
}

export { buildCharX };
