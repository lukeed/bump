# bump

Release the packages of a git repository. `bump` finds the packages that changed since their last tag, writes their new versions and internal dependency ranges, and makes one release commit with one annotated tag per release.

It works with `package.json` and `Cargo.toml` packages, also mixed in one repository. It does not publish or push.

## Install

`bump` runs on [Bun](https://bun.sh) 1.4 or later.

```sh
bun add -d bump
```

## Usage

```sh
bump <type | version> [...targets] [options]
```

```sh
bump patch                     # release what changed
bump minor --dryrun            # print the release, write nothing
bump prerelease --preid rc     # 1.3.0-next.2 → 1.3.0-rc.0
bump 2.0.0 @acme/cli           # an exact version for one target
bump minor --json              # the result as JSON, for CI
```

Types: `major`, `minor`, `patch`, `premajor`, `preminor`, `prepatch`, `prerelease`, or an exact version.

Run `bump --help` for all options.

## How it works

- The version in each manifest is the current version. The tag of that version marks the commit to compare against.
- Packages are found from your workspace files (`workspaces` in `package.json`, `pnpm-workspace.yaml`, or `[workspace]` in `Cargo.toml`), or from `packages` in `bump.json`.
- **Lockstep mode** (the default): all packages share one version and one `v{version}` tag.
- **Independent mode**: each package, or each group of packages, has its own version and a `{name}@{version}` tag. A package that depends on a released package gets a patch release.
- Each manifest keeps its format. Only the version strings change.
- `Cargo.lock` and npm lockfiles (npm, bun, pnpm, Yarn 2+) are updated in the same commit.
- If any step fails, `bump` undoes the files, the commit, and the tags.

## Configuration

`bump.json` is optional. Put it in the repository root.

```json
{
  "independent": true,
  "packages": ["packages/*", "crates/*", "!packages/internal-*"],
  "groups": {
    "web": ["@acme/ui", "@acme/app"]
  },
  "preid": "next",
  "tag": "{name}@{version}",
  "message": "release: {tags}"
}
```

## CI

`bump` needs the full history and all tags. With GitHub Actions:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

## First release

A package at `0.0.0` without a tag is a first release. For a repository that already has versions but no matching tags, either tag the last release commit, or run once with `--adopt`.

## License

MIT
