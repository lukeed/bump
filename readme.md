<h1 align="center">bump</h1>

<div align="center">
  <a href="https://npmjs.org/package/bump">
    <img src="https://badgen.now.sh/npm/v/bump" alt="version" />
  </a>
  <a href="https://github.com/lukeed/bump/actions">
    <img src="https://github.com/lukeed/bump/workflows/CI/badge.svg" alt="CI" />
  </a>
  <a href="https://licenses.dev/npm/bump">
    <img src="https://licenses.dev/b/npm/bump" alt="licenses" />
  </a>
</div>

<div align="center">Release the packages that changed. Nothing else.</div>

<br />

`bump` looks at what changed since your last release, bumps those packages (and the ones that depend on them), then makes **one** commit with a tag per release. That's it. It doesn't publish & it doesn't push ~ that's your call.

And, of course, in mandatory bullet-point format:

* Works with `package.json` _and_ `Cargo.toml` packages, even mixed in one repo
* Lockstep (one version for all) or independent (each package or group on its own)
* Only the version strings change ~ your comments & formatting stay put
* Updates `Cargo.lock`, `package-lock.json`, `bun.lock`, `pnpm-lock.yaml`, and `yarn.lock` (Yarn 2+) in the same commit
* If anything fails, it undoes the files, the commit, _and_ the tags

> **Heads up:** `bump` runs on [Bun](https://bun.sh) 1.4+ for now.

## Install

```sh
$ bun add --dev bump
```

## Usage

```sh
$ bump patch                    # release what changed
$ bump minor --dryrun           # see what would happen, write nothing
$ bump prerelease --preid rc    # 1.3.0-next.2 -> 1.3.0-rc.0
$ bump 2.0.0 @acme/cli          # an exact version, for one package
$ bump minor --json             # the result as JSON, for CI
```

The first argument is a type (`major`, `minor`, `patch`, `premajor`, `preminor`, `prepatch`, `prerelease`) or an exact version. Anything after it is a target. Run `bump --help` for every option.

## How it works

The version in each manifest is the source of truth. Its tag (`v1.2.0` or `app@1.2.0`) marks the commit to diff against. If those two ever disagree, `bump` stops and tells you why.

Packages come from your workspace files (`workspaces` in `package.json`, `pnpm-workspace.yaml`, or `[workspace]` in `Cargo.toml`), or from `packages` in your config.

A package at `0.0.0` with no tag is a first release. Already have versions but no matching tags? Either tag your last release commit, or run once with `--adopt`.

## Config

A `bump.json` _or_ `bump.jsonc` file is optional. Both allow comments & trailing commas.

```jsonc
{
  "$schema": "https://unpkg.com/bump/schema.json",
  "independent": true,
  "packages": ["packages/*", "crates/*", "!packages/internal-*"],
  "groups": {
    // these always release together
    "web": ["@acme/ui", "@acme/app"],
  },
  "preid": "next",
  "tag": "{name}@{version}",
  "message": "release: {tags}",
}
```

## API

```js
import { version } from 'bump';

let result = await version('minor', {
  cwd: 'path/to/repo',
  dryrun: true,
  log: console.log,
});

console.log(result.units);
//=> [{ name: 'core', from: '1.2.0', to: '1.3.0', reason: 'changed', ... }]
```

### version(input, options?)
Returns: `Promise<Result>`

The `input` is a type or an exact version, same as the CLI.

The `options` take every config key (except `$schema`), plus `cwd`, `targets`, `all`, `adopt`, `dryrun`, and `log`. An inline key wins over the config file. Without `log`, nothing is printed.

If a `SIGINT` or `SIGTERM` stops a release, the release is undone and `version()` throws an `Interrupt` error with its `signal`.

## CI

`bump` needs your full history and every tag. With GitHub Actions:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
```

## License

MIT © [Luke Edwards](https://lukeed.com)
