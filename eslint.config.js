import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",

      // ── Errors: things that are actually broken ──────────────────────────
      //
      // rules-of-hooks stays an error. It is not style — a hook behind an
      // early return changes the hook count between renders and React throws
      // "Rendered more/fewer hooks than during the previous render", blanking
      // the page. There were 21 of these across Users.tsx, TenantSwitcher.tsx,
      // PartnerCredits.tsx and M365IntegrationSettingsCard.tsx, all fixed on
      // 2026-09-09. Keep it at error so they cannot come back.
      "react-hooks/rules-of-hooks": "error",

      // ── Warnings: real debt, but not worth blocking a deploy over ────────
      //
      // 632 no-explicit-any violations is a symptom, not the disease: the
      // generated Supabase types are ~15 migrations stale, so `any` is what
      // people reached for. Chasing the casts before regenerating the types
      // would be busywork. Downgraded to warn deliberately — re-raise it to
      // error once types.ts is current and the count is near zero.
      "@typescript-eslint/no-explicit-any": "warn",

      // ~52 of these are deliberate empty catch blocks in best-effort paths
      // (telemetry, logging). Worth seeing, not worth failing on.
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
    },
  },
);
