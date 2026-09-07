import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

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

function decodeModule(data: Buffer, map: Buffer): Record<string, any> {
  assert(data.length >= 7, "module.risum is truncated");
  assert(data.readUInt8(0) === 111, "Invalid module.risum magic number");
  assert(data.readUInt8(1) === 0, `Unsupported module.risum version: ${data.readUInt8(1)}`);

  const encodedLength = data.readUInt32LE(2);
  assert(encodedLength <= data.length - 6, "module.risum payload is truncated");
  assert(map.length >= 256, `Invalid RPack map: ${RPACK_MAP_PATH}`);

  let decodeMap;
  if (map.length >= 512) {
    decodeMap = map.subarray(256, 512);
  } else {
    decodeMap = Buffer.alloc(256);
    const seen = new Set();
    for (let index = 0; index < 256; index += 1) {
      const encoded = map[index];
      assert(!seen.has(encoded), "RPack encode map is not a permutation");
      seen.add(encoded);
      decodeMap[encoded] = index;
    }
  }

  const encoded = data.subarray(6, 6 + encodedLength);
  const decoded = Buffer.allocUnsafe(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) {
    decoded[index] = decodeMap[encoded[index]];
  }

  const parsed = JSON.parse(decoded.toString("utf8"));
  assert(
    parsed && parsed.type === "risuModule" && parsed.module,
    "module.risum does not contain a Risu module",
  );
  return parsed;
}

function findEndOfCentralDirectory(archive) {
  const minimumOffset = Math.max(0, archive.length - 0xffff - 22);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = archive.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === archive.length) {
        return offset;
      }
    }
  }
  throw new Error("ZIP end record not found");
}

function normalizeEntryName(name) {
  assert(name !== "", "ZIP entry has an empty name");
  assert(!name.includes("\0"), `ZIP entry contains a null byte: ${JSON.stringify(name)}`);

  const normalized = name.replace(/\\/g, "/");
  assert(!normalized.startsWith("/"), `ZIP entry uses an absolute path: ${name}`);
  assert(!/^[a-zA-Z]:/.test(normalized), `ZIP entry uses an absolute path: ${name}`);

  const parts = normalized.split("/");
  assert(!parts.includes(".."), `ZIP entry escapes the output directory: ${name}`);
  return parts.filter((part) => part !== "" && part !== ".").join("/");
}

function sanitizeSourceName(name: string, fallback: string): string {
  const sanitized = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 ? "_" : character,
  )
    .join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return sanitized || fallback;
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

function takeSourcePath(directory, label, extension, takenPaths) {
  const baseName = sanitizeSourceName(label, "untitled");
  const suffix = baseName.toLowerCase().endsWith(extension) ? "" : extension;
  let candidate = `${directory}/${baseName}${suffix}`;
  let collision = 1;
  while (takenPaths.has(candidate)) {
    collision += 1;
    candidate = `${directory}/${baseName}_${collision}${suffix}`;
  }
  takenPaths.add(candidate);
  return candidate;
}

function createRegexDocument(regex) {
  const frontmatter = [`comment: ${regex.comment ?? ""}`];
  if (regex.flag !== undefined) {
    frontmatter.push(`flag: ${regex.flag}`);
  }
  frontmatter.push(`type: ${regex.type ?? "editdisplay"}`);
  return `---\n${frontmatter.join("\n")}\n---\n\nIN:\n${regex.in ?? ""}\nOUT:\n${regex.out ?? ""}\n`;
}

