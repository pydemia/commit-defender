import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  callLocalService,
  defaultLocalDataDirectory,
  ServiceJobs,
  contentHash,
  type ServiceRegistration,
} from "@gcr/client-core";
import { configureManagedHooks } from "./hook/managedHooks.js";
import type { AutomaticSettings } from "./automaticSettings.js";
import type { StandaloneReviewSettings } from "./standaloneReviewProtocol.js";
import type { SelectionStore } from "./centralConnection.js";
const key = "background-hooks.v1";
interface Owned {
  root: string;
  profileId: string;
  dataDirectory: string;
  configHash?: string;
}
const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
async function privateCopy(source: string, directory: string, name: string) {
  const bytes = await fs.readFile(source),
    targetDir = path.join(directory, hash(bytes));
  await fs.mkdir(targetDir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(targetDir);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077
  )
    throw Error("Service installation directory is not private.");
  const target = path.join(targetDir, name);
  try {
    await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const installed = await fs.lstat(target);
  if (
    !installed.isFile() ||
    installed.isSymbolicLink() ||
    hash(await fs.readFile(target)) !== hash(bytes)
  )
    throw Error("Installed service artifact does not match this extension.");
  return target;
}
/** Explicit extension-owned grants survive host exit; repository settings cannot create them. */
export class BackgroundHooks {
  private epoch = 0;
  private generations = new Map<string, number>();
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly extensionPath: string,
    private readonly store: SelectionStore,
  ) {}
  private serial<T>(work: () => Promise<T>) {
    const next = this.pending.then(work, work);
    this.pending = next.catch(() => undefined);
    return next;
  }
  private owned() {
    return this.store.get<Owned[]>(key) ?? [];
  }
  private async disable(owned: Owned) {
    const location = {
      profileId: owned.profileId,
      dataDirectory: owned.dataDirectory,
    };
    let registration: ServiceRegistration | null;
    try {
      registration = (await callLocalService(location, {
        action: "registration",
        root: owned.root,
      })) as ServiceRegistration | null;
      if (registration)
        await callLocalService(location, {
          action: "register",
          root: owned.root,
          triggers: registration.triggers.filter(
            (t) => !["commit", "push"].includes(t),
          ),
          options: registration.options,
        });
    } catch (error) {
      if ((error as { code?: string }).code !== "service-unavailable")
        throw error;
      // Persist revocation when the daemon is stopped; a later start cannot revive the grant.
      const jobs = await ServiceJobs.open({
        scope: { kind: "profile", profileId: owned.profileId },
        dataDirectory: owned.dataDirectory,
      });
      let owner: string | undefined;
      try {
        owner = await jobs.acquireOwner();
        registration =
          (await jobs.registrations()).find((r) => r.root === owned.root) ??
          null;
        if (registration)
          await jobs.register(
            owned.root,
            registration.triggers.filter(
              (t) => !["commit", "push"].includes(t),
            ),
            registration.options,
          );
      } finally {
        try {
          if (owner) await jobs.releaseOwner(owner);
        } finally {
          jobs.close();
        }
      }
    }
    await configureManagedHooks({
      root: owned.root,
      adapter: path.join(this.extensionPath, "out/advisory-hook.cjs"),
    });
    await this.store.update(
      key,
      this.owned().filter(
        (row) => row.root !== owned.root || row.profileId !== owned.profileId,
      ),
    );
  }
  pauseAll() {
    this.epoch++;
    return this.serial(async () => {
      for (const row of this.owned()) await this.disable(row);
    });
  }
  async status() {
    const result = [];
    for (const owned of this.owned()) {
      const location = {
        profileId: owned.profileId,
        dataDirectory: owned.dataDirectory,
      };
      const registration = (await callLocalService(location, {
        action: "registration",
        root: owned.root,
      })) as ServiceRegistration | null;
      const status = (await callLocalService(location, {
        action: "status",
      })) as {
        jobs: Array<{
          id: string;
          repository: string;
          state: string;
          notBefore?: number;
          result?: { status: string; runId?: string };
        }>;
      };
      for (const job of status.jobs.filter(
        (job) => job.repository === registration?.key,
      ))
        result.push({ root: owned.root, ...job });
    }
    return result;
  }
  configure(
    root: string,
    automatic: AutomaticSettings,
    settings: StandaloneReviewSettings,
    nodePath: string,
    waitMs: number,
  ) {
    const generation = (this.generations.get(root) ?? 0) + 1,
      epoch = this.epoch;
    this.generations.set(root, generation);
    const current = () =>
      epoch === this.epoch && this.generations.get(root) === generation;
    return this.serial(async () => {
      if (!current()) return;
      let old = this.owned().find((row) => row.root === root);
      const configHash = contentHash({ automatic, settings, nodePath, waitMs });
      if (old && old.configHash !== configHash) {
        await this.disable(old);
        old = undefined;
      }
      const triggers: Array<"commit" | "push"> = automatic.paused
        ? []
        : [
            ...(automatic.commit ? ["commit" as const] : []),
            ...(automatic.push ? ["push" as const] : []),
          ];
      if (!triggers.length || (old?.profileId !== settings.profileId && old)) {
        if (old) await this.disable(old);
        if (!triggers.length) return;
      }
      if (
        !settings.workspaceTrusted ||
        settings.provider !== "codex" ||
        settings.model !== "gpt-6-astra" ||
        settings.reasoningEffort !== "xhigh" ||
        !["standalone", "centralized"].includes(settings.mode) ||
        (settings.mode === "centralized" &&
          (!settings.connectionId || settings.freshness !== "online"))
      ) {
        if (old && this.owned().some((row) => row.root === root))
          await this.disable(old);
        throw Error(
          "Background reviews require trusted user-selected Codex gpt-6-astra/xhigh settings and an online central connection when selected.",
        );
      }
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
      const node = JSON.parse(
        (
          await promisify(execFile)(
            nodePath,
            [
              "-p",
              'JSON.stringify({path:process.execPath,major:Number(process.versions.node.split(".")[0])})',
            ],
            { cwd: os.homedir(), env, timeout: 10000 },
          )
        ).stdout,
      );
      if (node.major < 22 || !path.isAbsolute(node.path))
        throw Error("Background review service requires Node.js 22 or newer.");
      const dataDirectory = defaultLocalDataDirectory(),
        location = { profileId: settings.profileId, dataDirectory };
      const programs = path.join(dataDirectory, "service-programs");
      await fs.mkdir(programs, { recursive: true, mode: 0o700 });
      const cli = await privateCopy(
        path.join(this.extensionPath, "out/gcr-service/main.mjs"),
        programs,
        "gcr.mjs",
      );
      const adapter = await privateCopy(
        path.join(this.extensionPath, "out/advisory-hook.cjs"),
        programs,
        "advisory.cjs",
      );
      const started = await promisify(execFile)(
        node.path,
        [
          cli,
          "service",
          "start",
          "--profile",
          settings.profileId,
          "--data-dir",
          dataDirectory,
        ],
        { cwd: os.homedir(), env, timeout: 65000 },
      );
      const service = JSON.parse(started.stdout);
      if (service.status !== "running")
        throw Error("Background review service is unavailable.");
      if (!service.features?.includes("review-start-budget-v1"))
        throw Error(
          "Restart this profile’s existing service with the bundled CLI to enable automatic review budgets.",
        );
      const executorPath = path.isAbsolute(settings.executablePath)
        ? settings.executablePath
        : (
            await promisify(execFile)(
              "/usr/bin/which",
              [settings.executablePath],
              { env, cwd: os.homedir(), timeout: 10000 },
            )
          ).stdout.trim();
      const options = {
        mode: settings.mode,
        model: "gpt-6-astra",
        reasoningEffort: "xhigh",
        executorPath,
        ...(settings.connectionId
          ? { connectionId: settings.connectionId }
          : {}),
        excludePatterns: settings.excludePatterns,
        allowPaths: ["**"],
        durationMs: settings.durationMs,
        sourceBytes: 1048576,
        toolCalls: 100,
        maximumReviewsPerHour: automatic.maximumReviewsPerHour,
      };
      const previous = (await callLocalService(location, {
        action: "registration",
        root,
      })) as ServiceRegistration | null;
      if (!current()) return;
      const allowed = [
        ...new Set([
          ...(previous?.triggers.filter(
            (t) => !["commit", "push"].includes(t),
          ) ?? []),
          ...triggers,
        ]),
      ].sort();
      const owned = {
        root,
        profileId: settings.profileId,
        dataDirectory,
        configHash,
      };
      await this.store.update(key, [
        ...this.owned().filter((row) => row.root !== root),
        owned,
      ]);
      try {
        if (!current()) {
          await this.disable(owned);
          return;
        }
        if (
          !previous ||
          contentHash(previous.options) !== contentHash(options) ||
          contentHash([...previous.triggers].sort()) !== contentHash(allowed)
        )
          await callLocalService(location, {
            action: "register",
            root,
            triggers: allowed,
            options,
          });
        if (!current()) {
          await this.disable(owned);
          return;
        }
        await configureManagedHooks({
          root,
          adapter,
          route: { ...location, node: node.path, cli, triggers, waitMs },
        });
      } catch (error) {
        await callLocalService(location, {
          action: "register",
          root,
          triggers:
            previous?.triggers.filter((t) => !["commit", "push"].includes(t)) ??
            [],
          options,
        });
        throw error;
      }
    });
  }
  async settled() {
    await this.pending;
  }
}
