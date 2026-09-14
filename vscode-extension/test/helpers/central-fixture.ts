import { createServer } from "node:https";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  reviewSubmission,
  clientReviewReport,
  type RemoteReviewStatus,
  type RemoteReviewRequest,
  type ReviewSubmission,
  type ReviewSubmissionReceipt,
  type ReviewSubmissionStatus,
  canonicalKnowledgeJson,
  encodeKnowledgeBundle,
  KNOWLEDGE_SIGNATURE_CONTEXT,
  type CentralKnowledgeBundle,
  type KnowledgeManifestPayload,
} from "@gcr/client-contract";
import {
  contentHash,
  prepareRemoteReviewHandle,
  validateRemoteReviewRequest,
  type LocalKeyStore,
  type CentralCredentialStore,
} from "@gcr/client-core";

/** Task-owned HTTPS publisher; no external credentials or production repositories. */
export async function centralFixture(
  root: string,
  instructions = "CD_CENTRAL_POLICY: inspect source, base and related callers.",
) {
  const audience = {
    serverId: "server",
    tenantId: "tenant",
    repositoryId: "repository",
    userId: "alice",
  };
  const signing = generateKeyPairSync("ed25519");
  const keyId = randomUUID(),
    secret = `gcr_key_${keyId}_${randomBytes(32).toString("base64url")}`;
  const common = {
    schemaVersion: 2 as const,
    tenantId: audience.tenantId,
    repositoryId: audience.repositoryId,
  };
  const bundles: Record<
    "policy" | "collective" | "personal",
    CentralKnowledgeBundle
  > = {
    policy: {
      ...common,
      component: "policy",
      ownerUserId: null,
      criteria: [],
      skills: {
        schemaVersion: 1,
        hash: contentHash("skills"),
        skills: Array.from({ length: 4 }, (_, i) => ({
          name: `skill-${i}`,
          title: "Inspect the contract",
          kind: "perspective",
          unit: "file",
          version: 1,
          enabled: true,
          instructions,
          markdown: "# Review",
          contentHash: contentHash(`skill-${i}`),
        })),
      },
    },
    collective: {
      ...common,
      component: "collective",
      ownerUserId: null,
      memories: [],
    },
    personal: {
      ...common,
      component: "personal",
      ownerUserId: audience.userId,
      memories: [],
    },
  };
  const bytes = Object.fromEntries(
    Object.entries(bundles).map(([key, bundle]) => [
      key,
      Buffer.from(encodeKnowledgeBundle(bundle)),
    ]),
  );
  const now = Date.now();
  const payload: KnowledgeManifestPayload = {
    schemaVersion: 1,
    audience,
    snapshotId: "snapshot",
    authorizationRevision: 1,
    components: Object.fromEntries(
      Object.entries(bytes).map(([key, body]) => [
        key,
        {
          bundleId: key,
          releaseSequence: 1,
          contentHash: createHash("sha256").update(body).digest("hex"),
          sizeBytes: body.length,
        },
      ]),
    ) as KnowledgeManifestPayload["components"],
    revocations: {
      policyMinimumSequence: 1,
      collectiveMinimumSequence: 1,
      personalMinimumSequence: 1,
    },
    compatibleClientContracts: { minimum: 2, maximum: 2 },
    issuedAt: new Date(now - 1000).toISOString(),
    refreshAfter: new Date(now + 240_000).toISOString(),
    offlineValidUntil: new Date(now + 3600_000).toISOString(),
    signingKeyId: "key",
  };
  const serialized = canonicalKnowledgeJson(payload);
  const manifest = {
    payload,
    manifestHash: createHash("sha256").update(serialized).digest("hex"),
    signature: sign(
      null,
      Buffer.from(KNOWLEDGE_SIGNATURE_CONTEXT + serialized),
      signing.privateKey,
    ).toString("base64url"),
  };
  const configFile = path.join(root, "tls.cnf"),
    certFile = path.join(root, "tls.crt"),
    keyFile = path.join(root, "tls.key");
  fs.writeFileSync(
    configFile,
    "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=Fixture\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n",
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-config",
      configFile,
      "-keyout",
      keyFile,
      "-out",
      certFile,
    ],
    { stdio: "ignore", timeout: 15000 },
  );
  let firstManifestFailure = false;
  let errorCode: string | undefined;
  let status = 200,
    calls = 0,
    clientId = "commit-defender";
  let submissionStatus = 404;
  const submissions = new Map<
    string,
    { payload: ReviewSubmission; receipt: ReviewSubmissionReceipt }
  >();
  let submissionCalls = 0;
  let reviewStatusCalls = 0,
    reviewStatusCode = 200;
  const decisions = new Map<string, ReviewSubmissionStatus["decision"]>();
  const remote = {
    enabled: false,
    pending: false,
    dropAck: false,
    posts: 0,
    cancels: 0,
    input: null as RemoteReviewRequest | null,
    receipt: null as RemoteReviewStatus | null,
    report: null as ReturnType<typeof clientReviewReport> | null,
  };
  const server = createServer(
    { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
    (req, res) => {
      calls++;
      res.setHeader("content-type", "application/json");
      if (
        req.headers.authorization !== `Bearer ${secret}` ||
        req.headers["x-gcr-server-id"] !== audience.serverId ||
        req.headers.cookie
      ) {
        res.writeHead(403);
        res.end("{}");
        return;
      }
      if (status !== 200) {
        res.writeHead(status);
        res.end(
          JSON.stringify(errorCode ? { error: { code: errorCode } } : {}),
        );
        return;
      }
      if (req.url === "/base/api/v1/client-auth/me") {
        res.end(
          JSON.stringify({
            schemaVersion: 1,
            serverId: audience.serverId,
            tenantId: audience.tenantId,
            userId: audience.userId,
            displayName: "Fixture",
            repositoryIds: [audience.repositoryId],
            scopes: [
              "knowledge:read",
              ...(remote.enabled ? ["ai:invoke"] : []),
            ],
            clientId,
            keyId,
            expiresAt: new Date(now + 7200_000).toISOString(),
          }),
        );
        return;
      }
      if (remote.enabled && req.url?.includes("/remote-reviews")) {
        if (req.url.endsWith("/models")) {
          res.end(
            JSON.stringify({
              schemaVersion: 1,
              audience,
              clientId,
              enabled: true,
              outputTokenLimit: false,
              limits: {
                modelCalls: 10,
                durationMs: 600000,
                uploadBytes: 8388608,
                userHourlyCalls: 60,
                repositoryHourlyCalls: 300,
              },
              models: [
                {
                  accountId: "fixture-account",
                  accountName: "Fixture account",
                  name: "gpt-6-astra",
                  displayName: "Astra",
                  allowedEfforts: ["high", "xhigh"],
                  defaultEffort: "xhigh",
                },
              ],
            }),
          );
          return;
        }
        if (req.method === "POST" && req.url.endsWith("/remote-reviews")) {
          let body = "";
          req.setEncoding("utf8");
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", () => {
            try {
              const input = validateRemoteReviewRequest(JSON.parse(body), {
                audience,
                clientId: "commit-defender",
              });
              remote.posts++;
              remote.input = input;
              if (!remote.receipt) {
                const h = prepareRemoteReviewHandle(input),
                  now = Date.now(),
                  at = new Date(now).toISOString();
                const pin = input.payload.context.resolved?.central?.manifest;
                remote.report = clientReviewReport({
                  contractVersion: 1,
                  runId: "remote-result",
                  identity: {
                    client: h.client,
                    source: h.source,
                    context: {
                      hash: h.contextHash,
                      entries: [],
                      required: [],
                      ...(pin
                        ? {
                            centralSnapshot: {
                              id: pin.payload.snapshotId,
                              hash: pin.manifestHash,
                              audience,
                              authorizationRevision: String(
                                pin.payload.authorizationRevision,
                              ),
                              offlineValidUntil: pin.payload.offlineValidUntil,
                            },
                          }
                        : {}),
                    },
                    reviewProfile: {
                      id: "fixture",
                      revision: 1,
                      hash: contentHash("profile"),
                    },
                    executor: {
                      id: "central",
                      version: "1",
                      model: h.model,
                      configHash: h.executorConfigHash,
                    },
                    toolsHash: contentHash("tools"),
                  },
                  status: "completed",
                  trigger: "manual",
                  requestedAt: at,
                  startedAt: at,
                  finishedAt: at,
                  durationMs: 0,
                  summary:
                    "Synthetic central result; no model was invoked by this UI fixture.",
                  sourceFiles: h.sourceFiles,
                  files: h.selected.map((s) => ({
                    source: h.sourceFiles.find(
                      (f) => f.path === s.path && f.side === s.side,
                    )!,
                    status: "completed",
                    summary: "Fixture",
                  })),
                  excluded: [],
                  problems: [],
                  findings: [],
                  evidence: [],
                  questions: [],
                });
                remote.receipt = {
                  schemaVersion: 1,
                  requestId: h.requestId,
                  audience,
                  clientId: "commit-defender",
                  payloadHash: h.payloadHash,
                  receivedAt: at,
                  sourceExpiresAt: new Date(
                    now + h.sourceSeconds * 1000,
                  ).toISOString(),
                  resultExpiresAt: new Date(
                    now + h.resultSeconds * 1000,
                  ).toISOString(),
                  ...(remote.pending
                    ? { state: "running" as const }
                    : {
                        state: "completed" as const,
                        reportHash: contentHash(remote.report),
                      }),
                };
              }
              if (remote.dropAck) {
                req.socket.destroy();
                return;
              }
              res.writeHead(201).end(JSON.stringify(remote.receipt));
            } catch {
              res.writeHead(400).end("{}");
            }
          });
          return;
        }
        if (!remote.receipt) {
          res.writeHead(404).end("{}");
          return;
        }
        if (req.url.endsWith("/cancel")) {
          remote.cancels++;
          remote.receipt = {
            ...remote.receipt,
            state: "cancelled",
            reason: "cancelled",
          };
        }
        res.end(
          JSON.stringify(
            req.url.endsWith("/result")
              ? { status: remote.receipt, report: remote.report }
              : remote.receipt,
          ),
        );
        return;
      }
      if (req.url?.endsWith("/manifest?clientContractVersion=2")) {
        if (firstManifestFailure) {
          firstManifestFailure = false;
          res.writeHead(403);
          res.end("{}");
          return;
        }
        res.end(JSON.stringify(manifest));
        return;
      }
      const statusId = /\/review-submissions\/([^/]+)\/status$/.exec(
        req.url ?? "",
      )?.[1];
      if (req.method === "GET" && statusId) {
        reviewStatusCalls++;
        const row = [...submissions.values()].find(
          (x) => x.receipt.id === statusId,
        );
        if (!row || reviewStatusCode !== 200) {
          res.writeHead(row ? reviewStatusCode : 404);
          res.end("{}");
          return;
        }
        res.end(
          JSON.stringify({
            schemaVersion: 1,
            receipt: row.receipt,
            checkedAt: new Date().toISOString(),
            decision: decisions.get(row.payload.id) ?? null,
          }),
        );
        return;
      }
      if (
        req.method === "POST" &&
        /\/review-submissions\/(feedback|results)$/.test(req.url ?? "")
      ) {
        submissionCalls++;
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          if (submissionStatus !== 200) {
            res.writeHead(submissionStatus);
            res.end("{}");
            return;
          }
          try {
            const value = reviewSubmission(JSON.parse(body));
            const previous = submissions.get(value.id);
            if (
              previous &&
              previous.receipt.payloadHash !== contentHash(value)
            ) {
              res.writeHead(409);
              res.end("{}");
              return;
            }
            const receipt: ReviewSubmissionReceipt = previous?.receipt ?? {
              schemaVersion: 1,
              id: randomUUID(),
              requestId: value.id,
              payloadHash: contentHash(value),
              audience: value.audience,
              clientId: value.clientId,
              kind: value.kind,
              status: "submitted",
              evidence: "client-reported",
              receivedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
            };
            submissions.set(value.id, { payload: value, receipt });
            res.end(JSON.stringify(receipt));
          } catch {
            res.writeHead(400);
            res.end("{}");
          }
        });
        return;
      }
      const target = new URL(req.url ?? "/", "https://fixture.invalid");
      const component = (["policy", "collective", "personal"] as const).find(
        (key) =>
          target.pathname.endsWith(
            "/bundles/" + payload.components[key].bundleId,
          ) && target.searchParams.get("snapshotId") === payload.snapshotId,
      );
      if (component) {
        res.end(bytes[component]);
        return;
      }
      res.writeHead(404);
      res.end("{}");
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture address");
  const keyValues = new Map<string, Buffer>(),
    credentialValues = new Map<string, string>();
  const keys: LocalKeyStore = {
    async read(id) {
      const value = keyValues.get(id);
      return value && Buffer.from(value);
    },
    async write(id, value) {
      keyValues.set(id, Buffer.from(value));
    },
    async remove(id) {
      keyValues.delete(id);
    },
  };
  const credentials: CentralCredentialStore = {
    async read(id) {
      return credentialValues.get(id);
    },
    async write(id, value) {
      credentialValues.set(id, value);
    },
    async remove(id) {
      credentialValues.delete(id);
    },
  };
  return {
    remote,
    audience,
    submissions,
    get reviewStatusCalls() {
      return reviewStatusCalls;
    },
    setReviewStatus(code: number) {
      reviewStatusCode = code;
    },
    setReviewDecision(id: string, value: ReviewSubmissionStatus["decision"]) {
      decisions.set(id, structuredClone(value));
    },
    publishCriteria(
      criteria: Extract<
        CentralKnowledgeBundle,
        { component: "policy" }
      >["criteria"],
    ) {
      if (bundles.policy.component !== "policy") throw Error("Policy fixture");
      bundles.policy.criteria = structuredClone(criteria);
      bytes.policy = Buffer.from(encodeKnowledgeBundle(bundles.policy));
      const sequence = payload.components.policy.releaseSequence + 1;
      payload.snapshotId = "snapshot-" + sequence;
      payload.components.policy = {
        bundleId: "policy-" + sequence,
        releaseSequence: sequence,
        contentHash: createHash("sha256").update(bytes.policy).digest("hex"),
        sizeBytes: bytes.policy.length,
      };
      const serialized = canonicalKnowledgeJson(payload);
      manifest.manifestHash = createHash("sha256")
        .update(serialized)
        .digest("hex");
      manifest.signature = sign(
        null,
        Buffer.from(KNOWLEDGE_SIGNATURE_CONTEXT + serialized),
        signing.privateKey,
      ).toString("base64url");
      return payload.snapshotId;
    },
    get submissionCalls() {
      return submissionCalls;
    },
    setSubmissionStatus(value: number) {
      submissionStatus = value;
    },
    secret,
    keys,
    credentials,
    credentialValues,
    config: {
      serverUrl: `https://127.0.0.1:${address.port}/base/`,
      serverId: audience.serverId,
      tenantId: audience.tenantId,
      repositoryId: audience.repositoryId,
      trustedKeys: [
        {
          id: "key",
          pem: signing.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        },
      ],
      ca: fs.readFileSync(certFile, "utf8"),
    },
    get calls() {
      return calls;
    },
    setStatus(value: number, code?: string) {
      status = value;
      errorCode = code;
    },
    failFirstManifest() {
      firstManifestFailure = true;
    },
    setClientId(value: string) {
      clientId = value;
    },
    async close() {
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}
