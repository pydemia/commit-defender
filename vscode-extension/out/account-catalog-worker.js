"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/accountCatalogWorker.ts
var import_node_child_process = require("node:child_process");
var import_node_os = __toESM(require("node:os"));
var child = (0, import_node_child_process.spawn)(process.argv[2], [
  "app-server",
  "--listen",
  "stdio://",
  "-c",
  'model_provider="openai"',
  "-c",
  "analytics.enabled=false"
], {
  cwd: import_node_os.default.tmpdir(),
  env: process.env,
  shell: false,
  windowsHide: true
});
var buffer = "";
var count = 0;
var nextId = 4;
var models = [];
var cursors = /* @__PURE__ */ new Set();
var finished = false;
function finish(value) {
  if (finished) return;
  finished = true;
  child.stdout.pause();
  child.kill();
  process.stdout.write(JSON.stringify(value) + "\n", () => process.exit(0));
}
function send(id, method, params) {
  child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
}
child.stdin.on("error", () => {
});
child.stderr.resume();
child.on("error", () => finish({ error: "cli-unavailable" }));
child.on("close", () => finish({ error: "catalog-unavailable" }));
child.stdout.on("data", (bytes) => {
  count += bytes.length;
  if (count > 2097152) return finish({ error: "invalid-catalog" });
  buffer += bytes;
  for (let index; (index = buffer.indexOf("\n")) >= 0; ) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    try {
      const value = JSON.parse(line);
      if (value.error) return finish({ error: value.id === 2 ? "auth-unavailable" : "connection-failed" });
      if (value.id === 1) {
        child.stdin.write('{"method":"initialized"}\n');
        send(2, "account/read", { refreshToken: true });
      } else if (value.id === 2) {
        if (value.result?.account?.type !== "chatgpt") return finish({ error: "auth-unavailable" });
        send(3, "account/rateLimits/read", {});
      } else if (value.id === 3) {
        if (!value.result?.rateLimits && !value.result?.rateLimitsByLimitId)
          return finish({ error: "connection-failed" });
        send(nextId, "model/list", { limit: 100, includeHidden: false });
      } else if (value.id === nextId) {
        if (!Array.isArray(value.result?.data)) return finish({ error: "invalid-catalog" });
        models.push(...value.result.data);
        const cursor = value.result.nextCursor;
        if (cursor) {
          if (typeof cursor !== "string" || cursors.has(cursor) || models.length >= 500)
            return finish({ error: "invalid-catalog" });
          cursors.add(cursor);
          nextId++;
          send(nextId, "model/list", { limit: 100, includeHidden: false, cursor });
        } else return finish({ models });
      }
    } catch {
      return finish({ error: "invalid-catalog" });
    }
  }
});
send(1, "initialize", { clientInfo: { name: "commit_defender_catalog", version: "1" } });
