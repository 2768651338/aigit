import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/**
 * ESLint flat config. Baseline policy:
 *  - `react-hooks/rules-of-hooks` is an error (real bug class, CI fails on it).
 *  - `react-hooks/exhaustive-deps` starts as a warning — the codebase predates
 *    the lint gate; tighten to "error" once existing warnings are resolved.
 *  - Formatting is intentionally left to editors (no prettier rule set) to
 *    avoid a whole-repo reformat.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "release-dl/**",
      "gui-test-screenshots/**",
      "*.config.cjs",
      "scripts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Test files may use non-async wrappers around async flows.
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // These modules use control characters (\u0000, \x1f) as deliberate
    // in-memory key separators — not user-supplied regexes.
    files: ["src/stores/aiStore.ts", "src/utils/insights.ts"],
    rules: {
      "no-control-regex": "off",
    },
  },
);
