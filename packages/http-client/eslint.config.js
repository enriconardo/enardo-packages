import { builtinModules } from "node:module";
import { node } from "@enardo/eslint-config";
import globals from "globals";

const NODE_ONLY = "Node only: src/ runs in browsers too.";
const BROWSER_ONLY = "Browsers only: src/ runs on Node too.";
const MISSING_ON_NODE = "Node 24 does not define it: src/ runs on Node too.";
const UNDICI =
  "Node only: src/ runs in browsers too. Node transport settings go through fetchImpl.";

const browserGlobals = Object.keys(globals.browser);
const nodeGlobals = Object.keys(globals.node);

// The keys of `globals.node` that Node 24 does not define, apart from the
// CommonJS module scope. @types/node declares some of them (ErrorEvent, Web
// Storage), so they would pass both runtime typechecks. Check the list again
// when Node, `globals` or @types/node change.
const missingOnNode = [
  "ErrorEvent",
  "QuotaExceededError",
  "Temporal",
  "localStorage",
  "sessionStorage",
  "Storage",
];

const browserOnly = browserGlobals.filter(
  (name) => !nodeGlobals.includes(name) && !missingOnNode.includes(name),
);
const nodeOnly = nodeGlobals.filter(
  (name) => !browserGlobals.includes(name) && !missingOnNode.includes(name),
);

export default [
  ...node(import.meta.dirname),
  {
    // src/ runs unchanged in browsers and on Node (see CLAUDE.md), so it may
    // use only what both runtimes have. tsconfig.browser.json and
    // tsconfig.node.json catch the rest. `undici` is not installed, so its
    // import fails them too. Its rule stays for the message, and because
    // `undici`, installed again, would pull @types/node into the browser
    // program through its types, leaving this lint as the only check.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "undici", message: UNDICI },
            ...builtinModules
              .filter((name) => !name.startsWith("node:"))
              .map((name) => ({ name, message: NODE_ONLY })),
          ],
          patterns: [
            { group: ["node:*"], message: NODE_ONLY },
            { group: ["undici/*"], message: UNDICI },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          globals: [
            ...browserOnly.map((name) => ({ name, message: BROWSER_ONLY })),
            ...nodeOnly.map((name) => ({ name, message: NODE_ONLY })),
            ...missingOnNode.map((name) => ({
              name,
              message: MISSING_ON_NODE,
            })),
          ],
          checkGlobalObject: true,
        },
      ],
    },
  },
];
