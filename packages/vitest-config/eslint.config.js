import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";

export default defineConfig(eslint.configs.recommended, {
  languageOptions: { globals: globals.node },
});
