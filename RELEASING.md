# Releasing `@rangerwild/mcp-server`

Every release is a git tag. No manual `npm publish`, no tokens anywhere on
your machine. The GitHub Actions workflow authenticates to npm via OIDC
("Trusted Publishing") and attaches a sigstore provenance bundle to the
tarball.

## Prerequisites (one-time)

1. The npm package [@rangerwild/mcp-server](https://www.npmjs.com/package/@rangerwild/mcp-server)
   has **Trusted Publisher** configured at:
   `npmjs.com/package/@rangerwild/mcp-server/access` → **Trusted Publishers**
   with:
   - Publisher: GitHub Actions
   - Organization: `philgillett-git`
   - Repository: `ranger-mcp`
   - Workflow filename: `publish.yml`
   - Environment: _(none)_
2. The repo is PUBLIC (required for sigstore provenance).
3. You own the `@rangerwild` npm org.

If any of the above is missing, see [npm's Trusted Publishing
docs](https://docs.npmjs.com/trusted-publishers) and reconfigure before
tagging.

## Cutting a release

```bash
# 1. Bump the version in package.json (don't let npm create the tag — we do that)
npm version 0.3.0 --no-git-tag-version

# 2. Commit the bump on main
git commit -am "chore: bump @rangerwild/mcp-server to 0.3.0"
git push origin main

# 3. Tag the release and push the tag
git tag v0.3.0
git push origin v0.3.0

# 4. Watch the workflow fire
gh run watch --exit-status
```

The workflow will:

1. Install deps, build, verify the tag matches `package.json`
2. Mint an OIDC token
3. Call `npm publish --access public --provenance` — npm verifies the OIDC
   claim against the Trusted Publisher config and issues a one-shot credential
4. Attach a sigstore bundle to the tarball
5. Push to the npm registry

Expected time: ~1 minute end to end.

## Verifying the release

```bash
# Dist-tags update first
curl -sS https://registry.npmjs.org/-/package/@rangerwild/mcp-server/dist-tags

# Full manifest within ~5 minutes of publish
npm view @rangerwild/mcp-server

# The npm web page shows a "✓ Provenance" badge
open https://www.npmjs.com/package/@rangerwild/mcp-server
```

## Versioning policy

- **Patch** (`0.2.0` → `0.2.1`): bug fix in an existing tool, no API shape change.
- **Minor** (`0.2.0` → `0.3.0`): new tools added, no existing tool removed or reshaped.
- **Major** (`0.2.0` → `1.0.0`): existing tool removed or its input/output schema changes incompatibly.

Treat the MCP tool set as the public API surface. Removing or renaming a tool
is a breaking change for everyone who scripted against it.

## Yanking a bad release

```bash
npm deprecate "@rangerwild/mcp-server@0.3.0" "Use 0.3.1 instead — <reason>"
# Then publish 0.3.1 with the fix via the normal tag flow.
```

Prefer `npm deprecate` over `npm unpublish` — unpublish breaks every lockfile
that already pinned to that version.

## If a release fails

Check the workflow log at `github.com/philgillett-git/ranger-mcp/actions`. The
two most common causes:

- **Tag doesn't match `package.json`** — the workflow's verification step
  catches this before publish. Fix the bump commit and re-tag.
- **Trusted Publisher config drifted** — if the workflow filename, repo, or
  org name changed, npm refuses the OIDC claim. Update the config at
  `npmjs.com/package/@rangerwild/mcp-server/access`.

A bootstrap token is no longer needed for routine releases. See the npm
Trusted Publishing docs if provenance ever starts failing (usually means
visibility of this repo was changed from public to private).
