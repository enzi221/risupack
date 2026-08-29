# risupack

A CLI and TypeScript library for building and unpacking RisuAI CharX and RisuM artifacts.

## Installation

```sh
npm install --save-dev risupack
```

## Commands

```sh
risupack build-charx <manifest.json> [output.charx]
risupack bundle-lua <entry.lua> <output.lua>
risupack inspect-risusave <database.bin> [namespace-or-name]
risupack unpack-charx <input.charx> [output-directory]
risupack unpack-risum <input.risum> [output-directory]
```

Set `SOURCE_DATE_EPOCH` when reproducible CharX output is required.

```sh
SOURCE_DATE_EPOCH=1700000000 risupack build-charx module/charx.json
```

## CharX output

The builder creates a ZIP archive containing the RisuAI card, encoded module, assets, and CharX metadata.

```text
module.charx
├── card.json
├── module.risum
├── assets/
└── x_meta/
```

## Module layout

The builder does not require a particular source directory layout. The `unpack-charx` and `unpack-risum` commands materialize recovered sources with the following layout when the corresponding source types exist.

```text
<output>/
├── assets/
├── lorebooks/
├── regex/
├── styles/
├── triggers/
├── charx.json
└── toggles.txt
```

Input manifests may use other layouts. Update every affected path in `charx.json` after moving a source file.

## Manifest paths

Resolve paths inside `charx.json` from the directory containing `charx.json`. This rule applies to `CSS`, `assets`, `icon`, `lorebook`, `output`, `regex`, `toggles`, trigger `lua`, and trigger `bundleOutput`.

Use the following manifest structure.

```json
{
  "CSS": "style.html",
  "assets": [
    {
      "file": "assets/background.webp",
      "name": "background"
    }
  ],
  "description": "Module description",
  "hideIcon": false,
  "icon": "assets/icon.png",
  "lorebook": [
    {
      "alwaysActive": false,
      "comment": "sample",
      "file": "lorebooks/sample.md",
      "folder": "Sample",
      "insertOrder": 100,
      "key": "",
      "mode": "normal",
      "secondaryKey": "",
      "selective": false,
      "useRegex": false
    }
  ],
  "lowLevelAccess": true,
  "name": "Sample Module",
  "namespace": "sample",
  "regex": ["regex/display.md"],
  "toggles": "toggles.txt",
  "triggers": [
    {
      "bundle": true,
      "lowLevelAccess": true,
      "lua": "triggers/main.lua"
    }
  ],
  "version": "1.0.0"
}
```

## Manifest fields

- `name`: Required non-empty module name.
- `namespace`: RisuAI module namespace.
- `version`: Packaged module version.
- `description`: Packaged module description.
- `creator`: Package creator name.
- `license`: Package license identifier or text.
- `tags`: Array of package tags. Defaults to an empty array.
- `output`: Output path used when the CLI output argument is omitted. Defaults to `../dist/<sanitized-name>.charx` relative to the manifest directory.
- `CSS`: Custom CSS source.
- `toggles`: Module toggle source.
- `icon`: Main module icon path. The builder supplies an empty default icon when omitted.
- `hideIcon`: Hides the module icon in chat when `true`. Defaults to `false`.
- `lowLevelAccess`: Enables module-level low-level access when `true`. Defaults to `false`.
- `folders`: Lorebook folder names to create even when no lorebook entry references them.
- `assets`: Additional packaged assets.
- `lorebook`: Lorebook entries.
- `regex`: Regex entries in execution order.
- `triggers`: Lua trigger entries.

## Source values

`CSS`, `toggles`, and lorebook sources accept a path string, a file object, or inline content.

```json
{
  "CSS": "styles/main.html",
  "toggles": { "file": "toggles.txt" },
  "lorebook": [
    {
      "comment": "inline",
      "content": "Inline lorebook content"
    }
  ]
}
```

When a source object contains both `content` and `file`, `content` takes precedence. A bundled Lua lorebook requires `file`.

