// Publish a new Bima version for Windows and macOS:
//   npm run release -- 0.8.0 "first change · second change"
//
// Bumps the version, commits, and pushes a tag. GitHub Actions (.github/workflows/release.yml)
// then builds and signs both platforms and publishes one release; every installed copy sees
// it on its next start (or within 6 hours) and offers to update.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "Guy1432/bima";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => join(root, ...s);
const sh = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });

const [, , version, ...noteParts] = process.argv;
const notes = noteParts.join(" ").trim();

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error(`גרסה לא תקינה: ${version} (צריך משהו כמו 0.8.0)`);
if (!notes) throw new Error('חסר תיאור: npm run release -- 0.8.0 "מה חדש · עוד שינוי"');
if (sh("git status --porcelain")) throw new Error("יש שינויים שלא נשמרו ב-git. בצע commit קודם.");
if (sh("git rev-parse --abbrev-ref HEAD") !== "main") throw new Error("פרסום רק מ-main.");
if (sh(`git tag -l v${version}`)) throw new Error(`גרסה ${version} כבר קיימת. תן מספר גרסה גבוה יותר.`);

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

// 2. commit + tag (the tag message is the changelog) and hand over to CI
run(`git commit -am "Release ${version}"`);
writeFileSync(p(".git", "TAG_MSG"), notes);
run(`git tag -a v${version} -F .git/TAG_MSG`);
run(`git push origin main v${version}`);

console.log(`\n✔ v${version} נשלחה לבנייה (Windows + Mac).`);
console.log(`  מעקב: https://github.com/${REPO}/actions`);
console.log(`  הגרסה תתפרסם כאן כששתי הבניות יסתיימו: https://github.com/${REPO}/releases\n`);
