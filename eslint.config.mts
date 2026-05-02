import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import perfectionist from "eslint-plugin-perfectionist";

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
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	// Include TypeScript ESLint recommended configs to register the plugin
	...tseslint.configs.recommended,
	...obsidianmd.configs.recommended,
	// Add eslint-comments plugin and our strict rules ONLY for TypeScript files
	{
		files: ['**/*.ts', '**/*.tsx'],
		plugins: {
			'eslint-comments': eslintComments,
			'obsidianmd': obsidianmd,
			'perfectionist': perfectionist,
		},
		rules: {
			"@typescript-eslint/require-await": "error",
			"@typescript-eslint/no-non-null-assertion": "error",
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-unnecessary-type-assertion": "error",
			"obsidianmd/ui/sentence-case": ["error", {
				brands: ["Google", "Gemini", "Google Cloud Console", "Transformers.js"],
				acronyms: ["API", "HTML", "AI", "ID", "CX"]
			}],
			"no-console": "error",
			"eslint-comments/require-description": "error",
			"eslint-comments/disable-enable-pair": "error",
			"eslint-comments/no-unused-disable": "error",
			"perfectionist/sort-imports": "error",
			"perfectionist/sort-interfaces": "error",
			"perfectionist/sort-objects": "error",
			"obsidianmd/prefer-create-el": "off", // Conflicts with standard TypeScript Document types
		}
	},
	{
		files: ['src/workers/**/*.ts', 'tests/**/*.ts'],
		rules: {
			"obsidianmd/prefer-active-doc": "off", // Workers and tests do not have a DOM/activeDocument
		}
	},
	globalIgnores([
		".tmp",
		"node_modules",
		"dist",
		"coverage",
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