import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { defaultLocalDataDirectory } from "@gcr/client-core";
import {
  windowsPrivateDirectory, windowsReadPrivateFile,
  windowsWritePrivateFile, windowsRemovePrivateFile,
} from "../windowsPrivateFiles.js";

export interface HookRoute {
  profileId: string;
  dataDirectory: string;
  node: string;
  cli: string;
  triggers: Array<"commit" | "push">;
  waitMs: number;
}
export interface ManagedHookState {
  version: 1;
  config: string;
  directory: string;
  original: string;
  previous: string[];
  files: Record<string, string>;
  routes: Record<string, HookRoute>;
  attached: boolean;
}
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const quote = (value: string) => {
  const shellPath = process.platform === "win32"
    ? value.replace(/\\/g, "/") : value;
  return `'${shellPath.replace(/'/g, "'\\''")}'`;
};
function git(root: string, args: string[], missing = false) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_")) delete env[key];
  try {
    return execFileSync("git", ["-C", root, ...args], {
      env,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 15000,
      windowsHide: true,
    }).trimEnd();
  } catch (error) {
    if (missing && (error as { status?: number }).status === 1)
      return undefined;
    throw new Error("Git hook configuration unavailable.");
  }
}
async function privateDirectory(directory: string) {
  if (process.platform === "win32") return windowsPrivateDirectory(directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077
  )
    throw new Error(
      "Hook storage must be a private directory owned by this OS user.",
    );
  return fs.realpath(directory);
}
async function writeJson(file: string, value: unknown) {
  if (process.platform === "win32") {
    await windowsWritePrivateFile(file,
      Buffer.from(JSON.stringify(value, null, 2) + "\n"), true);
    return;
  }
  const tmp = `${file}.${randomUUID()}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
async function readState(file: string): Promise<ManagedHookState | undefined> {
  try {
    const bytes = process.platform === "win32" ? await windowsReadPrivateFile(file) : undefined;
    if (process.platform === "win32" && !bytes) return;
    const stat = await fs.lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (process.platform !== "win32" &&
        (stat.uid !== process.getuid?.() || stat.mode & 0o077)) ||
      stat.size > 1048576
    )
      throw Error("Invalid hook state.");
    const state = JSON.parse(
      bytes ? bytes.toString("utf8") : await fs.readFile(file, "utf8"),
    ) as ManagedHookState;
    if (
      state.version !== 1 ||
      !state.routes ||
      !state.files ||
      !Array.isArray(state.previous)
    )
      throw Error("Invalid hook state.");
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
async function lock(directory: string) {
  const file = path.join(directory, "owner.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (process.platform === "win32") {
        const published = await windowsWritePrivateFile(
          file, Buffer.from(JSON.stringify({ pid: process.pid })),
        );
        if (!published) throw Object.assign(Error("Lock exists."), { code: "EEXIST" });
        return async () => { windowsRemovePrivateFile(file); };
      }
      const handle = await fs.open(file, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      await handle.close();
      return () => fs.unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const readLock = async () => process.platform === "win32"
        ? (await windowsReadPrivateFile(file))?.toString("utf8") ?? ""
        : fs.readFile(file, "utf8");
      const raw = await readLock(),
        row = JSON.parse(raw);
      if (!Number.isSafeInteger(row.pid) || row.pid < 1)
        throw Error("Hook installation lock is invalid.");
      try {
        process.kill(row.pid, 0);
        throw Error("Another hook installation is active.");
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== "ESRCH") throw failure;
      }
      if ((await readLock()) !== raw)
        throw Error("Hook installation lock changed.");
      if (process.platform === "win32") windowsRemovePrivateFile(file);
      else await fs.unlink(file);
    }
  }
  throw Error("Hook installation is busy.");
}
const hookNames = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-receive",
  "update",
  "proc-receive",
  "post-receive",
  "post-update",
  "reference-transaction",
  "push-to-checkout",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "p4-changelist",
  "p4-prepare-changelist",
  "p4-post-changelist",
  "p4-pre-submit",
  "post-index-change",
];
async function location(root: string, dataDirectory: string) {
  root = await fs.realpath(git(root, ["rev-parse", "--show-toplevel"])!);
  const worktree =
    git(
      root,
      ["config", "--bool", "--get", "extensions.worktreeConfig"],
      true,
    ) === "true";
  const config = git(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    worktree ? "config.worktree" : "config",
  ])!;
  const base = await privateDirectory(
    path.join(dataDirectory, "managed-hooks"),
  );
  const directory = await privateDirectory(path.join(base, digest(config)));
  return {
    root,
    config,
    directory,
    stateFile: path.join(directory, "state.json"),
  };
}
const configured = (root: string, config: string) => {
  const raw = git(
    root,
    ["config", "--file", config, "--null", "--get-all", "core.hooksPath"],
    true,
  );
  return raw === undefined
    ? []
    : raw.split("\0").filter((_, i, all) => i < all.length - 1);
};
async function verifyFiles(state: ManagedHookState) {
  for (const [name, hash] of Object.entries(state.files)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name))
      throw Error("Invalid managed hook name.");
    const file = path.join(state.directory, name),
      stat = await fs.lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      digest(process.platform === "win32"
        ? await windowsReadPrivateFile(file) ?? Buffer.alloc(0)
        : await fs.readFile(file)) !== hash
    )
      throw Error(
        "A managed hook was changed outside Commit Defender; files were preserved.",
      );
  }
}
export interface ManagedHookOptions {
  root: string;
  storage?: string;
  adapter: string;
  route?: HookRoute;
}
/** Overlay the effective hook directory; never overwrite, rename or delete original hooks.
 * Shared repository config uses per-worktree routes, preserving all other worktrees. */
export async function configureManagedHooks(options: ManagedHookOptions) {
  const loc = await location(
    options.root,
    options.storage ?? defaultLocalDataDirectory(),
  );
  const release = await lock(loc.directory);
  try {
    let state = await readState(loc.stateFile);
    const selected = configured(loc.root, loc.config);
    if (state?.attached) {
      if (
        state.config !== loc.config ||
        state.directory !== loc.directory ||
        selected.length !== 1 ||
        selected[0] !== loc.directory
      )
        throw Error(
          "Git hooksPath changed outside Commit Defender; existing configuration was preserved.",
        );
      await verifyFiles(state);
    }
    if (!options.route && !state?.attached)
      return { status: "not-installed" as const };
    if (!state?.attached) {
      if (state) await verifyFiles(state);
      if (selected.length > 1)
        throw Error(
          "Multiple local hooksPath values require explicit cleanup before installation.",
        );
      const original =
        git(loc.root, ["config", "--path", "--get", "core.hooksPath"], true) ??
        git(loc.root, [
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "hooks",
        ])!;
      if (original === loc.directory)
        throw Error("Unowned hook overlay detected.");
      state = {
        version: 1,
        config: loc.config,
        directory: loc.directory,
        original,
        previous: selected,
        files: state?.files ?? {},
        routes: {},
        attached: false,
      };
    }
    const oldRoute = state.routes[loc.root];
    if (options.route) {
      const route = options.route;
      if (oldRoute && oldRoute.profileId !== route.profileId)
        throw Error(
          "This worktree has hooks registered to another profile. Disable that registration first.",
        );
      if (
        ![route.node, route.cli, route.dataDirectory, options.adapter].every(
          path.isAbsolute,
        ) ||
        !Number.isInteger(route.waitMs) ||
        route.waitMs < 0 ||
        route.waitMs > 600000 ||
        !route.triggers.length ||
        route.triggers.some((t) => !["commit", "push"].includes(t))
      )
        throw Error("Invalid hook route.");
      state.routes[loc.root] = structuredClone(route);
    } else delete state.routes[loc.root];
    if (!Object.keys(state.routes).length) {
      // Disable routing before restoring Git config. Already running wrappers remain usable.
      await writeJson(loc.stateFile, state);
      if (state.previous.length)
        git(loc.root, [
          "config",
          "--file",
          loc.config,
          "--replace-all",
          "core.hooksPath",
          state.previous[0],
        ]);
      else
        git(loc.root, [
          "config",
          "--file",
          loc.config,
          "--unset-all",
          "core.hooksPath",
        ]);
      state.attached = false;
      await writeJson(loc.stateFile, state);
      return { status: "removed" as const };
    }
    const route = options.route ?? Object.values(state.routes)[0];
    const names = new Set(hookNames);
    try {
      for (const name of await fs.readdir(
        path.resolve(loc.root, state.original),
      ))
        if (/^[a-z][a-z0-9-]*$/.test(name)) names.add(name);
    } catch (error) {
      if (
        !["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
    }
    for (const name of names) {
      const original = path.join(state.original, name);
      const text = `#!/bin/sh\n# Commit Defender managed forwarding hook v1\n${["pre-commit", "pre-push"].includes(name) ? `if [ -x ${quote(route.node)} ] && [ -f ${quote(options.adapter)} ]; then\n  exec ${quote(route.node)} ${quote(options.adapter)} ${quote(loc.stateFile)} ${quote(name)} ${quote(original)} "$@"\nfi\n` : ""}if [ -x ${quote(original)} ]; then exec ${quote(original)} "$@"; fi\nexit 0\n`;
      const file = path.join(loc.directory, name);
      if (process.platform === "win32") {
        const published = await windowsWritePrivateFile(
          file, Buffer.from(text), Boolean(state.files[name]),
        );
        if (!published) throw Error("Unowned managed hook file exists.");
      } else if (!state.files[name]) {
        // Never replace an unowned file, even inside our private overlay.
        await fs.writeFile(file, text, { flag: "wx", mode: 0o700 });
      } else {
        const temporary = `${file}.${randomUUID()}`;
        try {
          await fs.writeFile(temporary, text, { flag: "wx", mode: 0o700 });
          await fs.rename(temporary, file);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      }
      state.files[name] = digest(text);
    }
    await writeJson(loc.stateFile, state);
    if (!state.attached) {
      if (
        JSON.stringify(configured(loc.root, loc.config)) !==
        JSON.stringify(state.previous)
      )
        throw Error("Git configuration changed during installation.");
      git(loc.root, [
        "config",
        "--file",
        loc.config,
        "--replace-all",
        "core.hooksPath",
        loc.directory,
      ]);
      state.attached = true;
      await writeJson(loc.stateFile, state);
    }
    if (
      git(loc.root, ["config", "--path", "--get", "core.hooksPath"]) !==
      loc.directory
    )
      throw Error("Another Git scope overrides this hook installation.");
    return {
      status: "installed" as const,
      directory: loc.directory,
      original: state.original,
    };
  } finally {
    await release();
  }
}
