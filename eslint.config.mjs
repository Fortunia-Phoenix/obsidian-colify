import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default defineConfig([
	{ ignores: ["node_modules/**", "main.js", "**/*.mjs"] },
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		rules: {
			// Obsidian 1.13 can auto-append helper-created nodes to the wrong root.
			// Colify instead uses ownerDocument.createElement() and explicit mounting.
			"obsidianmd/prefer-create-el": "off"
		},
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				project: "./tsconfig.json",
				sourceType: "module"
			}
		}
	}
]);
