# Copyable compiler input

Copy this shape, then validate it against `studio/packages/design-director/design-director-input.schema.json`. That live schema is authoritative and rejects unknown fields.

```json
{
  "inputVersion": "0.1.0",
  "taskId": "task_example",
  "title": "Human-readable task title",
  "brief": {
    "objective": "What this work must enable",
    "audience": "Who must understand or decide",
    "decisionRequest": "The one decision requested",
    "constraints": ["Use supplied evidence only"]
  },
  "content": {
    "summary": "A source-grounded summary",
    "keyPoints": [
      {
        "id": "point_primary",
        "text": "Only a statement supported by supplied evidence",
        "sourceIds": ["source_brief"]
      }
    ],
    "callToAction": "The final human-confirmed next action"
  },
  "sources": [
    {
      "sourceId": "source_brief",
      "type": "brief",
      "title": "Approved project brief",
      "sourceRef": "fixture://brief",
      "content": "Actual source content, not a citation shell",
      "contentHash": "sha256:replace-with-real-64-character-lowercase-hex-digest"
    }
  ],
  "brand": {
    "name": "OpenDesign",
    "tone": ["clear", "restrained", "specific"],
    "primaryColor": "#D84A2F",
    "logoAssetSrc": "asset://brand/opendesign-logo.png"
  },
  "deliverable": {
    "kind": "proposal",
    "audience": "Decision makers",
    "language": "zh-CN",
    "format": "structured-html",
    "pageCount": 6
  },
  "designPack": {
    "id": "executive-proposal-cn",
    "version": "1.0.0"
  },
  "editability": {
    "requiredCapabilities": ["text", "typography", "asset", "frame", "order"],
    "requireNativeText": true,
    "requireReplaceableImages": true,
    "requireReorderablePages": true
  }
}
```

## Preflight

- Replace every placeholder; omit an optional hash rather than submit the example hash.
- Keep `taskId`, point IDs, and source IDs within the live ID pattern.
- Include source content through the caller's approved channel. A title or URL without content is not evidence.
- Use `proposal`, `keynote`, or `article-graphics` with the matching versioned Pack.
- Keep `pageCount` between 6 and 10 and format fixed to `structured-html`.
- Require all editability booleans and capabilities expected by the Pack.
- Reject fabricated claims, unknown source IDs, arbitrary scripts, remote assets, automatic publishing, or silent overwrite of human edits.
