# Setting

Review environment configuration, secrets management, and deployment/DevOps concerns.

## What to check
- **Environment variable hygiene**: required env vars not validated at startup, no fallback or fail-fast when a critical var is missing, values consumed without sanitisation
- **`.env` file risks**: `.env` committed to version control, `.env.example` missing or outdated, secrets in `.env` not excluded by `.gitignore`
- **Config file security**: plaintext credentials in `docker-compose.yml`, `k8s` manifests, CI pipeline definitions, or `terraform`/`ansible` files
- **Infrastructure migration safety**: destructive migrations (DROP TABLE, ALTER COLUMN NOT NULL) without backward-compatible steps; no rollback plan; applying to prod without staging validation first
- **DevOps pipeline correctness**: CI steps that can silently pass on partial failure; missing lint/test gates before deploy; hardcoded environment names or credentials in pipeline YAML
- **Secrets management**: secrets that should be in a vault (AWS Secrets Manager, HashiCorp Vault, GitHub Secrets) being passed as plain environment variables or build args
- **Service configuration drift**: settings that differ between environments in a way that could cause production-only failures (e.g. `DEBUG=True` in prod, different DB pool sizes)
- **Dependency pinning**: unpinned base images in Dockerfile (`FROM python:latest`), unpinned package versions that could silently break on next install

## Tone
Flag setting issues as **must-fix** when they risk exposing secrets or causing data loss during deployment. Flag configuration inconsistencies as warnings.
