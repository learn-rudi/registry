# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | Yes                |
| < 1.0   | No                 |

## Security Model

### No Secrets in Registry

The registry must never contain API keys, tokens, or credentials. All secrets are:

- Declared in stack manifests under `requires.secrets`
- Stored locally by users in `~/.rudi/secrets.json`
- Injected at runtime by the RUDI CLI

### Package Verification

Packages in the official registry are reviewed before inclusion. Third-party packages should be reviewed by users before installation.

### Binary Sources

Binaries are sourced from:
- Official upstream releases (GitHub, vendor sites)
- Verified checksums where available
- Platform-specific builds (darwin-arm64, darwin-x64, linux-x64)

## Reporting a Vulnerability

If you discover a security vulnerability in the RUDI Registry, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email security concerns to the maintainers
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We aim to respond to security reports within 48 hours and will work with you to understand and address the issue.

## Review Checklist

When reviewing packages for inclusion:

1. **No embedded secrets** - Check for hardcoded API keys or tokens
2. **Trusted sources** - Verify upstream binary URLs are official
3. **Minimal permissions** - Stack should only request necessary secrets
4. **Safe commands** - No arbitrary code execution in manifests
5. **Clear documentation** - Users understand what they're installing

## Best Practices for Contributors

When creating stacks:

1. **Declare all secrets** - List every required credential in the manifest
2. **Use environment variables** - Read secrets from `process.env` or `os.environ`
3. **Validate inputs** - Sanitize all user-provided data
4. **Handle errors** - Don't leak sensitive information in error messages
5. **Minimal scope** - Request only the permissions your stack needs

## Scope

This security policy covers:
- The RUDI Registry (`learn-rudi/registry`)
- Official stacks, binaries, and prompts
- The index.json package manifest

Third-party stacks linked from external sources have their own security policies.
