import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

if (!targetVersion) {
	throw new Error("npm_package_version is not available.");
}

const manifest = readJson("manifest.json");
const versions = readJson("versions.json");

manifest.version = targetVersion;
versions[targetVersion] = manifest.minAppVersion;

writeJson("manifest.json", manifest);
writeJson("versions.json", versions);

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}
