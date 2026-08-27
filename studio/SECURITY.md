# Studio v0 security notes

Studio v0 is local-only and must not be deployed or connected to untrusted
assets. It has no production identity, database, COS, or public upload path.

## PPTX image parser advisory

PptxGenJS 4.0.1 currently depends on `image-size` 1.2.1. npm reports the
upstream ICNS and JXL/HEIF infinite-loop advisories against every published
`image-size` version through 2.0.2, so there is no non-breaking patched version
to select at this time.

The v0 renderer therefore:

- accepts only explicitly typed PNG and JPEG assets;
- rejects ICNS, JXL, HEIF and every other extension/data-URL MIME before the
  asset reaches PptxGenJS;
- ships with no user-upload or remote asset resolver;
- keeps production deployment blocked until the upstream dependency is fixed
  or the image metadata parser is replaced behind the renderer adapter.

Do not silence the npm audit finding or use `npm audit fix --force`; its current
suggestion downgrades PptxGenJS across major versions and does not provide the
required editable renderer behavior.