function createCardSources(card, files) {
  const sourceCard = JSON.parse(JSON.stringify(card));
  const data = sourceCard.data ?? {};
  const risuai = data.extensions?.risuai;

  const alternateGreetings = data.alternate_greetings ?? [];
  assert(Array.isArray(alternateGreetings), "card.data.alternate_greetings must be an array");
  for (let index = 0; index < alternateGreetings.length; index += 1) {
    const greeting = alternateGreetings[index];
    assert(
      typeof greeting === "string",
      `card.data.alternate_greetings[${index}] must be a string`,
    );
  }

  const defaultVariables = risuai?.defaultVariables ?? "";
  const description = data.description ?? "";
  const firstMessage = data.first_mes ?? "";
  const globalNoteOverride = data.post_history_instructions ?? "";
  assert(typeof defaultVariables === "string", "card default variables must be a string");
  assert(typeof description === "string", "card.data.description must be a string");
  assert(typeof firstMessage === "string", "card.data.first_mes must be a string");
  assert(typeof globalNoteOverride === "string", "card global note override must be a string");

  delete data.alternate_greetings;
  delete data.assets;
  delete data.character_book;
  delete data.character_version;
  delete data.creator;
  delete data.creator_notes;
  delete data.description;
  delete data.first_mes;
  delete data.modification_date;
  delete data.name;
  delete data.post_history_instructions;
  delete data.tags;

  if (risuai) {
    delete risuai.backgroundHTML;
    delete risuai.defaultVariables;
    delete risuai.hideChatIcon;
    delete risuai.license;
    delete risuai.lowLevelAccess;
    delete risuai.moduleNamespace;
    delete risuai.toggles;
    const defaults = {
      additionalText: "",
      bias: [],
      inlayViewScreen: false,
      largePortrait: false,
      lorePlus: false,
      prebuiltAssetCommand: "",
      prebuiltAssetExclude: [],
      prebuiltAssetStyle: "",
      sdData: [],
      utilityBot: false,
      viewScreen: "none",
      virtualscript: "",
      vits: {},
    };
    for (const [key, value] of Object.entries(defaults)) {
      if (JSON.stringify(sortKeysDeep(risuai[key])) === JSON.stringify(sortKeysDeep(value))) {
        delete risuai[key];
      }
    }
    if (Object.keys(risuai).length === 0) {
      delete data.extensions.risuai;
    }
  }
  if (data.extensions) {
    delete data.extensions.moduleNoneImage;
    if (Object.keys(data.extensions).length === 0) {
      delete data.extensions;
    }
  }

  const dataDefaults = {
    creation_date: 0,
    group_only_greetings: [],
    mes_example: "",
    nickname: "",
    personality: "",
    scenario: "",
    source: [],
    system_prompt: "",
  };
  for (const [key, value] of Object.entries(dataDefaults)) {
    if (JSON.stringify(sortKeysDeep(data[key])) === JSON.stringify(sortKeysDeep(value))) {
      delete data[key];
    }
  }

  if (Object.keys(data).length === 0) {
    delete sourceCard.data;
  } else {
    sourceCard.data = data;
  }
  if (sourceCard.spec === "chara_card_v3") {
    delete sourceCard.spec;
  }
  if (sourceCard.spec_version === "3.0") {
    delete sourceCard.spec_version;
  }

  const baseCardRequired = Object.keys(sourceCard).length > 0;
  const cardRequired =
    alternateGreetings.length > 0 ||
    defaultVariables !== "" ||
    description !== "" ||
    firstMessage !== "" ||
    globalNoteOverride !== "" ||
    baseCardRequired;
  if (!cardRequired) {
    return undefined;
  }

  const alternateGreetingFiles = alternateGreetings.map((greeting, index) => {
    const file = `alternate_greetings/${index + 1}.md`;
    files.set(file, Buffer.from(greeting, "utf8"));
    return file;
  });
  files.set("description.md", Buffer.from(description, "utf8"));
  files.set("first_mes.md", Buffer.from(firstMessage, "utf8"));
  const cardSources: Record<string, any> = {
    alternate_greetings: alternateGreetingFiles,
    description: "description.md",
    first_mes: "first_mes.md",
  };
  if (defaultVariables !== "") {
    cardSources.defaultVariables = defaultVariables.split("\n");
  }
  if (baseCardRequired) {
    cardSources.file = "card.json";
    files.set(
      cardSources.file,
      Buffer.from(`${JSON.stringify(sortKeysDeep(sourceCard), null, 2)}\n`, "utf8"),
    );
  }
  if (globalNoteOverride !== "") {
    cardSources.globalNoteOverride = "global_note_override.md";
    files.set(cardSources.globalNoteOverride, Buffer.from(globalNoteOverride, "utf8"));
  }
  return cardSources;
}

