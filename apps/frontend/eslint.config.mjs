import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import unusedImports from "eslint-plugin-unused-imports";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    plugins: {
      "unused-imports": unusedImports,
    },
    rules: {
      // Unused *imports* are auto-fixable via `eslint --fix` (the plugin's
      // whole point); the old no-op imports were swept in that cleanup pass.
      // `no-unused-vars` (locals/params) stays off for now — 25+ `any`
      // annotations and dead locals remain a separate pass.
      "unused-imports/no-unused-imports": "error",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // `'` in TS comments and inline strings triggers `react/no-unescaped-entities`
      // everywhere; rule fires inside plain TS source, not JSX text. Disabled
      // until the team decides whether to encode every `'` as `&apos;` or
      // scope the rule to JSX.
      "react/no-unescaped-entities": "off",
      // `react-hooks/set-state-in-effect` is a stricter rule introduced in
      // eslint-plugin-react-hooks v5 (shipped with Next.js 16). The current
      // codebase has dozens of `useEffect(() => setX(...))` lifecycle
      // patterns that were correct under v4. Until the team does the
      // sweeping refactor (move side-effects into callbacks, or use refs),
      // treat the rule as a warning so the lint gate stays useful for new
      // code via the other rules.
      "react-hooks/set-state-in-effect": "warn",
      // Same category — exhaustive-deps is a useful warning but the gate
      // for production fix happens with the React Hooks refactor.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);

export default eslintConfig;
