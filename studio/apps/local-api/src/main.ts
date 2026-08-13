import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioServer } from "./server.js";
import { createPublicSessionCodec } from "./public-session.js";
import { configureGenerationProvider } from "./model-provider.js";

const applicationDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)), "../..");
const dataDirectory = process.env.STUDIO_LOCAL_DATA_DIR || resolve(applicationDirectory, ".local-data");
const port = Number(process.env.STUDIO_LOCAL_API_PORT || 8787);
const sessionSecret = process.env.STUDIO_PUBLIC_SESSION_SECRET;
if (!sessionSecret || Buffer.byteLength(sessionSecret, "utf8") < 32) {
  throw new Error("STUDIO_PUBLIC_SESSION_SECRET must be configured with at least 32 bytes");
}

createStudioServer({
  dataDirectory,
  sessionCodec: createPublicSessionCodec({ secret: sessionSecret }),
  generationProvider: configureGenerationProvider({ env: process.env }),
}).listen(port, "127.0.0.1", () => {
  console.log(`OpenDesign Studio local API: http://127.0.0.1:${port}`);
});
