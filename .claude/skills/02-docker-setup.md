# Skill 02 — Docker Setup

## Purpose
Build a self-contained Docker image that bundles Python (commit-defender package), Node.js (eslint, markdownlint), shellcheck, ruff, and git — so the validator runs identically on any machine with Docker installed.

---

## Architecture: Multi-stage build

```
Stage 1 (builder)     python:3.12-slim  →  install uv + commit_defender package
Stage 2 (node-tools)  node:20-slim      →  eslint + markdownlint-cli2
Stage 3 (final)       python:3.12-slim  →  copy all artifacts, add git + shellcheck
```

Why multi-stage? The final image only needs runtime artifacts — no build tools, no npm cache, no uv install overhead.

---

## Dockerfile key sections

### Stage 1 — Python builder
```dockerfile
FROM python:3.12-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /build
COPY pyproject.toml .
COPY commit_defender/ ./commit_defender/
RUN uv pip install --system --no-cache .
```

### Stage 2 — Node tools
```dockerfile
FROM node:20-slim AS node-tools
RUN npm install -g eslint@9 @eslint/js markdownlint-cli2 --no-fund --loglevel=error
```

### Stage 3 — Final image
```dockerfile
FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git shellcheck \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir ruff
COPY --from=builder /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=node-tools /usr/local/bin/node /usr/local/bin/node
COPY --from=node-tools /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/eslint/bin/eslint.js /usr/local/bin/eslint
COPY commit_defender/ /app/commit_defender/
WORKDIR /app
ENTRYPOINT ["python", "-m", "commit_defender.entrypoint"]
```

---

## Build the image

```bash
docker build -t commit-defender:latest .
```

For development (rebuild on source changes, cache Python layer):
```bash
docker build --target builder -t commit-defender:builder .
docker build -t commit-defender:dev .
```

---

## Test the container manually (without a real commit)

```bash
# Point at any git repo on your machine
export CD_TARGET_REPO=/path/to/some-repo
export ANTHROPIC_API_KEY=sk-ant-...

# Simulate staged files
export CD_STAGED_FILES="src/main.py"

docker run --rm \
  -v "${CD_TARGET_REPO}:/repo:ro" \
  -e ANTHROPIC_API_KEY \
  -e CD_STAGED_FILES \
  commit-defender:latest

# Skip AI (offline test)
CD_SKIP_AI=1 docker run --rm \
  -v "${CD_TARGET_REPO}:/repo:ro" \
  -e CD_STAGED_FILES \
  commit-defender:latest

# Dry run (always exits 0)
CD_DRY_RUN=1 docker run --rm \
  -v "${CD_TARGET_REPO}:/repo:ro" \
  -e CD_STAGED_FILES \
  commit-defender:latest
```

---

## docker-compose.yml

For iterative local development:

```yaml
services:
  commit-defender:
    build: .
    image: commit-defender:latest
    volumes:
      - ${CD_TARGET_REPO:-./}:/repo:ro
    environment:
      - ANTHROPIC_API_KEY
      - CD_STAGED_FILES
      - CD_SKIP_AI=0
      - CD_DRY_RUN=0

  dev:
    build: .
    volumes:
      - .:/app               # live source mount for fast iteration
      - ${CD_TARGET_REPO:-./}:/repo:ro
    environment:
      - CD_SKIP_AI=1
      - CD_DRY_RUN=1
    entrypoint: ["python", "-m", "pytest", "tests/", "-v"]
```

Run tests inside the container:
```bash
docker compose run --rm dev
```

---

## Expected final image size

~350–450 MB (Python slim + Node runtime + all linter binaries). Acceptable for a dev-time tool; not a production service image.

---

## Verify the build

```bash
docker build -t commit-defender:latest . && echo "BUILD OK"
docker run --rm commit-defender:latest python -c "import commit_defender; print('OK')"
docker run --rm commit-defender:latest ruff --version
docker run --rm commit-defender:latest eslint --version
docker run --rm commit-defender:latest shellcheck --version
```
