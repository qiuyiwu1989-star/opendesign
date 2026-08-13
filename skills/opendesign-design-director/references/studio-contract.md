# Studio contract field guide

This is a navigation aid, not a frozen schema copy. Resolve the repository root first and treat these files as authoritative:

- `studio/packages/contracts/structured-html.schema.json`
- `studio/packages/contracts/design-pack.schema.json`
- `studio/packages/contracts/src/index.ts`
- `studio/packages/html-importer/src/index.ts`
- `studio/packages/design-packs/packs/*.json`

At the current repository version, Structured HTML contract `0.1.0` uses one root with:

```html
<main
  data-od-contract-version="0.1.0"
  data-od-document-id="doc_example"
  data-od-title="Example"
  data-od-design-pack-id="executive-proposal-cn"
  data-od-design-pack-version="1.0.0"
>
```

Each direct scene declaration needs `data-od-scene-id`, `data-od-scene-order`, `data-od-page-role`, `data-od-layout`, and `data-od-purpose`. Each imported element needs:

- `data-od-element-id`
- `data-od-role`
- `data-od-frame="x,y,width,height"`
- `data-od-editable`, using only `text typography asset frame order`
- `data-od-export-pptx`, using only `native raster omitted`
- `data-od-source-ids`, containing one or more supplied source IDs

Supported content tags are currently `h1 h2 h3 p span img div figure blockquote`. Supported roles are `eyebrow title body caption metric quote image shape`. Optional visual fields are defined by `STRUCTURED_HTML_ATTRIBUTES`; read that constant instead of inventing `data-od-*` names.

## Security invariants

- Treat markup as untrusted and parse it inertly.
- Reject `script`, `style`, `iframe`, `object`, `embed`, `link`, `base`, and `form`.
- Reject event handlers and non-allowlisted URL attributes.
- Accept image sources only when the live importer accepts them. Current safe forms are `asset://...` and the approved local asset API path.
- Never use remote fonts, remote media, JavaScript URLs, data URLs, inline executables, or third-party trackers.
- Keep every image's `alt` non-empty and meaningful.

## Provenance invariants

The HTML carries source IDs; provenance is supplied separately to the importer. Every referenced ID must exist in that provenance package. Preserve title, reference, capture time, and hash when supplied. A generated sentence may summarize evidence, but it may not create evidence.

## Minimal element

```html
<h1
  data-od-element-id="scene_01_title"
  data-od-role="title"
  data-od-frame="112,120,1120,180"
  data-od-editable="text typography frame order"
  data-od-export-pptx="native"
  data-od-source-ids="source_brief"
  data-od-font-size="64"
  data-od-font-weight="600"
  data-od-line-height="1.05"
  data-od-z-index="2"
>A source-grounded judgment</h1>
```

This fragment is not an import test. Claim compatibility only after running the live importer and recording its actual result.