function createExpandedModuleSources(
  card: Record<string, any>,
  decodedModule: Record<string, any>,
): Map<string, Buffer> {
  const moduleData = decodedModule.module;
  const files = new Map<string, Buffer>();
  const folderNames = new Map<any, any>();
  const folders: any[] = [];
  const takenPaths = new Set<string>();

  for (const entry of moduleData.lorebook ?? []) {
    if (entry.mode !== "folder") {
      continue;
    }
    folderNames.set(entry.key, entry.comment);
    folders.push(entry.comment);
  }

  const lorebook: any[] = [];
  for (const entry of moduleData.lorebook ?? []) {
    if (entry.mode === "folder") {
      continue;
    }
    const file = takeSourcePath("lorebooks", entry.comment, ".md", takenPaths);
    files.set(file, Buffer.from(entry.content ?? "", "utf8"));
    lorebook.push({
      activationPercent: entry.activationPercent,
      alwaysActive: entry.alwaysActive ?? false,
      bookVersion: entry.bookVersion ?? 2,
      comment: entry.comment ?? "",
      extentions: entry.extentions,
      file,
      folder: folderNames.get(entry.folder),
      insertOrder: entry.insertorder ?? 100,
      key: entry.key ?? "",
      mode: entry.mode ?? "normal",
      secondaryKey: entry.secondkey ?? "",
      selective: entry.selective ?? false,
      useRegex: entry.useRegex ?? false,
    });
  }

  const regex: string[] = [];
  for (const entry of moduleData.regex ?? []) {
    const file = takeSourcePath("regex", entry.comment, ".md", takenPaths);
    files.set(file, Buffer.from(createRegexDocument(entry), "utf8"));
    regex.push(file);
  }

  const triggers: any[] = [];
  for (let index = 0; index < (moduleData.trigger ?? []).length; index += 1) {
    const trigger = moduleData.trigger[index];
    const luaEffect =
      trigger.effect?.length === 1 && trigger.effect[0].type === "triggerlua"
        ? trigger.effect[0]
        : undefined;
    if (!luaEffect || typeof luaEffect.code !== "string") {
      triggers.push(trigger);
      continue;
    }

    const label = trigger.comment || `trigger-${index + 1}`;
    const luaPath = takeSourcePath("triggers", label, ".lua", takenPaths);
    files.set(luaPath, Buffer.from(luaEffect.code, "utf8"));
    triggers.push({
      bundle: false,
      comment: trigger.comment ?? "",
      conditions: trigger.conditions ?? [],
      lowLevelAccess: trigger.lowLevelAccess,
      lua: luaPath,
      type: trigger.type ?? "start",
    });
  }

  const risuai = card.data?.extensions?.risuai ?? {};
  const manifest: Record<string, any> = {
    card: createCardSources(card, files),
    creator: card.data?.creator,
    description: card.data?.creator_notes ?? moduleData.description ?? "",
    folders,
    hideIcon: risuai.hideChatIcon ?? moduleData.hideIcon ?? false,
    lorebook,
    lowLevelAccess: risuai.lowLevelAccess ?? moduleData.lowLevelAccess ?? false,
    name: card.data?.name ?? moduleData.name,
    namespace: risuai.moduleNamespace ?? moduleData.namespace,
    regex,
    tags: card.data?.tags,
    triggers,
    version: card.data?.character_version ?? "",
  };

  const CSS = risuai.backgroundHTML ?? moduleData.backgroundEmbedding;
  if (CSS) {
    manifest.CSS = "style.html";
    files.set("style.html", Buffer.from(CSS, "utf8"));
  }
  const toggles = risuai.toggles ?? moduleData.customModuleToggle;
  const emptyLegacyToggles =
    toggles &&
    typeof toggles === "object" &&
    !Array.isArray(toggles) &&
    Object.keys(toggles).length === 0;
  assert(
    toggles === undefined || typeof toggles === "string" || emptyLegacyToggles,
    "card toggles must be a string or an empty object",
  );
  if (typeof toggles === "string" && toggles !== "") {
    manifest.toggles = "toggles.txt";
    files.set("toggles.txt", Buffer.from(toggles, "utf8"));
  }

  const mainIcon = card.data?.assets?.find(
    (asset) => asset.type === "icon" && asset.name === "main",
  );
  if (mainIcon?.uri?.startsWith("embeded://")) {
    manifest.icon = mainIcon.uri.slice("embeded://".length);
  }

  const assets: any[] = [];
  for (const asset of card.data?.assets ?? []) {
    if (asset === mainIcon || !asset.uri?.startsWith("embeded://")) {
      continue;
    }
    assets.push({
      extension: asset.ext,
      file: asset.uri.slice("embeded://".length),
      name: asset.name,
    });
  }
  if (assets.length > 0) {
    manifest.assets = assets;
  }

  files.set(
    "charx.json",
    Buffer.from(`${JSON.stringify(sortKeysDeep(manifest), null, 2)}\n`, "utf8"),
  );
  return files;
}

