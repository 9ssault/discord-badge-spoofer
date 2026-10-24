# 9ssault / Ultimate Edition

A gift edition of [9ssault's Discord Badge Spoofer](https://github.com/9ssault/discord-badge-spoofer), with safer credential handling, dependable offline previews, validated input and clearer reporting. Original author: **9ssault**. Local modifications: Ultimate Edition, October 2026.

**Node.js 22 or newer. Zero runtime dependencies. No npm install needed.**

## Start here

Extract the whole folder, then open a terminal in it:

```sh
node index.js --demo
```

On Windows, double-click `setup.bat`. On macOS, Linux or Termux, run `bash setup.sh`. Both launch the offline menu by default and forward any arguments you provide. They do not install software or packages.

Try a complete offline preview:

```sh
node index.js --dry --auto --mode variety --titles 100
```

The preview uses a **bundled synthetic demo catalog**, not Discord's real game catalog. It does not read saved credentials, contact Discord, or write account state, profiles, checkpoints or journals. Preview totals represent planned events only. `--demo` is an alias for offline mode; `--dry` keeps the whole process offline.

## What changed

- Offline startup by default; live network activity requires an explicit `--live`.
- Masked terminal prompts; credentials remain in process memory instead of being copied into `.env`, exports or profile files.
- Validated command-line values, number prompts and bounded title selections.
- Honest local reporting: accepted telemetry is not confirmed badge progress.
- Clear experimental labels for streaming; no claim that streaming unlocks a badge.
- Cancellation handling, bounded retries and more careful checkpoints.
- Redacted logs, secret-free exports and separate profile metadata.
- Readable terminal output that respects `NO_COLOR`, redirected output and scrollback.
- Automated offline tests and portable launch scripts.

## Modes and controls

```sh
node index.js --help
node index.js --dry --auto --mode playtime --hours 1 --titles 20
node index.js --dry --auto --mode stream --hours 2
node index.js --dry --auto --mode all --hours 1 --titles 20
node index.js --dry --profile gift --auto --mode variety --titles 100
```

The menu retains playtime, title search, variety, experimental streaming, ladder estimates, profiles and tools. `--profile NAME` separates local settings and progress metadata; it does not save credentials. During an offline preview, profile changes are temporary.

A deliberate `--live` launch enables network requests and local metadata storage. Interactive credential prompts mask input. Automatic use requires `DISCORD_TOKEN` from the process environment and optionally accepts `CF_CLEARANCE_COOKIE`; do not put credentials in command-line arguments, screenshots, shared files or committed configuration. Non-terminal secret prompting is refused instead of echoing sensitive input.

Version 4.1 adds an experimental direct sign-in option:

```sh
node index.js --live --signin
```

Enter your email or phone, password, and a current authenticator code if requested. The program signs in independently of any browser session, verifies the returned account identity, and then opens the menu. Signing in does not submit game activity. Passwords retain intentional spaces and all credential prompts are masked. Passwords, codes, session cookies and tokens are kept in process memory and never saved to metadata or logs.

This uses Discord's undocumented user sign-in endpoints, not OAuth. It stops on CAPTCHA, extra account checks, unsupported authentication methods, rate limits or failed sign-in. It does not read browser profiles or cookies, solve challenges, or bypass verification. `--signin` requires an interactive terminal and cannot be combined with `--auto`. Ordinary OAuth login has no documented telemetry scope for this tool.

Live metadata is kept in `.local/` by default. Set `BADGES_DATA_DIR` in the process environment to select another directory. The application never reads or writes `.env` files.

A session setting cannot override the offline startup policy. Checkpoints and local totals are bookkeeping, not evidence of a badge unlock.

Each live profile binds to the account returned by Discord's identity endpoint. Changing accounts requires a different `--profile`; activity imports must match that account. Old activity without an account identity requires a fresh profile.

## Reporting and limitations

Live accepted counts mean that the endpoint accepted the corresponding requests. They do **not** prove Discord credited the activity, granted a badge or updated its servers. Actual verified badge progress is unavailable to this application.

Discord says badge progress can take time to reflect recent activity, without specifying a guaranteed update time. That delay does not establish that this tool's submissions will receive badge credit. See [Discord's official badge guide](https://support.discord.com/hc/en-us/articles/44369363856663-Discord-Profile-Badges-What-Each-Badge-Means).

Streaming telemetry is experimental and its badge effect is unverified. This edition improves the program's reliability and handling of local data; it does not establish whether the badge method still works.

Checkpoints match the account, profile and exact activity plan. Graceful cancellation reports accepted submissions, but an abrupt process exit or storage failure can leave local totals incomplete. A failed write is reported separately; restarting is not a guarantee against duplicate submissions.

The original project sends fabricated Discord activity. That may violate Discord's rules and may affect the account used. No Discord account is needed for the included demo or tests.

## Existing installations

Use this edition in a fresh extracted folder for the cleanest start. New profile exports contain metadata only. Credential keys from older files are not imported as usable credentials; enter credentials for the current process when needed.

Older copies of `vault.json`, `science_state.json`, `.env`, profile exports and debug dumps may still contain secrets written by earlier versions. This edition does not erase unrelated files or backups. Do not include those files when sharing the gift.

## Verify

```sh
npm test
node index.js --dry --auto --mode variety --titles 100
```

Tests run locally with fixtures and mocked network responses. They do not validate real Discord badge unlocks.

See [CHANGELOG.md](CHANGELOG.md) for the repair summary and [START-HERE.txt](START-HERE.txt) for the short gift note.

## License

The repository's original [GNU GPL version 3 license](LICENSE) is retained. This is a modified source edition of 9ssault's project, not an official Discord product. Keep the license, original attribution and modified source together when redistributing.
