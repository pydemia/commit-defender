import * as vscode from "vscode";
import path from "node:path";
import { realpath } from "node:fs/promises";
import {
  AutomaticReviewScheduler,
  observeAutomaticRepository,
  observeAutomaticFile,
  sourcePathPolicy,
  contentHash,
  type AutomaticRepository,
  type AutomaticTask,
  type AutomaticState,
} from "@gcr/client-core";
import type { ReviewRequest } from "./reviewBackend.js";
import { getAutomaticUserSettings } from "./config.js";
import {
  automaticSettings,
  readAutomaticOverride,
  automaticSelectionKey,
  type AutomaticOverride,
  type AutomaticSettings,
} from "./automaticSettings.js";
import { knowledgeScope } from "./localKnowledge.js";
import type { LocalStoragePorts } from "./localKnowledge.js";
import { readSelection } from "./centralConnection.js";
import { AutomaticStageCheckpoint } from "./automaticStageCheckpoint.js";
interface Root {
  observed: AutomaticRepository;
  settings: AutomaticSettings;
  watches: vscode.Disposable[];
  scanning?: Promise<void>;
  again?: boolean;
  files: Map<string, string | null>;
  profileId: string;
  stageSelection: string;
  stageFingerprint?: string;
  backgroundReady: boolean;
  stagePending: boolean;
}
/** VS Code is an event adapter. The shared scheduler and worker own execution;
 * repository files never grant permission to start automatic model reviews. */
