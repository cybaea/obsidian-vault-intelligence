import type { Plugin as CorePlugin } from "@eslint/core";

import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import obsidianmd from "eslint-plugin-obsidianmd";
import perfectionist from "eslint-plugin-perfectionist";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from 'typescript-eslint';

// The third-party plugin packages ship structural types that are not directly
// assignable to the FlatConfig.Plugin interface, which would widen to `any`.
// Cast at the import boundary so the config object stays fully type-safe.
const eslintCommentsPlugin = eslintComments as unknown as CorePlugin;
const obsidianmdPlugin = obsidianmd as unknown as CorePlugin;
const perfectionistPlugin = perfectionist as unknown as CorePlugin;

export default defineConfig(
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
	...tseslint.configs.recommendedTypeChecked.map(config => ({
    	...config,
    	files: ['src/**/*.ts']
	})),
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
			'eslint-comments': eslintCommentsPlugin,
			'obsidianmd': obsidianmdPlugin,
			'perfectionist': perfectionistPlugin,
		},
		rules: {
			"@typescript-eslint/no-non-null-assertion": "error",
			"@typescript-eslint/no-unnecessary-type-assertion": "error",
			"@typescript-eslint/no-unsafe-argument": "error",
			"@typescript-eslint/no-unsafe-assignment": "error",
			"@typescript-eslint/no-unsafe-call": "error",
			"@typescript-eslint/no-unsafe-member-access": "error",
			"@typescript-eslint/no-unsafe-return": "error",
			"@typescript-eslint/no-unused-vars": ["error", {
				"args": "none",
				"caughtErrorsIgnorePattern": "^_",
				"ignoreRestSiblings": true,
				"varsIgnorePattern": "^_"
			}],
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
			"obsidianmd/prefer-window-timers": "off", // Workers don't have 'window' and many tests are workers
		}
	},
	{
		files: ['src/workers/**/*.ts'],
		rules: {
			"obsidianmd/prefer-active-doc": "off", // Workers don't have an active document; see also https://github.com/obsidianmd/eslint-plugin/issues/150
		}
	},
	// Test files use mocks that legitimately require `any` types, unsafe
	// assignments for mock objects, and TFile/TFolder casting. The
	// eslint-comments restricted-disable rules are also too strict for
	// test-level disable comments. These overrides keep production code
	// fully strict while allowing tests to use pragmatic mocking patterns.
	{
		files: ['tests/**/*.ts'],
		rules: {
			// Mocks require `any` and unsafe operations by nature
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/require-await": "off",
			"@typescript-eslint/unbound-method": "off",
			// Tests need to disable specific rules for mock-based patterns
			"eslint-comments/no-restricted-disable": "off",
			"eslint-comments/no-unlimited-disable": "off",
			"eslint-comments/require-description": "off",
			// Mocking Obsidian's TFile/TFolder requires casting
			"obsidianmd/no-tfile-tfolder-cast": "off",
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
		"src/**/*.d.ts",
		"vitest.config.mts",
	]),
);