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
      "lua": "triggers/main.lua",
      "type": "start"
    }
  ],
  "version": "1.0.0"
}
```

Use `{ "content": "..." }` instead of a file path only when a `CSS`, `toggles`, or lorebook source must remain inline.

## Lua triggers

Set trigger `lua` to the unbundled entry file. Omit `bundle` or set `bundle` to `true` to let the CharX builder invoke the Lua bundler and embed the bundled code.

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

## Lorebooks

Include Markdown prompts in the manifest `lorebook` array.

Set `comment` to the exact lorebook name consumed by the module. Use `folder` to group entries in RisuAI.

Set lorebook `bundle` to `true` when RisuAI must receive bundled Lua as lorebook instead of the source file. Set lorebook `file` to the unbundled Lua entry point. Omit `bundleOutput` to remove the temporary bundle after packaging.

## Assets

List additional packaged files in the manifest `assets` array. Set `file` and the RisuAI lookup `name`. Set `extension` only when the file extension cannot be inferred from `file`.

## Programmatic API

The package exports `buildCharX()`, `bundleLua()`, `createExpandedModuleSources()`, `decodeModule()`, `parseModuleBlock()`, `parseZIP()`, `unpackCharX()`, and `unpackRisuM()`.

## License

risupack is licensed under the GNU Affero General Public License version 3.