export class AutomaticReviews implements vscode.Disposable {
  private roots = new Map<string, Root>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private generation = 0;
  private disposed = false;
  private observedFiles = new Map<string, string | null>();
  private fileGeneration = new Map<string, number>();
  private editorWrites = new Set<string>();
  private saveReasons = new WeakMap<
    vscode.TextDocument,
    vscode.TextDocumentSaveReason
  >();
  private externalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly poll: ReturnType<typeof setInterval>;
  private readonly scheduler: AutomaticReviewScheduler<ReviewRequest>;
  private readonly checkpoints: AutomaticStageCheckpoint;
  private readonly operations = new Set<Promise<unknown>>();
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly ports: {
      run(
        request: ReviewRequest,
        task: AutomaticTask<ReviewRequest>,
      ): Promise<void | { retryAt?: number; completionConfirmed?: boolean }>;
      busy(): boolean;
      configureHooks?(root: string, settings: AutomaticSettings): Promise<void>;
      pauseHooks?(): Promise<void>;
      backgroundStage?(root: string): boolean;
      backgroundSave?(
        root: string,
        input: {
          file: string;
          hash?: string | null;
          reason: "manual" | "auto" | "external" | "dirty";
        },
      ): Promise<false | { status: string }>;
      /** Test port; never read from workspace settings. */
      debounceMs?: number;
      now?: () => number;
      storage?: LocalStoragePorts;
      state(state: AutomaticState): void;
    },
  ) {
    this.checkpoints = new AutomaticStageCheckpoint(ports.storage);
    this.scheduler = new AutomaticReviewScheduler({
      now: ports.now,
      busy: ports.busy,
      onState: ports.state,
      run: async (task) => {
        const result = await ports.run(task.value, task);
        if (
          !result?.retryAt &&
          task.isCurrent() &&
          task.value.automatic?.reason === "stage"
        ) {
          if (result?.completionConfirmed !== true)
            throw new Error("Automatic review completion was not confirmed.");
          const root = this.roots.get(task.value.repoRoot);
          if (root)
            await this.checkpoints.acknowledge(
              task.value.repoRoot,
              root.profileId,
              root.stageSelection,
              task.value.automatic.indexFingerprint!,
            );
        }
        if (
          !result?.retryAt &&
          task.isCurrent() &&
          task.value.automatic?.reason === "save"
        ) {
          const root = this.roots.get(task.value.repoRoot);
          for (const [file, hash] of Object.entries(
            task.value.automatic.files ?? {},
          ))
            if (root?.files.get(file) === hash) root.files.delete(file);
        }
        return result;
      },
    });
    this.subscriptions.push(
      vscode.workspace.onWillSaveTextDocument((e) => {
        this.saveReasons.set(e.document, e.reason);
        this.editorWrites.add(e.document.uri.toString());
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        const reason = this.saveReasons.get(document);
        this.saveReasons.delete(document);
        if (document.uri.scheme === "file")
          void this.track(
            this.saved(
              document.uri,
              reason === vscode.TextDocumentSaveReason.Manual
                ? "manual"
                : "auto",
            ),
          ).finally(() => this.editorWrites.delete(document.uri.toString()));
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!e.document.isDirty || !e.contentChanges.length) return;
        for (const [root, value] of this.roots)
          if (e.document.uri.fsPath.startsWith(root + path.sep)) {
            const file = path
              .relative(root, e.document.uri.fsPath)
              .split(path.sep)
              .join("/");
            if (value.backgroundReady && this.ports.backgroundSave)
              void this.track(
                this.ports.backgroundSave(root, { file, reason: "dirty" }),
              ).catch(() => {
                this.ports.state({
                  key: root,
                  phase: "failed",
                  reason: "background-save-unavailable",
                });
              });
            if (!value.files.has(file)) continue;
            value.files.delete(file);
            this.scheduler.cancel(this.key(root, "save"));
            if (value.files.size) this.submitSave(root, value);
          }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refresh();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        void this.refresh();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          [
            "runOnSave",
            "runOnStage",
            "runOnCommit",
            "runOnPush",
            "serviceNodePath",
            "hookReviewWaitSeconds",
            "reviewReasoningEffort",
            "reviewAutoSaves",
            "reviewExternalChanges",
            "automaticReviewsPaused",
            "automaticSaveIntervalSeconds",
            "automaticReviewsPerHour",
            "localProfile",
            "reviewMode",
            "model",
            "aiProvider",
            "codexPath",
            "excludePatterns",
          ].some((k) => e.affectsConfiguration(`commitDefender.${k}`))
        )
          void this.refresh();
      }),
      vscode.window.onDidChangeWindowState((e) => {
        if (e.focused) {
          if (!this.roots.size) void this.refresh();
          for (const root of this.roots.keys()) void this.scan(root);
          this.scheduler.wake();
        }
      }),
      vscode.commands.registerCommand(
        "commitDefender.manageAutomaticReviews",
        () => this.manage(),
      ),
    );
    this.poll = setInterval(() => {
      for (const root of this.roots.keys()) void this.scan(root);
    }, 30000);
    this.poll.unref?.();
    void this.refresh();
  }
  private profile() {
    return (
      vscode.workspace
        .getConfiguration("commitDefender")
        .inspect<string>("localProfile")?.globalValue ?? "default"
    );
  }
  private key(root: string, reason: "save" | "stage") {
    return `${this.profile()}\0${root}\0${reason}`;
  }
  private excludes() {
    return (
      vscode.workspace
        .getConfiguration("commitDefender")
        .get<string[]>("excludePatterns") ?? []
    );
  }
  private settings(root: string) {
    return automaticSettings(
      getAutomaticUserSettings(),
      readAutomaticOverride(
        this.context.globalState,
        knowledgeScope({
          repoRoot: root,
          profileId: this.profile(),
          scope: "repository",
        }),
      ),
    );
  }
  private track<T>(operation: Promise<T>) {
    this.operations.add(operation);
    void operation.then(
      () => this.operations.delete(operation),
      () => this.operations.delete(operation),
    );
    return operation;
  }
  refresh() {
    return this.track(this.refreshRoots());
  }
  private async refreshRoots() {
    const generation = ++this.generation;
    this.scheduler.clear();
    for (const root of this.roots.values())
      root.watches.forEach((w) => w.dispose());
    this.roots.clear();
    for (const timer of this.externalTimers.values()) clearTimeout(timer);
    this.externalTimers.clear();
    if (this.disposed) return;
    if (
      !vscode.workspace.isTrusted ||
      getAutomaticUserSettings()("automaticReviewsPaused") === true
    ) {
      try {
        await this.ports.pauseHooks?.();
      } catch {
        this.ports.state({
          key: "hooks",
          phase: "failed",
          reason: "hook-revocation-failed",
        });
      }
    }
    if (!vscode.workspace.isTrusted) return;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== "file") continue;
      try {
        const observed = await observeAutomaticRepository(
          folder.uri.fsPath,
          this.excludes(),
        );
        if (generation !== this.generation || this.disposed) return;
        const registered = await this.register(observed);
        if (!registered || generation !== this.generation || this.disposed)
          return;
        try {
          await this.ports.configureHooks?.(observed.root, registered.settings);
          registered.backgroundReady = true;
          if (this.ports.backgroundStage?.(observed.root))
            this.scheduler.cancel(this.key(observed.root, "stage"));
          else if (registered.stagePending)
            this.submitStage(observed.root, registered);
        } catch {
          this.ports.state({
            key: observed.root,
            phase: "failed",
            reason: "hook-configuration-failed",
          });
        }
      } catch {
        /* No repository or temporarily changing metadata. A later workspace refresh can retry. */
      }
    }
  }
  private async register(observed: AutomaticRepository) {
    if (this.roots.has(observed.root)) return this.roots.get(observed.root)!;
    const generation = this.generation;
    const settings = this.settings(observed.root);
    const profileId = this.profile();
    const scope = knowledgeScope({
      repoRoot: observed.root,
      profileId,
      scope: "repository",
    });
    const user = getAutomaticUserSettings();
    const stageSelection = contentHash({
      profileId,
      stage: settings.stage,
      paused: settings.paused,
      excludes: this.excludes(),
      execution: Object.fromEntries(
        [
          "reviewMode",
          "model",
          "aiProvider",
          "codexPath",
          "reviewReasoningEffort",
        ].map((key) => [key, user(key) ?? null]),
      ),
      connection: readSelection(this.context.globalState, scope) ?? null,
    });
    let pending: boolean;
    try {
      pending = await this.checkpoints.observe(
        observed,
        profileId,
        stageSelection,
        settings.stage && !settings.paused,
        () => generation === this.generation && !this.disposed,
      );
    } catch (error) {
      if (!this.disposed && generation === this.generation)
        this.ports.state({
          key: this.key(observed.root, "stage"),
          phase: "waiting",
          reason: "stage-observation-unavailable",
        });
      throw error;
    }
    if (generation !== this.generation || this.disposed) return;
    if (this.roots.has(observed.root)) return this.roots.get(observed.root)!;
    const value: Root = {
      observed,
      settings,
      watches: [],
      files: new Map(),
      profileId,
      stageSelection,
      backgroundReady: !this.ports.configureHooks,
      stagePending: pending,
    };
    this.roots.set(observed.root, value);
    if (settings.paused || (!settings.save && !settings.stage)) return value;
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(observed.indexPath)),
        path.basename(observed.indexPath),
      ),
      false,
      false,
      false,
    );
    const scan = () => {
      void this.scan(observed.root);
    };
    value.watches.push(
      watcher,
      watcher.onDidChange(scan),
      watcher.onDidCreate(scan),
      watcher.onDidDelete(scan),
    );
    if (settings.save && settings.external) {
      const files = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(observed.root), "**/*"),
        false,
        false,
        false,
      );
      const changed = (uri: vscode.Uri) => {
        if (
          sourcePathPolicy(this.excludes())(
            path.relative(observed.root, uri.fsPath).split(path.sep).join("/"),
          )
        )
          return;
        const key = uri.toString();
        clearTimeout(this.externalTimers.get(key));
        const timer = setTimeout(() => {
          this.externalTimers.delete(key);
          if (!this.editorWrites.has(key))
            void this.track(this.saved(uri, "external"));
        }, 3000);
        timer.unref?.();
        this.externalTimers.set(key, timer);
      };
      value.watches.push(
        files,
        files.onDidChange(changed),
        files.onDidCreate(changed),
        files.onDidDelete(changed),
      );
    }
    if (pending) this.submitStage(observed.root, value);
    // Recheck after installing the watcher: the index may have changed while
    // opening the encrypted checkpoint or while the host was suspended.
    void this.scan(observed.root);
    return value;
  }
  private scan(root: string): Promise<void> {
    const state = this.roots.get(root);
    if (
      !state ||
      state.settings.paused ||
      (!state.settings.save && !state.settings.stage)
    )
      return Promise.resolve();
    if (state.scanning) {
      state.again = true;
      return state.scanning;
    }
    state.scanning = (async () => {
      do {
        state.again = false;
        try {
          const observed = await observeAutomaticRepository(
            root,
            this.excludes(),
          );
          if (this.roots.get(root) !== state || this.disposed) return;
          const previous = state.observed;
          const pending = await this.checkpoints.observe(
            observed,
            state.profileId,
            state.stageSelection,
            state.settings.stage,
            () => this.roots.get(root) === state && !this.disposed,
          );
          if (this.roots.get(root) !== state || this.disposed) return;
          state.observed = observed;
          state.stagePending = pending;
          if (previous.head !== observed.head) {
            this.scheduler.cancel(this.key(root, "save"));
            state.files.clear();
          }
          if (previous.fingerprint !== observed.fingerprint) {
            this.scheduler.cancel(this.key(root, "stage"));
            state.stageFingerprint = undefined;
          }
          if (state.settings.stage && pending) this.submitStage(root, state);
        } catch {
          if (!this.disposed && this.roots.get(root) === state)
            this.ports.state({
              key: this.key(root, "stage"),
              phase: "waiting",
              reason: "source-unavailable",
            });
        }
      } while (state.again && this.roots.get(root) === state);
    })().finally(() => {
      state.scanning = undefined;
    });
    return state.scanning;
  }
  private async saved(uri: vscode.Uri, reason: "manual" | "auto" | "external") {
    if (
      this.disposed ||
      !vscode.workspace.isTrusted ||
      !vscode.workspace.getWorkspaceFolder(uri)
    )
      return;
    const generation = this.generation,
      fileKey = uri.toString(),
      fileGeneration = (this.fileGeneration.get(fileKey) ?? 0) + 1;
    this.fileGeneration.set(fileKey, fileGeneration);
    try {
      let absolute = path.resolve(uri.fsPath);
      let root = [...this.roots.keys()]
        .filter((r) => absolute.startsWith(r + path.sep))
        .sort((a, b) => b.length - a.length)[0];
      if (!root) {
        const directory = await realpath(path.dirname(absolute));
        absolute = path.join(directory, path.basename(absolute));
        const observed = await observeAutomaticRepository(
          directory,
          this.excludes(),
        );
        if (generation !== this.generation) return;
        root = observed.root;
        const registered = await this.register(observed);
        if (!registered || generation !== this.generation || this.disposed)
          return;
        try {
          await this.ports.configureHooks?.(observed.root, registered.settings);
          registered.backgroundReady = true;
        } catch {
          this.ports.state({
            key: observed.root,
            phase: "failed",
            reason: "hook-configuration-failed",
          });
        }
      }
      const state = this.roots.get(root)!;
      if (
        state.settings.paused ||
        !state.settings.save ||
        !state.backgroundReady
      )
        return;
      const file = path.relative(root, absolute).split(path.sep).join("/");
      await this.scan(root);
      const observed = await observeAutomaticFile(root, file, this.excludes());
      if (
        generation !== this.generation ||
        this.fileGeneration.get(fileKey) !== fileGeneration ||
        !observed
      )
        return;
      const previous = this.observedFiles.get(fileKey);
      this.observedFiles.set(fileKey, observed.hash);
      if (previous === observed.hash) return;
      const background = await this.ports.backgroundSave?.(root, {
        file,
        hash: observed.hash,
        reason: vscode.workspace.textDocuments.some(
          (d) => d.uri.toString() === uri.toString() && d.isDirty,
        )
          ? "dirty"
          : reason,
      });
      if (background) {
        if (background.status === "pending")
          this.ports.state({
            key: this.key(root, "save"),
            phase: "waiting",
            reason: "background-save",
          });
        return;
      }
      const settings = state.settings;
      if (
        settings.paused ||
        !settings.save ||
        (reason === "auto" && !settings.autoSave) ||
        (reason === "external" && !settings.external)
      )
        return;
      if (previous === observed.hash) return;
      if (!observed.changed) {
        state.files.delete(file);
        this.scheduler.cancel(this.key(root, "save"));
        if (state.files.size) this.submitSave(root, state);
        return;
      }
      if (
        vscode.workspace.textDocuments.some(
          (d) => d.uri.toString() === uri.toString() && d.isDirty,
        )
      )
        return;
      state.files.set(file, observed.hash);
      this.submitSave(root, state);
    } catch {
      if (this.ports.backgroundSave)
        this.ports.state({
          key: fileKey,
          phase: "failed",
          reason: "background-save-unavailable",
        });
      /* Unreadable, ignored, deleted parent or no Git root: no model request. */
    }
  }
  private submitStage(root: string, state: Root) {
    if (!state.backgroundReady || this.ports.backgroundStage?.(root)) return;
    const observed = state.observed;
    if (
      state.stageFingerprint === observed.fingerprint ||
      !observed.changes.length
    )
      return;
    state.stageFingerprint = observed.fingerprint;
    this.scheduler.submit(
      this.key(root, "stage"),
      {
        repoRoot: root,
        files: observed.changes.map((c) => c.path),
        scope: "staged",
        automatic: {
          reason: "stage",
          head: observed.head,
          indexFingerprint: observed.fingerprint,
          minimumIntervalMs: 0,
          maximumReviewsPerHour: state.settings.maximumReviewsPerHour,
        },
      },
      { priority: 1, debounceMs: this.ports.debounceMs ?? 3000 },
    );
  }
  private submitSave(root: string, state: Root) {
    this.scheduler.submit(
      this.key(root, "save"),
      {
        repoRoot: root,
        files: [...state.files.keys()],
        scope: "selection",
        automatic: {
          reason: "save",
          head: state.observed.head,
          files: Object.fromEntries(state.files),
          minimumIntervalMs: state.settings.minimumSaveIntervalMs,
          maximumReviewsPerHour: state.settings.maximumReviewsPerHour,
        },
      },
      { debounceMs: this.ports.debounceMs ?? 3000 },
    );
  }
  private async manage() {
    const choices = [...this.roots.keys()].map((root) => ({
      label: path.basename(root),
      description: root,
      root,
    }));
    const selected = await vscode.window.showQuickPick(choices, {
      title: "Automatic reviews: choose repository/worktree",
    });
    if (!selected) return;
    const scope = knowledgeScope({
      repoRoot: selected.root,
      profileId: this.profile(),
      scope: "repository",
    });
    const key = automaticSelectionKey(scope);
    const settings = this.settings(selected.root);
    const choices2 = (
      [
        "save",
        "stage",
        "commit",
        "push",
        "autoSave",
        "external",
        "paused",
      ] as const
    ).map((field) => ({
      field,
      label: `${settings[field] ? "$(check)" : "$(circle-large-outline)"} ${{ save: "Review saved changes", stage: "Review staged changes", commit: "Review commits in the background", push: "Review pushes in the background", autoSave: "Include Auto Save", external: "Include external file changes", paused: "Pause automatic reviews in this worktree" }[field]}`,
    }));
    const choice = await vscode.window.showQuickPick(
      [
        ...choices2,
        {
          field: "reset" as const,
          label: "Use global User Settings for this worktree",
        },
        { field: "pauseAll" as const, label: "Pause all automatic reviews" },
      ],
      {
        title: `Automatic reviews: ${selected.label}`,
        placeHolder:
          "Saved in extension user state; manual review remains available",
      },
    );
    if (!choice) return;
    if (choice.field === "pauseAll")
      await vscode.workspace
        .getConfiguration("commitDefender")
        .update(
          "automaticReviewsPaused",
          true,
          vscode.ConfigurationTarget.Global,
        );
    else if (choice.field === "reset")
      await this.context.globalState.update(key, undefined);
    else {
      const current = readAutomaticOverride(this.context.globalState, scope);
      await this.context.globalState.update(key, {
        ...current,
        version: 1,
        [choice.field]: !settings[choice.field],
      } satisfies AutomaticOverride);
    }
    await this.refresh();
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    clearInterval(this.poll);
    this.scheduler.dispose();
    for (const v of this.roots.values()) v.watches.forEach((w) => w.dispose());
    for (const timer of this.externalTimers.values()) clearTimeout(timer);
    this.subscriptions.forEach((s) => s.dispose());
  }
  async settled() {
    await Promise.allSettled([...this.operations]);
    await this.scheduler.settled();
    await Promise.allSettled([...this.roots.values()].map((r) => r.scanning));
  }
}
