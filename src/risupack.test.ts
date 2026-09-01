import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { buildCharX } from "./build-charx.js";
import { unpackCharX } from "./unpack-charx.js";

const temporaryRoots = new Set<string>();

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "risupack-test-"));
  temporaryRoots.add(root);

  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.mkdirSync(path.join(root, "lorebooks"), { recursive: true });
  fs.mkdirSync(path.join(root, "regex"), { recursive: true });
  fs.mkdirSync(path.join(root, "triggers"), { recursive: true });

  const asset = Buffer.from([0, 1, 2, 3]);
  const alternateGreeting = "Alternate greeting\n";
  const CSS = "<style>\n.fixture { color: red; }\n</style>\n";
  const description = "Fixture character description\n";
  const firstMessage = "Fixture first message\n";
  const lorebook = "Fixture lore\n";
  const regex = [
    "---",
    "comment: Display",
    "flag: g",
    "type: editdisplay",
    "---",
    "",
    "IN:",
    "foo",
    "OUT:",
    "bar",
    "",
  ].join("\n");
  const trigger = "return nil\n";

  fs.writeFileSync(path.join(root, "assets/sample.bin"), asset);
  fs.writeFileSync(path.join(root, "alternate.md"), alternateGreeting);
  fs.writeFileSync(
    path.join(root, "card.json"),
    `${JSON.stringify(
      {
        data: {
          extensions: {
            risuai: {
              utilityBot: true,
            },
          },
          nickname: "Fixture nickname",
        },
        spec: "chara_card_v3",
        spec_version: "3.0",
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(path.join(root, "description.md"), description);
  fs.writeFileSync(path.join(root, "first_mes.md"), firstMessage);
  fs.writeFileSync(path.join(root, "lorebooks/sample.md"), lorebook);
  fs.writeFileSync(path.join(root, "regex/display.md"), regex);
  fs.writeFileSync(path.join(root, "style.html"), CSS);
  fs.writeFileSync(path.join(root, "triggers/start.lua"), trigger);
  fs.writeFileSync(
    path.join(root, "charx.json"),
    `${JSON.stringify(
      {
        CSS: "style.html",
        assets: [
          {
            extension: "bin",
            file: "assets/sample.bin",
            name: "sample",
          },
        ],
        card: {
          alternate_greetings: ["alternate.md"],
          description: "description.md",
          file: "card.json",
          first_mes: "first_mes.md",
        },
        description: "Fixture description",
        lorebook: [
          {
            alwaysActive: true,
            comment: "Sample",
            file: "lorebooks/sample.md",
            insertOrder: 200,
          },
        ],
        name: "Fixture",
        namespace: "test.fixture",
        regex: ["regex/display.md"],
        tags: ["test"],
        triggers: [
          {
            bundle: false,
            comment: "Start",
            lua: "triggers/start.lua",
            type: "start",
          },
        ],
        version: "1.0.0",
      },
      null,
      2,
    )}\n`,
  );

  return {
    alternateGreeting,
    asset,
    CSS,
    description,
    firstMessage,
    lorebook,
    manifestPath: path.join(root, "charx.json"),
    regex,
    root,
    trigger,
  };
}

function replaceArchiveNames(archive: Buffer, from: string, to: string) {
  const fromBuffer = Buffer.from(from);
  const toBuffer = Buffer.from(to);
  if (fromBuffer.length !== toBuffer.length) {
    throw new Error("Replacement ZIP entry names must have equal byte lengths");
  }

  const modified = Buffer.from(archive);
  let count = 0;
  let offset = modified.indexOf(fromBuffer);
  while (offset !== -1) {
    toBuffer.copy(modified, offset);
    count += 1;
    offset = modified.indexOf(fromBuffer, offset + toBuffer.length);
  }
  return { count, modified };
}

afterEach(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { force: true, recursive: true });
  }
  temporaryRoots.clear();
});

describe("risupack", () => {
  it("round-trips expanded CharX module sources", () => {
    const fixture = createFixture();
    const archivePath = path.join(fixture.root, "fixture.charx");
    const outputPath = path.join(fixture.root, "unpacked");

    buildCharX(fixture.manifestPath, archivePath);
    unpackCharX(archivePath, outputPath);

    const manifest = JSON.parse(fs.readFileSync(path.join(outputPath, "charx.json"), "utf8"));
    expect(manifest).toMatchObject({
      CSS: "style.html",
      card: {
        alternate_greetings: ["alternate_greetings/1.md"],
        description: "description.md",
        file: "card.json",
        first_mes: "first_mes.md",
      },
      name: "Fixture",
      namespace: "test.fixture",
      version: "1.0.0",
    });
    expect(fs.readFileSync(path.join(outputPath, manifest.lorebook[0].file), "utf8")).toBe(
      fixture.lorebook,
    );
    expect(fs.readFileSync(path.join(outputPath, manifest.regex[0]), "utf8")).toBe(fixture.regex);
    expect(fs.readFileSync(path.join(outputPath, manifest.triggers[0].lua), "utf8")).toBe(
      fixture.trigger,
    );
    expect(fs.readFileSync(path.join(outputPath, manifest.assets[0].file))).toEqual(fixture.asset);
    expect(fs.readFileSync(path.join(outputPath, manifest.CSS), "utf8")).toBe(fixture.CSS);
    expect(
      fs.readFileSync(path.join(outputPath, manifest.card.alternate_greetings[0]), "utf8"),
    ).toBe(fixture.alternateGreeting);
    expect(fs.readFileSync(path.join(outputPath, manifest.card.description), "utf8")).toBe(
      fixture.description,
    );
    expect(fs.readFileSync(path.join(outputPath, manifest.card.first_mes), "utf8")).toBe(
      fixture.firstMessage,
    );
    const sourceCard = JSON.parse(fs.readFileSync(path.join(outputPath, "card.json"), "utf8"));
    expect(sourceCard.data).toEqual({
      extensions: {
        risuai: {
          utilityBot: true,
        },
      },
      nickname: "Fixture nickname",
    });
    expect(fs.existsSync(path.join(outputPath, "module.decoded.json"))).toBe(false);
    expect(fs.existsSync(path.join(outputPath, "module.json"))).toBe(false);
    expect(fs.existsSync(path.join(outputPath, "module.risum"))).toBe(false);

    const rebuiltArchivePath = path.join(fixture.root, "rebuilt.charx");
    const rebuiltOutputPath = path.join(fixture.root, "rebuilt-unpacked");
    buildCharX(path.join(outputPath, "charx.json"), rebuiltArchivePath);
    unpackCharX(rebuiltArchivePath, rebuiltOutputPath);
    const rebuiltManifest = JSON.parse(
      fs.readFileSync(path.join(rebuiltOutputPath, "charx.json"), "utf8"),
    );
    expect(
      fs.readFileSync(
        path.join(rebuiltOutputPath, rebuiltManifest.card.alternate_greetings[0]),
        "utf8",
      ),
    ).toBe(fixture.alternateGreeting);
    expect(
      fs.readFileSync(path.join(rebuiltOutputPath, rebuiltManifest.card.description), "utf8"),
    ).toBe(fixture.description);
    expect(
      fs.readFileSync(path.join(rebuiltOutputPath, rebuiltManifest.card.first_mes), "utf8"),
    ).toBe(fixture.firstMessage);
  });

  it("builds external card sources without a base card file", () => {
    const fixture = createFixture();
    const archivePath = path.join(fixture.root, "fileless-card.charx");
    const outputPath = path.join(fixture.root, "fileless-card-unpacked");
    const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8"));
    delete manifest.card.file;
    fs.rmSync(path.join(fixture.root, "card.json"));
    fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    buildCharX(fixture.manifestPath, archivePath);
    unpackCharX(archivePath, outputPath);

    const unpackedManifest = JSON.parse(
      fs.readFileSync(path.join(outputPath, "charx.json"), "utf8"),
    );
    expect(
      fs.readFileSync(path.join(outputPath, unpackedManifest.card.alternate_greetings[0]), "utf8"),
    ).toBe(fixture.alternateGreeting);
    expect(fs.readFileSync(path.join(outputPath, unpackedManifest.card.description), "utf8")).toBe(
      fixture.description,
    );
    expect(fs.readFileSync(path.join(outputPath, unpackedManifest.card.first_mes), "utf8")).toBe(
      fixture.firstMessage,
    );
  });

  it("does not create card sources for a cardless module", () => {
    const fixture = createFixture();
    const archivePath = path.join(fixture.root, "cardless.charx");
    const outputPath = path.join(fixture.root, "cardless-unpacked");
    const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8"));
    delete manifest.card;
    fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    buildCharX(fixture.manifestPath, archivePath);
    unpackCharX(archivePath, outputPath);

    const unpackedManifest = JSON.parse(
      fs.readFileSync(path.join(outputPath, "charx.json"), "utf8"),
    );
    expect(unpackedManifest.card).toBeUndefined();
    expect(fs.existsSync(path.join(outputPath, "alternate_greetings"))).toBe(false);
    expect(fs.existsSync(path.join(outputPath, "card.json"))).toBe(false);
    expect(fs.existsSync(path.join(outputPath, "description.md"))).toBe(false);
    expect(fs.existsSync(path.join(outputPath, "first_mes.md"))).toBe(false);
  });

  it("builds byte-identical CharX archives with a fixed source date", () => {
    const fixture = createFixture();
    const firstPath = path.join(fixture.root, "first.charx");
    const secondPath = path.join(fixture.root, "second.charx");
    const previousSourceDate = process.env.SOURCE_DATE_EPOCH;

    try {
      process.env.SOURCE_DATE_EPOCH = "1700000000";
      buildCharX(fixture.manifestPath, firstPath);
      buildCharX(fixture.manifestPath, secondPath);
    } finally {
      if (previousSourceDate === undefined) {
        delete process.env.SOURCE_DATE_EPOCH;
      } else {
        process.env.SOURCE_DATE_EPOCH = previousSourceDate;
      }
    }

    expect(fs.readFileSync(firstPath)).toEqual(fs.readFileSync(secondPath));
  });

  it("rejects ZIP entries that escape the output directory", () => {
    const fixture = createFixture();
    const archivePath = path.join(fixture.root, "fixture.charx");
    const maliciousPath = path.join(fixture.root, "malicious.charx");
    const outputPath = path.join(fixture.root, "unpacked");

    buildCharX(fixture.manifestPath, archivePath);
    const { count, modified } = replaceArchiveNames(
      fs.readFileSync(archivePath),
      "card.json",
      "../x.json",
    );
    expect(count).toBe(2);
    fs.writeFileSync(maliciousPath, modified);

    expect(() => unpackCharX(maliciousPath, outputPath)).toThrow(
      "ZIP entry escapes the output directory: ../x.json",
    );
    expect(fs.existsSync(path.join(fixture.root, "x.json"))).toBe(false);
  });
});
