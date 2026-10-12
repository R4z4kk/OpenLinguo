import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const NULL_INSTEAD = "Model absence with `T | null`, not undefined.";
const PLAIN_TEXT = "Render text as React children: imported content is never parsed as HTML.";

export default defineConfig(
  globalIgnores([
    "**/node_modules/",
    "**/dist/",
    "**/coverage/",
    "**/test-results/",
    "**/playwright-report/",
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    files: ["**/*.tsx"],
    extends: [reactHooks.configs.flat["recommended-latest"], jsxA11y.configs.strict],
  },
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
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: PLAIN_TEXT },
        { selector: "MemberExpression[property.name=/^(inner|outer)HTML$/]", message: PLAIN_TEXT },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: PLAIN_TEXT,
        },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    ignores: ["packages/core/src/fsrs.ts", "packages/core/src/fsrs.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          name: "ts-fsrs",
          message:
            "Use the @openlinguo/core SRS model: ts-fsrs Dates and undefined stay in fsrs.ts.",
        },
      ],
    },
  },
  prettier,
);
