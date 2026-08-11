# OpenDesign Studio v0

Studio is an isolated workspace inside the OpenDesign repository. The first
vertical slice renders one versioned Scene IR to an editable browser canvas,
PNG snapshots, and an editable PPTX.

## Boundary

- Local fixtures only; no production Library, database, COS, or credentials.
- Fixed 1600×900 logical canvas and six scenes.
- Scene IR is the source of truth. HTML and PPTX are separate renderers.
- No deployment, public publishing, authentication, or arbitrary HTML/CSS.

## Run the local vertical slice

```bash
npm install
npm run dev
```

The command starts the Studio Web app on `127.0.0.1:5173` and the local-only
API on `127.0.0.1:8787`. Project revisions and exports are written under
`studio/.local-data/`, which is ignored by Git. The API is deliberately bound
to loopback and has no production credentials or cloud adapters.

PNG pages are rendered directly from Scene IR with the native canvas adapter;
they do not pass through PPTX or LibreOffice. macOS and common Noto CJK Linux
font locations are detected automatically. Other environments can set
`OPENDESIGN_CJK_FONT_PATH` to an installed CJK font file.

## Workspace ownership

- `packages/contracts` and `fixtures`: Core Contract lane.
- `apps/web` and `packages/ui`: Studio Web lane.
- `packages/renderers` and `packages/qa`: Renderer & QA lane.

The root integration lane owns workspace configuration and cross-package tests.
