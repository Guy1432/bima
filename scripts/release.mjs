// Publish a new Bima version:
//   npm run release -- 0.9.1 "first change · second change"             Windows + macOS (GitHub Actions, ~30 min)
//   npm run release -- 0.9.1 "first change · second change" --windows   Windows only, built here (~10 min)
//
// Bumps the version and commits. The default hands over to GitHub Actions
// (.github/workflows/release.yml), which builds and signs both platforms and publishes one
// release. --windows builds and signs on this computer and publishes straight away (macOS
// users keep their current version until the next full release). Either way, every installed
// copy sees the update on its next start (or within 6 hours) and offers to install it.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "Guy1432/bima";
const KEY = join(homedir(), ".tauri", "bima-updater.key");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => join(root, ...s);
const sh = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
const run = (cmd, env) => execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });

const args = process.argv.slice(2);
const windowsOnly = args.includes("--windows");
const [version, ...noteParts] = args.filter((a) => a !== "--windows");
const notes = noteParts.join(" ").trim();

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error(`גרסה לא תקינה: ${version} (צריך משהו כמו 0.9.1)`);
if (!notes) throw new Error('חסר תיאור: npm run release -- 0.9.1 "מה חדש · עוד שינוי"');
if (sh("git status --porcelain")) throw new Error("יש שינויים שלא נשמרו ב-git. בצע commit קודם.");
if (sh("git rev-parse --abbrev-ref HEAD") !== "main") throw new Error("פרסום רק מ-main.");
if (sh(`git tag -l v${version}`)) throw new Error(`גרסה ${version} כבר קיימת. תן מספר גרסה גבוה יותר.`);
if (windowsOnly && !existsSync(KEY)) throw new Error(`מפתח החתימה לא נמצא: ${KEY}`);

// 1. bump the version everywhere it is written
const confPath = p("src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
const pkgPath = p("package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
const cargoPath = p("src-tauri", "Cargo.toml");
writeFileSync(cargoPath, readFileSync(cargoPath, "utf8").replace(/^version = ".*"$/m, `version = "${version}"`));
run("cargo update -p bima --manifest-path src-tauri/Cargo.toml --offline");
run(`git commit -am "Release ${version}"`);

const parts = notes.split(/\s+·\s+/).filter(Boolean);
const bodyFile = p(".git", "RELEASE_NOTES.md");
writeFileSync(bodyFile, `<div dir="rtl">\n\n${parts.map((x) => `- ${x}`).join("\n")}\n\n</div>\n`);

if (!windowsOnly) {
  // 2. tag (the tag message is the changelog) and hand over to CI
  writeFileSync(p(".git", "TAG_MSG"), notes);
  run(`git tag -a v${version} -F .git/TAG_MSG`);
  run(`git push origin main v${version}`);
  console.log(`\n✔ v${version} נשלחה לבנייה (Windows + Mac).`);
  console.log(`  מעקב: https://github.com/${REPO}/actions`);
  console.log(`  הגרסה תתפרסם כשהבניות יסתיימו: https://github.com/${REPO}/releases\n`);
  process.exit(0);
}

// 2. signed Windows build, here
console.log(`\n▶ בונה את בימה ${version} ל-Windows…\n`);
run("npx tauri build", { TAURI_SIGNING_PRIVATE_KEY: readFileSync(KEY, "utf8"), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" });
const nsis = p("src-tauri", "target", "release", "bundle", "nsis");
const exe = `Bima_${version}_x64-setup.exe`;
const entry = {
  signature: readFileSync(join(nsis, `${exe}.sig`), "utf8").trim(),
  url: `https://github.com/${REPO}/releases/download/v${version}/${exe}`,
};
// Windows entries only: listing an older Mac build under a newer version would make Macs
// "update" to it over and over
writeFileSync(
  join(nsis, "latest.json"),
  JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms: { "windows-x86_64": entry, "windows-x86_64-nsis": entry } }, null, 2),
);

// 3. publish (creates the tag; the CI release workflow sees it's published and stands down)
run("git push origin main");
run(
  `gh release create v${version} "${join(nsis, exe)}" "${join(nsis, `${exe}.sig`)}" "${join(nsis, "latest.json")}" ` +
    `--repo ${REPO} --target main --title "Bima ${version}" --notes-file "${bodyFile}"`,
);
run("git fetch --tags origin");
console.log(`\n✔ בימה ${version} פורסמה ל-Windows. כל המחשבים יקבלו הודעת עדכון.\n`);
