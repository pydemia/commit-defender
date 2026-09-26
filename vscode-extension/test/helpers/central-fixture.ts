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
  type LocalKeyStore,
  type CentralCredentialStore,
} from "@gcr/client-core";

/** Task-owned HTTPS publisher; no external credentials or production repositories. */
export async function centralFixture(
  root: string,
  instructions = "CD_CENTRAL_POLICY: inspect source, base and related callers.",
  codeCriterion = false,
  history?: {
    repositoryId: string;
    keyExpiresAt?: string | null;
    respond(url: string): unknown;
    memories?: Extract<CentralKnowledgeBundle,
      { component: "collective" }>["memories"];
  },
) {
  const audience = {
    serverId: "server",
    tenantId: "tenant",
    repositoryId: history?.repositoryId ?? "repository",
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
      criteria: codeCriterion ? [{
        id: "code-criterion", revision: 1, contentHash: contentHash("code-criterion"), sourceContentHash: contentHash("curated-code-rule"),
        document: { title: "Code-derived criterion", topicKey: "sum.correctness", requirement: "CD_CODE_CRITERION: verify the current arithmetic contract.", rationale: "A prior central change is evidence to inspect current behavior.", counterEvidence: ["Different endpoint or deliberately different contract"], reviewSteps: ["Read source and base"], appliesTo: {languages: [],filePaths: ["sum.ts"],symbols: [],contracts: [],branches: []}, severity: "P2", enforcement: "advisory", reviewAfter: null },
        decision: {id: "central-code-decision",outcome: "design-decision",sources:[{kind:"snapshot-change",id:"central-file-id",contentHash:contentHash("central-code-source")}]}, exceptions: []
      }] : [],
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
      memories: history?.memories ?? [],
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
    compatibleClientContracts: { minimum: codeCriterion ? 3 : 2, maximum: 3 },
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
  const configFile = path.join(root, "tls.cnf");
  fs.writeFileSync(
    configFile,
    "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=Fixture\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n",
  );
  // Keep the disposable TLS private key in the captured pipe, never a file.
  const tlsOutput = execFileSync(
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
      "-",
      "-out",
      "-",
    ],
    { stdio: ["ignore", "pipe", "ignore"], timeout: 15000,
      encoding: "utf8", windowsHide: true },
  );
  const tlsKey = tlsOutput.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/)?.[0];
  const tlsCert = tlsOutput.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
  if (!tlsKey || !tlsCert) throw Error("Local TLS fixture generation failed");
  const requestMethods: string[] = [];
  const requestMetadata: Array<{ method: string; route: string;
    queryKeys: string[]; bodyBytes: number }> = [];
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
  const server = createServer(
    { key: tlsKey, cert: tlsCert },
    (req, res) => {
      calls++;
      requestMethods.push(req.method ?? "");
      const observed = new URL(req.url ?? "/", "https://fixture.invalid");
      const metadata = { method: req.method ?? "", route: observed.pathname,
        queryKeys: [...observed.searchParams.keys()], bodyBytes: 0 };
      requestMetadata.push(metadata);
      req.on("data", (chunk: Buffer) => { metadata.bodyBytes += chunk.length; });
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
      if (history && req.method === 'GET' && req.url?.startsWith(`/base/api/v1/repositories/${audience.repositoryId}/review-history`)) {
        res.end(JSON.stringify(history.respond(req.url))); return;
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
            scopes: ["knowledge:read"],
            clientId,
            keyId,
            expiresAt: history?.keyExpiresAt === null ? null : new Date(now + 7200_000).toISOString(),
          }),
        );
        return;
      }
      if (/\/manifest\?clientContractVersion=[23]$/.test(req.url ?? "")) {
        if (codeCriterion && req.url?.endsWith("=2")) {res.writeHead(426);res.end();return;}
        if (firstManifestFailure) {
          firstManifestFailure = false;
          res.writeHead(403);
          res.end("{}");
          return;
        }
        res.end(JSON.stringify(manifest));
        return;
      }
      if (
        req.url === `/base/api/v1/client-repositories/${audience.repositoryId}` &&
        req.method === "GET"
      ) {
        res.end(
          JSON.stringify({
            schemaVersion: 1,
            ...audience,
            userId: undefined,
            instanceId: "github",
            webBaseUrl: "https://github.example",
            owner: "team",
            name: "reviewer",
          }),
        );
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
    get requestMethods() { return [...requestMethods]; },
    get requestMetadata() { return structuredClone(requestMetadata); },
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
      ca: tlsCert,
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
