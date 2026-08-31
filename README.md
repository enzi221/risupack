# risupack

A command-line tool and TypeScript library for building RisuAI CharX modules, unpacking CharX and RisuM files, bundling Lua, and inspecting RisuSave databases.

## Requirements

- Node.js 20 or later

## Installation

Install risupack in the project that contains the module sources.

```sh
npm install --save-dev risupack
```

Run the local installation with `npx risupack`.

## New modules

A module without character prompts needs only a manifest.

```text
sample-module/
└── charx.json
```

```json
{
  "description": "Sample module",
  "name": "Sample Module",
  "namespace": "sample-module",
  "version": "1.0.0"
}
```

Build the CharX from the manifest.

```sh
npx risupack build-charx sample-module/charx.json
```

Without `output`, the command writes `../dist/<name>.charx` relative to the manifest directory.

Add lorebooks, regexes, triggers, CSS, toggles, assets, or character prompts only when the module needs them. Reference each source from `charx.json`.

## Existing modules

Unpack an existing CharX into editable sources.

```sh
npx risupack unpack-charx character.charx character
```

Both unpack commands require an absent or empty output directory. When the output argument is omitted, each command uses the input filename without its extension.

Edit the generated sources and rebuild from the generated manifest.

```sh
npx risupack build-charx character/charx.json
```

Use `unpack-risum` for a standalone RisuM file.

```sh
npx risupack unpack-risum module.risum module
```

The generated `charx.json` can be passed to `build-charx` to package the recovered module as a CharX.

## Source layout

All manifest paths, including `output` and `bundleOutput`, are relative to `charx.json`. A generated source directory can contain the following files when the module uses the corresponding features.

```text
<module>/
├── alternate_greetings/
├── assets/
├── lorebooks/
├── regex/
├── triggers/
├── card.json
├── charx.json
├── description.md
├── first_mes.md
├── style.html
└── toggles.txt
```

The builder accepts other layouts. Update the paths in `charx.json` after moving a source file.

## Manifest

`name` is the only field enforced as required. Set a stable `namespace` for module identity and lookup.

```json
{
  "CSS": "style.html",
  "assets": [
    {
      "file": "assets/background.webp",
      "name": "background"
    }
  ],
  "creator": "Creator",
  "description": "Module description",
  "folders": ["Internal"],
  "hideIcon": false,
  "icon": "assets/icon.png",
  "license": "AGPL-3.0-only",
  "lorebook": [
    {
      "alwaysActive": false,
      "comment": "Sample",
      "file": "lorebooks/sample.md",
      "folder": "Internal",
      "insertOrder": 100,
      "key": "sample",
      "mode": "normal",
      "secondaryKey": "",
      "selective": false,
      "useRegex": false
    }
  ],
  "lowLevelAccess": false,
  "name": "Sample Module",
  "namespace": "sample-module",
  "output": "../dist/sample-module.charx",
  "regex": ["regex/display.md"],
  "tags": ["utility"],
  "toggles": "toggles.txt",
  "triggers": [
    {
      "bundle": true,
      "comment": "Start",
      "lowLevelAccess": false,
      "lua": "triggers/main.lua",
      "type": "start"
    }
  ],
  "version": "1.0.0"
}
```

- `CSS`: CSS or HTML source inserted into the RisuAI background HTML field
- `assets`: Additional files packaged as RisuAI assets
- `card`: Optional character card sources
- `creator`: Creator name
- `description`: Package description stored as creator notes
- `folders`: Lorebook folders to create even when no entry references them
- `hideIcon`: Whether RisuAI hides the module icon in chat, defaulting to `false`
- `icon`: Main module icon; omission creates a transparent placeholder icon
- `license`: Package license identifier or text
- `lorebook`: Lorebook entries
- `lowLevelAccess`: Module-level low-level access, defaulting to `false`
- `name`: Required non-empty module name
- `namespace`: Module namespace
- `output`: Default CharX output path
- `regex`: Regex entries in execution order
- `tags`: Package tags, defaulting to an empty array
- `toggles`: Module toggle source
- `triggers`: Trigger entries
- `version`: Package version

## Text sources

CSS, toggles, lorebook contents, and external character text fields accept a path string or an object containing `file` or `content`.

```json
{
  "CSS": "style.html",
  "lorebook": [
    {
      "comment": "Inline",
      "content": "Inline lorebook content"
    }
  ],
  "toggles": {
    "file": "toggles.txt"
  }
}
```

`content` takes precedence when an object contains both `content` and `file`. Bundled Lua lorebooks require `file`.

## Character sources

Omit `card` when the module has no character-specific prompts or settings.

Use a card source object to keep the character description and greetings in separate Markdown files.

```json
{
  "card": {
    "alternate_greetings": ["alternate_greetings/1.md", "alternate_greetings/2.md"],
    "description": "description.md",
    "file": "card.json",
    "first_mes": "first_mes.md"
  }
}
```

- `alternate_greetings`: Alternate greeting sources in display order
- `description`: Character description source
- `file`: JSON source for other character card fields
- `first_mes`: First message source

`card.json` may contain `{}` when all required character content is stored in the external text files. Put other Character Card fields under `data`.

The unpack commands create character sources only when the packaged card contains character-specific values.

## Lorebooks

Each lorebook entry accepts the following fields.

