# Deployment Guide

dsh-auto-review integrates with DeepSeek Harness through the bundle mechanism. Built-in packages such as `dsh-base` and `dsh-web-app` use the same mechanism. This is the supported integration path.

## Prerequisites

The plugin was developed and verified with the web profile of DeepSeek Harness 0.1.0-rc.6. CLI installation requires Node.js and pnpm on PATH.

## Quick install

Add the published package to the web profile:

```bash
npx @deepseek-ai/dsh plugin --profile web add @gbthui/dsh-auto-review
```

`dsh plugin` passes the install spec to pnpm, so registry, git, and file specs are accepted. The package is installed into the profile's `node_modules`. Because `@gbthui/dsh-auto-review` declares `dsh.bundle`, the CLI also adds it to `dsh.profile.bundles`.

The install command only updates the profile's dependencies and bundle configuration. It does not control an already running Harness process. A newly installed bundle is loaded the next time the profile starts. If the web profile is already running, stop that process and start it again using the same launch method. The npm launch command documented by DeepSeek Harness is:

```bash
npx @deepseek-ai/dsh web
```

When running Harness from source, the corresponding documented command is `pnpm dsh web`.

Configuration is optional. The reviewer follows the session's current model by default. Add a `dsh-auto-review:` section to `~/.dsh/settings.yaml` when you need a separate endpoint.

## Manual setup

### 1. Check the bundle declaration

The package's `package.json` contains:

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

`cordis.patch.yml` contains the plugin row:

```yaml
- insert:
    - id: auto-review
      name: '@gbthui/dsh-auto-review'
```

### 2. Add it to the profile

Edit `~/.dsh/profiles/web/package.json`:

```json
{
  "dependencies": { "@gbthui/dsh-auto-review": "file:/path/to/dsh-auto-review" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@gbthui/dsh-auto-review"] } }
}
```

The CLI can make the same change:

```bash
npx @deepseek-ai/dsh plugin --profile web add /path/to/dsh-auto-review
```

This command requires pnpm on PATH. It installs the dependency and reconciles bundle-declaring dependencies into `bundles`. If pnpm is unavailable, edit the profile file directly.

### 3. Satisfy both resolution locations

The package is resolved from two locations during loading. Both locations must work:

| Resolution point | Search order | Setup |
| --- | --- | --- |
| Bundle directory | harness `node_modules` first, profile directory second | place or symlink the package at `node_modules/@gbthui/dsh-auto-review` under the harness installation |
| Plugin row `import()` | starts at the profile directory and follows Node's module resolution path upward | create the same package path at `~/.dsh/profiles/node_modules/@gbthui/dsh-auto-review`. At boot, dsh maintains fallback links only for its own dependencies; third-party packages must be placed separately |

If the second location is missing, startup logs contain:

```text
failed to import loader entry auto-review ... Cannot find package ... imported from /home/example/.dsh/profiles/web/
```

This causes the profile to exit during startup. Where the log appears depends on the launch method or process manager you actually use.

### 4. Configure the reviewer

Add a `dsh-auto-review:` section to `~/.dsh/settings.yaml`. See [configuration.md](./configuration.md) for the available settings. Settings changes do not require a restart.

For unattended or security-sensitive deployments, configure a separate reviewer instead of using the session model. Set `reviewer.baseURL`, `reviewer.model`, and `reviewer.apiKeyFile`, preferably to a model from a different provider or model family than the agent. Keep the default `denyOnReviewerError: true` so a reviewer outage fails the request closed instead of leaving an interactive approval prompt with nobody to answer it.

An external reviewer receives user requests, tool arguments, recent agent activity, and workspace and sandbox information. If `factFinding.content.enabled` is enabled, workspace file content requested by the reviewer may also be sent. See the configuration reference for the complete data surface.

### 5. Restart and verify

After installing or updating plugin code, restart the running profile so it loads the new code. Stop the old process and start it again using the same method you normally use. The documented npm launch path is:

```bash
npx @deepseek-ai/dsh web
```

When running Harness from source, use:

```bash
pnpm dsh web
```

After startup, create a new session and run:

```text
/auto-review status
```

It reports the current `enabled`, reviewer, thinking, and context settings. After triggering an operation that requires approval, you can also inspect the audit log:

```bash
tail -f ~/.dsh/auto-review-audit.jsonl
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Profile startup fails with `failed to import loader entry auto-review` | the plugin row is not present through a bundle layer, or the second resolution chain is missing | check the bundle declaration, `dsh.profile.bundles`, and the profiles fallback symlink |
| Escalation denied with `source: reviewer-error` | reviewer endpoint, key, or model configuration problem | inspect the audit `reason`; probe the endpoint; check the `KEY=VALUE` format in `apiKeyFile` |
| Verdict is returned in `reasoning_content` and denied (older versions) | old behavior; current versions read only the final answer | upgrade the plugin, or set `thinking: off` |
| Denial says `credential manipulation ... human execution only` | credential-file changes require human execution | run the operation yourself, or use `/auto-review off` to route it through human approval |

## Uninstall

For a CLI installation, run:

```bash
npx @deepseek-ai/dsh plugin --profile web remove @gbthui/dsh-auto-review
```

Remove the `dsh-auto-review:` settings section if you added one, then restart the running profile. Manual installations also need their manually added bundle entry and symlinks removed.
