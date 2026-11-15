#!/usr/bin/env node
// Keep package.json, Cargo.toml and tauri.conf.json on one release version.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const pkg = JSON.parse(read('package.json'));
const cargo = read('src-tauri/Cargo.toml');
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoLock = read('src-tauri/Cargo.lock');
const lockVersion = cargoLock.match(/\[\[package\]\]\s*\nname = "matchradar"\s*\nversion = "([^"]+)"/)?.[1];
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));

const versions = [
  ['package.json', pkg.version],
  ['src-tauri/Cargo.toml', cargoVersion],
  ['src-tauri/Cargo.lock', lockVersion],
  ['src-tauri/tauri.conf.json', tauri.version],
];
const distinct = new Set(versions.map(([, version]) => version));
if (!cargoVersion || distinct.size !== 1) {
  console.error('Version mismatch:');
  for (const [file, version] of versions) console.error(`  ${file}: ${version ?? '(missing)'}`);
  process.exit(1);
}
console.log(`Versions agree: ${pkg.version}`);
