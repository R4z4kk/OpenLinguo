import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const NULL_INSTEAD = "Model absence with `T | null`, not undefined.";

export default defineConfig(
  globalIgnores(["**/node_modules/", "**/dist/", "**/coverage/"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  { files: ["**/*.tsx"], extends: [reactHooks.configs.flat["recommended-latest"]] },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-undefined": "error",
      "no-restricted-syntax": [
        "error",
        { selector: "TSUndefinedKeyword", message: NULL_INSTEAD },
        { selector: "TSPropertySignature[optional=true]", message: NULL_INSTEAD },
        { selector: "PropertyDefinition[optional=true]", message: NULL_INSTEAD },
        { selector: ":function > Identifier[optional=true]", message: NULL_INSTEAD },
        { selector: "TSMethodSignature > Identifier[optional=true]", message: NULL_INSTEAD },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  prettier,
);
