import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = process.argv[2];

if (!outputDirectory) {
  throw new Error("Usage: node scripts/build-site.mjs <output-directory>");
}

const version = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();

if (!/^[a-f0-9]{40,64}$/i.test(version)) {
  throw new Error("GITHUB_SHA must be a full Git commit hash.");
}

const message = execFileSync("git", ["log", "-1", "--format=%s", version], {
  cwd: root,
  encoding: "utf8",
}).trim();

if (!message) {
  throw new Error(`No commit subject found for ${version}.`);
}

const escapeHtmlAttribute = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const html = (await readFile(join(root, "index.html"), "utf8"))
  .replaceAll("__BUILD_VERSION__", version)
  .replaceAll("__BUILD_MESSAGE__", escapeHtmlAttribute(message));
const serviceWorker = (await readFile(join(root, "service-worker.js"), "utf8"))
  .replaceAll("__BUILD_VERSION__", version);

if (
  html.includes("__BUILD_VERSION__") ||
  html.includes("__BUILD_MESSAGE__") ||
  serviceWorker.includes("__BUILD_VERSION__")
) {
  throw new Error("Build metadata placeholders were not fully replaced.");
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(join(outputDirectory, "index.html"), html),
  writeFile(join(outputDirectory, "service-worker.js"), serviceWorker),
  writeFile(join(outputDirectory, "version.json"), `${JSON.stringify({ version, message })}\n`),
  ...["app.js", "styles.css", "manifest.webmanifest", "icon-192.png", "icon-512.png"].map(async (file) => {
    const contents = await readFile(join(root, file));
    await writeFile(join(outputDirectory, file), contents);
  }),
]);

console.log(`Built ${version.slice(0, 12)} — ${message}`);
