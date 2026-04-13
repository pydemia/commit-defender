# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Python builder — install package + dependencies via uv
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS builder

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

WORKDIR /build

# Copy dependency manifest first for layer caching
COPY pyproject.toml .
COPY commit_defender/ ./commit_defender/

# Install into the system Python (no venv needed in a container)
RUN uv pip install --system --no-cache .

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Node tools — eslint and markdownlint-cli2
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS node-tools

RUN npm install -g \
    eslint@9 \
    @eslint/js \
    markdownlint-cli2 \
    --no-fund --no-audit --loglevel=error

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Final image
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm

# System tools: git (for git diff inside container) + shellcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    shellcheck \
    && rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder stage
COPY --from=builder /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=builder /usr/local/bin/ruff /usr/local/bin/ruff 2>/dev/null || true

# Install ruff binary directly (fastest linter, self-contained)
RUN pip install --no-cache-dir ruff

# Copy Node.js runtime + global packages from node-tools stage
COPY --from=node-tools /usr/local/bin/node /usr/local/bin/node
COPY --from=node-tools /usr/local/lib/node_modules /usr/local/lib/node_modules
# Link CLI binaries
RUN ln -sf /usr/local/lib/node_modules/eslint/bin/eslint.js /usr/local/bin/eslint && \
    ln -sf /usr/local/lib/node_modules/markdownlint-cli2/markdownlint-cli2.js /usr/local/bin/markdownlint-cli2

# Copy the commit-defender package
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY commit_defender/ /app/commit_defender/
WORKDIR /app

# The container entrypoint runs the full validation pipeline
ENTRYPOINT ["python", "-m", "commit_defender.entrypoint"]
