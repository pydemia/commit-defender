# Security

Review the code for vulnerabilities that could be exploited or that leak sensitive information.

## What to check
- **Hardcoded secrets**: API keys, tokens, passwords, private keys, connection strings committed in source
- **Authentication & authorization**: missing auth checks, insecure session handling, JWT without signature verification, broken access control
- **Injection**: SQL injection, command injection, LDAP injection, XSS, template injection, path traversal
- **Credential exposure**: usernames/passwords in logs, URLs, error messages, or environment variable dumps
- **Cryptography**: weak algorithms (MD5/SHA1 for integrity, DES/3DES), hardcoded IVs or salts, insecure random number generation
- **Dependency risk**: importing packages known to have critical CVEs, unpinned deps that could pull in malicious versions
- **Secrets in config**: `.env` files committed, secrets in `settings.py`, docker-compose files with plain-text credentials
- **OWASP Top 10**: cover the full OWASP list where applicable (broken auth, security misconfiguration, insecure deserialization, etc.)

## Tone
Security findings are always **must-fix** regardless of severity setting. Even a low-probability secret leak should be flagged — the cost of a miss is too high.
