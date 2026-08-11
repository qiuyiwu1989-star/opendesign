# OpenDesign Studio v0

Studio is an isolated workspace inside the OpenDesign repository. The first
vertical slice renders one versioned Scene IR to an editable browser canvas,
PNG snapshots, and an editable PPTX.

## Boundary

- Local fixtures only; no production Library, database, COS, or credentials.
- Fixed 1600×900 logical canvas and six scenes.
- Scene IR is the source of truth. HTML and PPTX are separate renderers.
- No deployment, public publishing, authentication, or arbitrary HTML/CSS.

## Workspace ownership

- `packages/contracts` and `fixtures`: Core Contract lane.
- `apps/web` and `packages/ui`: Studio Web lane.
- `packages/renderers` and `packages/qa`: Renderer & QA lane.

The root integration lane owns workspace configuration and cross-package tests.