- `activationPercent`: RisuAI activation percentage
- `alwaysActive`: Constant activation, defaulting to `false`
- `bookVersion`: Lorebook format version, defaulting to `2`
- `bundle`: Whether to bundle a Lua source and its `require()` dependencies, defaulting to `false`
- `bundleOutput`: Optional path that retains the bundled Lua output
- `comment`: Lorebook name, defaulting to the source filename
- `content`: Inline lorebook content
- `extentions`: RisuAI-specific lorebook extension values; retain this spelling
- `file`: Lorebook source path, required unless `content` is present
- `folder`: RisuAI lorebook folder name
- `insertOrder`: Insertion order, defaulting to `100`
- `key`: Comma-separated primary activation keys, defaulting to an empty string
- `mode`: RisuAI lorebook mode, defaulting to `normal`
- `secondaryKey`: Comma-separated secondary activation keys, defaulting to an empty string
- `selective`: Secondary-key matching, defaulting to `false`
- `useRegex`: Regular expression matching for activation keys, defaulting to `false`

Set `bundle` to `true` when the packaged lorebook must contain bundled Lua instead of the Lua entry source.

```json
{
  "lorebook": [
    {
      "alwaysActive": false,
      "bundle": true,
      "comment": "Renderer",
      "file": "lorebooks/renderer.lua",
      "insertOrder": 200
    }
  ]
}
```

Omit `bundleOutput` during normal builds. The builder removes its temporary bundle after packaging.

## Regexes

Store one file-based regex entry in each Markdown file.

```md
---
comment: Display
flag: gs
type: editdisplay
---

IN:
input pattern
OUT:
replacement
```

The frontmatter accepts `comment`, `flag`, and `type`. The generated RisuAI `ableFlag` value is `true` when `flag` is present and `false` when `flag` is absent. Leave the content after `OUT:` empty for an empty replacement.

Manifest entries accept a path, an object containing `file`, or inline regex data.

```json
{
  "regex": [
    "regex/display.md",
    {
      "file": "regex/request.md"
    },
    {
      "comment": "Inline",
      "flag": "gs",
      "in": "input pattern",
      "out": "replacement",
      "type": "editdisplay"
    }
  ]
}
```

Inline entries require string values for `in` and `out`. The presence of `flag` also controls `ableFlag` for inline entries. `comment` defaults to an empty string, and `type` defaults to `editdisplay`.

## Lua triggers

Set `lua` to an unbundled Lua entry file.

```json
{
  "triggers": [
    {
      "bundle": true,
      "comment": "Start",
      "conditions": [],
      "lowLevelAccess": false,
      "lua": "triggers/main.lua",
      "type": "start"
    }
  ]
}
```

- `bundle`: Whether to bundle `require()` dependencies, defaulting to `true`
- `bundleOutput`: Optional path that retains the bundled Lua output
- `comment`: Trigger name, defaulting to an empty string
- `conditions`: RisuAI trigger conditions, defaulting to an empty array
- `lowLevelAccess`: Trigger-level low-level access
- `lua`: Lua entry file
- `type`: RisuAI trigger type, defaulting to `start`

The bundler resolves `require("lib.example")` as `lib/example.lua` relative to the Lua entry file's directory. Omit `bundleOutput` during normal builds to use a temporary bundle.

A trigger without `lua` must provide a RisuAI `effect` array directly. This form preserves triggers that cannot be represented as one Lua effect.

## CSS and toggles

risupack copies CSS and toggle sources into the package without changing their contents.

Wrap custom styles in a `<style>` element.

```html
<style>
  .sample-panel {
    color: white;
  }
</style>
```

Write one toggle definition per line.

```text
enabled=Enable feature
theme=Theme=select=Light,Dark
label=Label=text
```

Checkbox values omit the type. Select values use `select` followed by comma-separated options. Text values use `text`.

## Assets

List additional packaged files in `assets`.

- `extension`: Packaged extension without a leading dot; defaults to the lowercase source extension and accepts ASCII letters and digits
- `file`: Required asset source path
- `name`: RisuAI asset name, defaulting to the source filename without its extension

The builder sanitizes unsupported archive filename characters and adds numeric suffixes for collisions.

## Reproducible builds

Set `SOURCE_DATE_EPOCH` to a Unix timestamp to fix timestamps in the generated card and ZIP entries.

```sh
SOURCE_DATE_EPOCH=1700000000 npx risupack build-charx module/charx.json
```

Identical inputs and a fixed source date produce byte-identical CharX files.

## CharX contents

A built CharX contains the generated card, encoded module, assets, and asset metadata.

```text
module.charx
├── assets/
├── x_meta/
├── card.json
└── module.risum
```

The archive always contains `card.json`, `module.risum`, and a main icon. The source manifest does not require a `card` or `icon` field.

## Utility commands

Bundle a standalone Lua entry file.

```sh
npx risupack bundle-lua triggers/main.lua dist/main.lua
```

The command writes one Lua file containing resolved `require()` dependencies and the entry code.

Inspect the module records stored in a RisuSave database.

```sh
npx risupack inspect-risusave database.bin
npx risupack inspect-risusave database.bin module-namespace
```

The optional query matches a module namespace, name, or ID. The command writes the matching records as JSON to standard output.

## Programmatic API

Import commands from the package root.

```ts
import { buildCharX, unpackCharX } from "risupack";

buildCharX("module/charx.json", "dist/module.charx");
unpackCharX("dist/module.charx", "module-unpacked");
```

The package exports `buildCharX()`, `bundleLua()`, `createExpandedModuleSources()`, `decodeModule()`, `parseModuleBlock()`, `parseZIP()`, `unpackCharX()`, and `unpackRisuM()`.

## License

risupack is licensed under the GNU Affero General Public License version 3.
