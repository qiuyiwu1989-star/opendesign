# PPTX image parser advisory

`pptxgenjs@4.0.1` currently depends on `image-size@1.2.1`. The published `image-size`
releases are affected by infinite-loop denial-of-service advisories for ICNS, JXL and
HEIF parsers. There is no non-breaking upstream release available as of 2026-08-13.

OpenDesign mitigates the reachable input surface before calling PptxGenJS:

- accept only PNG and JPEG declarations;
- verify file extension and binary magic bytes;
- reject non-regular files and images larger than 25 MiB;
- reject ICNS, JXL, HEIF and disguised content;
- keep the renderer tests as a release gate.

Do not use `npm audit fix --force`: its suggested PptxGenJS downgrade removes current
renderer behavior and is not a safe upgrade. Re-evaluate this mitigation when an upstream
PptxGenJS release depends on a patched parser.
