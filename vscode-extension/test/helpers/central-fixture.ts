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
            scopes: ["knowledge:read"],
            clientId,
            keyId,
            expiresAt: new Date(now + 7200_000).toISOString(),
          }),
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
      const component =
        /\/bundles\/(policy|collective|personal)\?snapshotId=snapshot$/.exec(
          req.url ?? "",
        )?.[1];
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
