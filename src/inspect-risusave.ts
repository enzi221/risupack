import zlib from "node:zlib";

const MAGIC = Buffer.from("RISUSAVE\0");
const MODULE_BLOCK_TYPE = 5;

interface ModuleRecord {
  id?: unknown;
  name?: unknown;
  namespace?: unknown;
  [key: string]: unknown;
}

function parseModuleBlock(database: Buffer): ModuleRecord[] {
  if (!database.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Invalid RISUSAVE header");
  }

  let offset = MAGIC.length;
  while (offset < database.length) {
    if (offset + 3 > database.length) {
      throw new Error(`Truncated block header at byte ${offset}`);
    }
    const type = database[offset];
    const compressed = database[offset + 1] === 1;
    const nameLength = database[offset + 2];
    offset += 3;

    if (offset + nameLength + 4 > database.length) {
      throw new Error(`Truncated block name at byte ${offset}`);
    }
    const name = database.subarray(offset, offset + nameLength).toString("utf8");
    offset += nameLength;
    const contentLength = database.readUInt32LE(offset);
    offset += 4;

    if (offset + contentLength > database.length) {
      throw new Error(`Truncated ${name} block at byte ${offset}`);
    }
    let content = database.subarray(offset, offset + contentLength);
    offset += contentLength;

    if (type !== MODULE_BLOCK_TYPE) {
      continue;
    }
    if (compressed) {
      content = zlib.gunzipSync(content);
    }
    return JSON.parse(content.toString("utf8")) as ModuleRecord[];
  }
  throw new Error("RISUSAVE module block not found");
}

export { parseModuleBlock };
