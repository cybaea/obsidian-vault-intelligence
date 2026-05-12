import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import obsidianmd from "eslint-plugin-obsidianmd";
import perfectionist from "eslint-plugin-perfectionist";
import { globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				// FIX: Tell ESLint this global exists (injected by esbuild)
				TRANSFORMERS_VERSION: "readonly",
			},
		},
	},
	// Include TypeScript ESLint recommended configs to register the plugin
	...tseslint.configs.recommended,
	// Apply Obsidian recommended configs, but ensure they don't leak 
	// type-information requirements to non-TypeScript files.
	...obsidianmd.configs.recommended.map(config => {
		if (config.rules && !config.files) {
			return {
				...config,
				rules: Object.fromEntries(
					Object.entries(config.rules).filter(([key]) => ![
						'obsidianmd/no-plugin-as-component',
						'obsidianmd/no-view-references-in-plugin',
						'obsidianmd/no-unsupported-api',
						'obsidianmd/prefer-file-manager-trash-file',
						'obsidianmd/prefer-instanceof'
					].includes(key))
				)
			};
		}
		return config;
	}),
	// Add parser options and our strict rules ONLY for TypeScript files
	{
		files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		plugins: {
			'eslint-comments': eslintComments,
			'obsidianmd': obsidianmd,
			'perfectionist': perfectionist,
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-non-null-assertion": "error",
			"@typescript-eslint/no-unnecessary-type-assertion": "error",
			"@typescript-eslint/require-await": "error",
			"eslint-comments/disable-enable-pair": "error",

			"eslint-comments/no-unused-disable": "error",
			"eslint-comments/require-description": "error",
			"no-console": "error",
			// Re-enable the typed rules from Obsidian plugin specifically for TS files
			"obsidianmd/no-plugin-as-component": "error",
			"obsidianmd/no-unsupported-api": "error",
			"obsidianmd/no-view-references-in-plugin": "error",
			"obsidianmd/prefer-create-el": "off", // Conflicts with standard TypeScript Document types
			"obsidianmd/prefer-file-manager-trash-file": "warn",
			"obsidianmd/prefer-instanceof": "error",
			"obsidianmd/ui/sentence-case": ["error", {
				acronyms: ["API", "HTML", "AI", "ID", "CX"],
				brands: ["Google", "Gemini", "Google Cloud Console", "Transformers.js"]
			}],
			"perfectionist/sort-imports": "error",
			"perfectionist/sort-interfaces": "error",
			"perfectionist/sort-objects": "error",
		}
	},
	{
		files: ['src/workers/**/*.ts', 'tests/**/*.ts'],
		rules: {
			"obsidianmd/no-global-this": "off", // Workers and tests need globalThis
			"obsidianmd/prefer-active-doc": "off",
			"obsidianmd/prefer-window-timers": "off", // Workers don't have 'window'
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