import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioServer } from "./server.js";

const applicationDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)), "../..");
const dataDirectory = process.env.STUDIO_LOCAL_DATA_DIR || resolve(applicationDirectory, ".local-data");
const port = Number(process.env.STUDIO_LOCAL_API_PORT || 8787);

createStudioServer({ dataDirectory }).listen(port, "127.0.0.1", () => {
  console.log(`OpenDesign Studio local API: http://127.0.0.1:${port}`);
});
