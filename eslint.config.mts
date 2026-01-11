import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				// FIX: Tell ESLint this global exists (injected by esbuild)
				TRANSFORMERS_VERSION: "readonly",
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				// @ts-expect-error -- Node 20.11+ feature, might not be in types yet
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	// Include TypeScript ESLint recommended configs to register the plugin
	...tseslint.configs.recommended,
	// @ts-expect-error -- Type mismatch in plugin config export
	...obsidianmd.configs.recommended,
	// Add eslint-comments plugin and our strict rules ONLY for TypeScript files
	{
		files: ['**/*.ts', '**/*.tsx'],
		plugins: {
			'eslint-comments': eslintComments,
			'obsidianmd': obsidianmd,
		},
		rules: {
			"@typescript-eslint/require-await": "error",
			"@typescript-eslint/no-explicit-any": "error",
			"obsidianmd/ui/sentence-case": ["error", {
				brands: ["Google", "Gemini", "Google Cloud Console", "Transformers.js", "Obsidian"],
				acronyms: ["API", "HTML", "AI", "ID", "CX"]
			}],
			"no-console": "error",
			"eslint-comments/require-description": "error",
			"eslint-comments/disable-enable-pair": "error",
			"eslint-comments/no-unused-disable": "error",
		}
	},
	globalIgnores([
		"node_modules",
		"dist",
		".vitepress",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"worker.js",
		"scripts/**",
		"src/**/*.d.ts"
	]),
);