function parseZIP(archive: Buffer) {
  const endOffset = findEndOfCentralDirectory(archive);
  const diskNumber = archive.readUInt16LE(endOffset + 4);
  const centralDisk = archive.readUInt16LE(endOffset + 6);
  const diskEntries = archive.readUInt16LE(endOffset + 8);
  const totalEntries = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);

  assert(diskNumber === 0 && centralDisk === 0, "Multi-disk ZIP archives are not supported");
  assert(diskEntries === totalEntries, "Inconsistent ZIP entry count");
  assert(
    totalEntries !== 0xffff && centralSize !== 0xffffffff && centralOffset !== 0xffffffff,
    "ZIP64 is not supported",
  );

  const zipOffset = endOffset - centralSize - centralOffset;
  assert(zipOffset >= 0, "Invalid ZIP central directory offset");

  const entries: any[] = [];
  const names = new Set();
  let offset = zipOffset + centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    assert(offset + 46 <= archive.length, "ZIP central directory is truncated");
    assert(
      archive.readUInt32LE(offset) === 0x02014b50,
      `Invalid ZIP central record at byte ${offset}`,
    );

    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const expectedCRC32 = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const diskStart = archive.readUInt16LE(offset + 34);
    const localOffset = archive.readUInt32LE(offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;

    assert(offset + recordLength <= archive.length, "ZIP central record is truncated");
    assert((flags & 1) === 0, "Encrypted ZIP entries are not supported");
    assert(method === 0 || method === 8, `Unsupported ZIP compression method: ${method}`);
    assert(diskStart === 0, "Multi-disk ZIP entries are not supported");
    assert(
      compressedSize !== 0xffffffff &&
        uncompressedSize !== 0xffffffff &&
        localOffset !== 0xffffffff,
      "ZIP64 entries are not supported",
    );

    const rawName = archive.subarray(offset + 46, offset + 46 + nameLength);
    const decodedName = rawName.toString("utf8");
    const directory = decodedName.endsWith("/") || decodedName.endsWith("\\");
    const name = normalizeEntryName(decodedName);
    assert(name !== "", "ZIP entry resolves to an empty path");
    assert(!names.has(name), `Duplicate ZIP entry: ${name}`);
    names.add(name);

    entries.push({
      compressedSize,
      directory,
      expectedCRC32,
      localOffset: zipOffset + localOffset,
      method,
      name,
      uncompressedSize,
    });
    offset += recordLength;
  }

  assert(offset === endOffset, "ZIP central directory size does not match its records");
  return entries;
}

function readEntry(archive, entry) {
  const offset = entry.localOffset;
  assert(offset + 30 <= archive.length, `ZIP local record is truncated: ${entry.name}`);
  assert(archive.readUInt32LE(offset) === 0x04034b50, `Invalid ZIP local record: ${entry.name}`);

  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  assert(dataEnd <= archive.length, `ZIP entry data is truncated: ${entry.name}`);

  const compressed = archive.subarray(dataOffset, dataEnd);
  const data = entry.method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed);
  assert(data.length === entry.uncompressedSize, `ZIP entry size mismatch: ${entry.name}`);
  assert(
    calculateCRC32(data) === entry.expectedCRC32,
    `ZIP entry checksum mismatch: ${entry.name}`,
  );
  assert(!entry.directory || data.length === 0, `ZIP directory entry contains data: ${entry.name}`);
  return data;
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

function unpackCharX(inputPath: string, outputPath: string): string {
  const resolvedInputPath = path.resolve(inputPath);
  const resolvedOutputPath = path.resolve(outputPath);
  const archive = fs.readFileSync(resolvedInputPath);
  const entries = parseZIP(archive);
  const extracted = new Map<string, { data: Buffer; directory: boolean }>();

  for (const entry of entries) {
    extracted.set(entry.name, {
      data: readEntry(archive, entry),
      directory: entry.directory,
    });
  }

  const cardEntry = extracted.get("card.json");
  assert(cardEntry, "CharX archive does not contain card.json");
  assert(!cardEntry.directory, "card.json is a directory");
  const card = JSON.parse(cardEntry.data.toString("utf8"));

  let decodedModule;
  if (extracted.has("module.risum")) {
    const moduleEntry = extracted.get("module.risum");
    assert(moduleEntry, "CharX archive does not contain module.risum");
    assert(!moduleEntry.directory, "module.risum is a directory");
    const map = fs.readFileSync(RPACK_MAP_PATH);
    decodedModule = decodeModule(moduleEntry.data, map);
  }

  const expandedSources = decodedModule
    ? createExpandedModuleSources(card, decodedModule)
    : new Map();
  for (const name of expandedSources.keys()) {
    assert(
      name === "card.json" || !extracted.has(name),
      `Generated module source conflicts with an archive entry: ${name}`,
    );
  }

  assertEmptyOutputDirectory(resolvedOutputPath);
  fs.mkdirSync(resolvedOutputPath, { recursive: true });

  for (const [name, entry] of extracted) {
    if (
      name === "module.risum" ||
      (decodedModule && name === "card.json") ||
      expandedSources.has(name)
    ) {
      continue;
    }
    const destination = path.join(resolvedOutputPath, ...name.split("/"));
    if (entry.directory) {
      fs.mkdirSync(destination, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.data);
  }

  for (const [name, data] of expandedSources) {
    const destination = path.join(resolvedOutputPath, ...name.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data);
  }

  const relativeOutput = path.relative(process.cwd(), resolvedOutputPath) || ".";
  console.log(
    `Unpacked ${entries.length - (decodedModule ? 1 : 0)} archive files to ${relativeOutput}`,
  );
  return resolvedOutputPath;
}

export { createExpandedModuleSources, decodeModule, parseZIP, unpackCharX };
