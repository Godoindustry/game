import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // useEffect(() => expr) devolve o valor de expr ao React. Ex.: scrollIntoView() hoje retorna Promise
      // e isso quebrou a tela do jogo. Sempre use corpo em bloco.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name=/^use(Layout)?Effect$/] > ArrowFunctionExpression[expression=true]",
          message: "useEffect deve ter corpo em bloco { } — não retorne o valor de uma expressão.",
        },
      ],
    },
  },
  // scripts/ são utilitários Node executados direto (node --env-file ...), em CommonJS.
  {
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "_conflito/**",
  ]),
]);

export default eslintConfig;
