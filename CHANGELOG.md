# Changelog

## Ultimate Edition — 4.1.0 — October 2026

- Add experimental direct email/password and authenticator-code sign-in with `--live --signin`.
- Keep freshly issued credentials in memory and verify account identity before opening the menu.
- Stop explicitly on CAPTCHA, unsupported verification, failed authentication and rate limiting.
- Preserve intentional whitespace in password input.
- Retry a rejected authenticator code with fresh input while keeping the same sign-in ticket; show sanitized HTTP and Discord error codes.
- Refresh analytics without discarding the account's in-memory sign-in credentials.
- Remove the unconditional requirement for a manually copied cookie header.
- Add mocked sign-in, MFA, input-handling and bootstrap integration tests.

Browser sign-in does not transfer its session to this program. Direct sign-in and actual badge credit are separate verification steps.

## Ultimate Edition — 4.0.0 — October 2026

A locally modified gift edition of 9ssault's original project.

### Execution and reporting
- Default to an offline preview; require explicit `--live` for network use.
- Make `--dry` and `--demo` enforce offline behavior throughout a run.
- Include a clearly identified synthetic catalog for offline previews.
- Validate command-line arguments and interactive selections.
- Distinguish planned events, accepted telemetry and unverified badge credit.
- Label streaming as experimental.
- Tighten cancellation, retries and checkpoint handling.
- Bind resume checkpoints to the exact account, profile and activity plan.
- Preserve accepted-result reporting when local bookkeeping fails.

### Credentials and local state
- Keep credentials in session memory.
- Mask terminal credential input and refuse secret prompts without a terminal.
- Remove credential persistence from environment files and profile exports.
- Redact known secrets and sensitive object fields in logs.
- Keep profile metadata separate and avoid offline state writes.
- Bind profile history to a verified account identity and reject mismatched imports.

### Presentation and maintenance
- Add a compact Ultimate Edition identity while retaining 9ssault attribution.
- Preserve terminal scrollback and support plain output with `NO_COLOR`.
- Simplify launch scripts; remove automatic installation and dependency downloads.
- Add offline regression tests and a short gift guide.
- Align package metadata with the existing GPLv3 license.

Live Discord badge credit has not been verified. No account activity is needed to run the tests.
