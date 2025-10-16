/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require("module");

const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "typescript") {
    return originalLoad.call(this, "typescript4", parent, isMain);
  }
  if (request === "rollup-plugin-typescript") {
    return function noopTypescriptPlugin() {
      return {
        name: "noop-typescript",
        transform(code) {
          return { code, map: null };
        },
      };
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