## Lorebook entries

- `file`: Lorebook source path. Required unless `content` is provided.
- `content`: Inline lorebook source.
- `comment`: Lorebook name. Defaults to the source file basename.
- `alwaysActive`: Enables constant activation. Defaults to `false`.
- `activationPercent`: RisuAI activation percentage.
- `folder`: Display folder name. The builder creates referenced folders automatically.
- `insertOrder`: Lorebook insertion order. Defaults to `100`.
- `key`: Comma-separated primary activation keys. Defaults to an empty string.
- `secondaryKey`: Comma-separated secondary activation keys. Defaults to an empty string.
- `selective`: Enables secondary-key matching. Defaults to `false`.
- `mode`: RisuAI lorebook mode. Defaults to `normal`.
- `useRegex`: Treats activation keys as regular expressions when `true`. Defaults to `false`.
- `extentions`: RisuAI-specific lorebook extension values. Use this exact spelling.
- `bundle`: Bundles the Lua source and its `require()` dependencies when `true`. Defaults to `false`.
- `bundleOutput`: Optional path for retaining the bundled Lua artifact.

## Lua triggers

Define Lua triggers with `lua`. Do not specify `effect`, `conditions`, or `type` for Lua triggers.

- `lua`: Unbundled Lua entry file. Required.
- `bundle`: Bundles the entry file and its `require()` dependencies. Defaults to `true`.
- `bundleOutput`: Optional path for retaining the bundled Lua artifact.
- `comment`: Trigger name. Defaults to an empty string.
- `lowLevelAccess`: Enables low-level access for the trigger.

Omit `bundleOutput` for normal CharX builds. The builder uses a temporary output and removes it after packaging. Set `bundleOutput` only when a standalone bundled Lua artifact is required.

Keep modules loaded through Lua `require()` beside the trigger entry point or at paths resolvable by the Lua bundler.

## Regex entries

Store one regex entry in each Markdown file. Put RisuAI regex metadata in frontmatter and the pattern pair in the body.

```md
---
ableFlag: true
comment: Display
flag: gs
type: editdisplay
---

IN:
input pattern
OUT:
replacement
```

Use the frontmatter keys `ableFlag`, `comment`, `flag`, and `type`. Omit `flag` when the regex requires no flags. Leave the body after `OUT:` empty when the replacement is empty.

List regex file paths in execution order in the manifest `regex` array.

Regex entries accept a file path, a file object, or an inline object.

```json
{
  "regex": [
    "regex/display.md",
    { "file": "regex/request.md" },
    {
      "ableFlag": true,
      "comment": "Inline",
      "flag": "gs",
      "in": "input pattern",
      "out": "replacement",
      "type": "editdisplay"
    }
  ]
}
```

Inline regex entries require string values for both `in` and `out`. `ableFlag` defaults to `true`, `comment` defaults to an empty string, and `type` defaults to `editdisplay`.

## Lorebooks

Include Markdown prompts in the manifest `lorebook` array.

Set `comment` to the exact lorebook name consumed by the module. Use `folder` to group entries in RisuAI.

Set lorebook `bundle` to `true` when RisuAI must receive bundled Lua as lorebook instead of the source file. Set lorebook `file` to the unbundled Lua entry point. Omit `bundleOutput` to remove the temporary bundle after packaging.

## Assets

List additional packaged files in the manifest `assets` array.

- `file`: Asset source path. Required.
- `name`: RisuAI asset lookup name. Defaults to the source filename without its extension.
- `extension`: Packaged extension without a leading dot. Defaults to the source file extension and accepts lowercase letters and digits.

Archive entry names replace unsupported characters and add numeric suffixes to resolve collisions.

## Programmatic API

The package exports `buildCharX()`, `bundleLua()`, `createExpandedModuleSources()`, `decodeModule()`, `parseModuleBlock()`, `parseZIP()`, `unpackCharX()`, and `unpackRisuM()`.

## License

risupack is licensed under the GNU Affero General Public License version 3.
