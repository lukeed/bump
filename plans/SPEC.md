# bump — specification

Written at: `0b1081b` (2026-10-27)

This document is the complete design of `bump`. It replaces the behavior of the `1.0.0-next.x` code. A reader who did not see the design discussion must be able to build the program from this document alone. Each rule has one home; other sections point to it by number.

## 1. Purpose

`bump` releases the packages of a git repository. It finds the packages that changed since their last release, computes their next versions, writes the new versions and the internal dependency ranges into the manifests, and makes one release commit with one annotated tag per released unit.

It works for JavaScript (`package.json`) and Rust (`Cargo.toml`) packages, also mixed in one repository.

Out of scope: publishing to registries, pushing to remotes, changelogs and release notes, distribution of `bump` itself (decided later).

## 2. Glossary

- **Package**: one manifest file in one directory, with a `name`. A directory can hold several packages (for example a `package.json` and a `Cargo.toml`).
- **Ecosystem**: the manifest kind of a package: `npm` (`package.json`) or `cargo` (`Cargo.toml`).
- **Adapter**: the code that discovers, reads, and edits the manifests of one ecosystem.
- **Versioned package**: a package whose manifest has a version. Only versioned packages can be released.
- **Unit**: a set of versioned packages that always release together, with one version and one tag. Every release operates on units, never on single packages.
- **Lockstep mode**: the repository is one unit that holds all versioned packages. This is the default.
- **Independent mode**: each group is a unit, and each versioned package that is not in a group is a unit of its own.
- **Group**: a named unit with several packages, in independent mode.
- **Dense**: every member of a released unit gets the new version, changed or not. All units are dense.
- **Anchor**: the git tag of the unit's current version. It is the commit that change detection diffs from.
- **Release commit**: a commit that a unit tag points to.
- **Target**: a package name or a group name given on the command line.
- **Seed**: a selected unit whose reason is not `dependent` (§9.4).
- **Dependent**: a selected unit that has a runtime dependency on another selected unit, and is not a seed.
- **Preid**: the identifier of a prerelease line, for example `next` in `1.3.0-next.2`.
- **Git top level**: the output of `git rev-parse --show-toplevel`, with symlinks resolved.

## 3. Runtime and dependencies

- The runtime is Bun 1.4 or later. The program uses Bun built-ins: `Bun.Glob`, `Bun.TOML.parse`, `Bun.YAML.parse`, `Bun.semver.order`, and `node:child_process` or `Bun.spawn` for `git`.
- The only runtime dependency is `@lukeed/jsonc`, for the config file and for `package.json` files with comments.
- `git` must be on `PATH`. If it is not there, the error is `Missing "git" binary`.
- To update npm lockfiles, the matching package manager must be on `PATH` (§12.5).
- Distribution (npm package, compiled binaries) is out of scope for this document.

### 3.1 Semver

A **valid version** matches the semver 2.0 regular expression:

```
^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$
```

Validate with this expression. `Bun.semver.order` accepts invalid input (`1.0`, `01.0.0`), so use it only to order versions that passed validation. Order follows semver 2.0 precedence.

## 4. Command line

```
bump <type | version> [...targets] [options]
```

### 4.1 First positional: type or version

The first positional is required. It is one of:

- a **type**: `major`, `minor`, `patch`, `premajor`, `preminor`, `prepatch`, `prerelease` (case-insensitive);
- an **exact version**: a valid version (§3.1) without build metadata and without a `v` prefix. `1.0` is not valid.

Anything else is the error `Invalid <type> argument: "<value>"`. A missing value is the error `Missing <type> argument`.

### 4.2 Other positionals: targets

Every positional after the first is a target. See §9.3 for target rules.

### 4.3 Options

| Option | Alias | Value | Meaning |
|---|---|---|---|
| `--all` | `-A` | — | Release every unit, changed or not. |
| `--preid` | | `<id>` | The preid for a new prerelease line (§10.3). |
| `--adopt` | | — | Release units that have no anchor, as changed (§8.3). |
| `--dryrun` | `-D` | — | Do every check and computation, print the result, write nothing. |
| `--json` | | — | Print the result as JSON on stdout (§13.2). |
| `--cwd` | `-C` | `<dir>` | The directory to start from. Default `.`. |
| `--version` | `-v` | — | Print `bump, v<version>` and exit 0. |
| `--help` | `-h` | — | Print the help text (§4.5) and exit 0. |

Parsing rules:

- `--help` wins over everything, then `--version`. Both ignore all other arguments, also invalid ones.
- An unknown option is the error `Unknown option "<option>"`.
- An option that needs a value and has none is the error `Missing value for <option>`.

Conflicts, each an error:

- `--all` with targets.
- `--preid` with `major`, `minor`, `patch`, or an exact version.
- Targets in lockstep mode.
- An invalid `--preid` value (§10.4).

### 4.4 Errors, warnings, exit codes

- An error prints `error: <message>` to stderr. A message names the item and the file it comes from, where there is one.
- A warning prints `warning: <message>` to stderr.
- Exit `0`: a release was made, the dry run finished, or there was nothing to release.
- Exit `1`: any error.
- Exit `130` after SIGINT, and `143` after SIGTERM, after the undo of §14.3.

### 4.5 Help text

```

  Usage
    bump <type | version> [...targets] [options]

  Types
    major, minor, patch, premajor, preminor, prepatch, prerelease
    or an exact version, for example 2.0.0

  Options
    -A, --all            Release every unit, changed or not
        --preid <id>     Preid for a new prerelease line  (default: "preid" of bump.json, else next)
        --adopt          Release units that have no tag, as changed
    -D, --dryrun         Print the release, and write nothing
        --json           Print the result as JSON on stdout
    -C, --cwd <dir>      Directory to start from  (default .)
    -v, --version        Print the version
    -h, --help           Print this message

  Examples
    bump patch
    bump minor --dryrun
    bump prerelease --preid rc
    bump 2.0.0 @acme/cli

```

## 5. Repository root and configuration

### 5.1 Root

1. Find the git top level of `--cwd`. If `--cwd` is not in a git repository, the error is `Not a git repository: "<dir>"`.
2. From `--cwd`, search upward for `bump.json` or `bump.jsonc`. Stop after the git top level. The first directory that has one is the **root**. A directory with both files is an error: `Keep one of "<bump.json>" and "<bump.jsonc>"`.
3. If no config file is found, the root is the git top level.

All paths in the config are relative to the root. Git prints paths relative to the git top level. Convert both to absolute paths before any compare.

### 5.2 `bump.json`

The file is optional. Without it, all defaults apply. Both names are parsed as JSONC with `@lukeed/jsonc`, so comments and trailing commas are allowed in either one.

```jsonc
{
  "$schema": "https://unpkg.com/bump/schema.json",
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

| Key | Type | Default | Rule |
|---|---|---|---|
| `$schema` | string | — | Ignored. Lets editors validate the file against `schema.json` (§13.4). |
| `independent` | boolean | `false` | Selects the mode. |
| `packages` | string, or non-empty string[] | workspace discovery (§6.2) | Directory globs (§6.1). A string is one pattern. |
| `groups` | object of non-empty string[] | `{}` | Independent mode only (§7.2). |
| `preid` | string | `"next"` | Must follow §10.4. |
| `tag` | string | lockstep `"v{version}"`, independent `"{name}@{version}"` | §5.3. |
| `message` | string | lockstep `"v{version}"`, independent `"release: {tags}"` | §5.3. |

Validation, each an error that names the key:

- An unknown key. The keys of earlier versions get a specific message:
  - `version`: `"version" was removed: versions come from the manifests`.
  - `single`: `"single" was removed: use "packages": ["."]`.
  - `all`: `"all" was removed: use --all`.
- A non-empty `groups` in lockstep mode. An empty `{}` is allowed.
- A value of the wrong type, an empty `packages` array, an empty group.
- A file that is not valid JSONC.

### 5.3 Templates

`tag` is the name of a unit tag. Placeholders:

- `{version}`: the unit version. It is required.
- `{name}`: the unit name. It is required in independent mode and not allowed in lockstep mode (a lockstep unit has no name).

`message` is the subject of the release commit. Placeholders:

- `{version}`: lockstep mode only.
- `{tags}`: the new tags, in unit order (§9.6), joined with `, `.

Each annotated tag uses its own tag name as its message.

Placeholders are case-sensitive and can repeat. There is no escape for literal braces. Any other `{...}` text is a config error.

To read tags back, compile `tag` to one regular expression per unit:

- Escape all literal text.
- Replace `{name}` with the escaped unit name.
- Replace `{version}` with a capture of a valid version without build metadata: the expression of §3.1 without its `^`, `$`, and build part.
- Anchor the whole expression with `^` and `$`. A tag belongs to a unit only if the whole tag name matches.

Before a release, check every new tag with `git check-ref-format "refs/tags/<tag>"`. A scoped name such as `@acme/cli@0.4.2` is valid.

## 6. Package discovery

### 6.1 Directory globs

1. Split the patterns. A pattern that starts with `!` is an exclusion, without the `!`. All other patterns are inclusions.
2. Match each inclusion with `new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: false, dot: false })`, and keep only directories. The pattern `.` means the root directory; handle it directly, because `Bun.Glob(".")` matches nothing.
3. Remove each directory where an exclusion matches the directory or one of its parent directories (relative to the root).
4. Remove each directory that is or is inside a `node_modules` directory or a directory whose name starts with `.`.
5. Sort the directories by relative path, in byte order. All later output depends on this order.
6. In each directory, check for the manifest file of the adapters in scope. Do not search subdirectories: one glob match is one directory.

### 6.2 Adapters in scope

**With `packages`**: every adapter checks every directory.

**Without `packages`**: each ecosystem uses its own member set, and its adapter checks only those directories.

- **npm**: the union of `package.json` `workspaces` at the root (an array of globs, or an object with a `packages` array) and `pnpm-workspace.yaml` `packages` at the root (parsed with `Bun.YAML.parse`). If neither exists: `["."]`.
- **Cargo**: the root `Cargo.toml` `[workspace]`.
  - `members` are inclusions, and `exclude` are exclusions.
  - If the same file has a `[package]` table, `.` is a member.
  - Each path dependency of a member that resolves to a directory inside the root, and that `exclude` does not exclude, is a member too. Repeat until no new member is added. Cargo has the same rule.
  - If the root has no `Cargo.toml` with `[workspace]`: `["."]`.

### 6.3 Package records

Each adapter returns, per manifest:

- `name`, `ecosystem`, `dir` (absolute, symlinks resolved), `file` (the manifest path);
- `version`, or none;
- `publish`: a boolean;
- the internal dependency list (§11).

Common rules:

- A manifest without a name is skipped with a warning that names the file. Exception: a Cargo virtual manifest (only `[workspace]`, no `[package]`) is skipped without a warning.
- A version that is not valid (§3.1) is an error that names the file.
- Two packages with the same name, in any ecosystems, is an error that names both files.
- No packages at all is the error `No packages found`. Packages that all have no version is the error `No versioned packages found`.

npm:

- The file is parsed with `jsonc.parse` (Bun allows comments and trailing commas in `package.json`).
- `name` and `version` are the top-level keys.
- `publish` is `false` when `"private": true`, else `true`.

Cargo:

- `name` is `[package] name`.
- `version` is `[package] version`. If it is a table `{ workspace = true }` (also written `version.workspace = true`), the version is `[workspace.package] version` of the Cargo workspace root (§7.3). A missing `version` means no version (Cargo then uses `0.0.0` and does not publish it).
- `publish` is `false` when `publish = false` or `publish = []`. With `publish.workspace = true`, use `[workspace.package] publish` of the Cargo workspace root with the same rule. Else `true`.

## 7. Units

### 7.1 Packages without a version

A package without a version is part of no unit. It cannot be a group member or a target (each an error that names it). Its dependencies make no unit dependency. It still gets range edits (§11.1), and it still owns its directory for change detection (§9.2).

### 7.2 Lockstep mode

There is one unit. It has no name, and it holds every versioned package.

### 7.3 Independent mode

- Each key of `groups` is a unit with the listed members.
- Each versioned package that is in no group is a unit of its own, with the package name as the unit name.

Group validation, each an error:

- A member name that is not a discovered package.
- A package in more than one group.
- A group name equal to the name of a package that is **not** a member of that group. A group may have the name of one of its own members.

### 7.4 Cargo workspaces and shared versions

The **Cargo workspace root** of a crate is:

1. the directory that `package.workspace = "<path>"` names, when it is set;
2. else, the crate's own directory, if its `Cargo.toml` has `[workspace]`;
3. else, the nearest parent directory up to the git top level whose `Cargo.toml` has `[workspace]`;
4. else, the crate has no workspace: it is its own root.

A repository can have several Cargo workspaces. Each one is handled alone.

Crates whose version is `{ workspace = true }` share one version: `[workspace.package] version` of their Cargo workspace root. In independent mode, all such crates of one workspace must be in one unit. Resolve that unit per workspace:

1. If only one crate of the workspace inherits the version, it needs no group. Its unit is normal.
2. Else, if an explicit group lists any of them, all of them join that group.
3. Else, if the workspace root `Cargo.toml` has a `[package]` that inherits the version, they form a group with the name of that root package.
4. Else, stop with this error, with the crate names:

```
Crates "a", "b", "c" share [workspace.package] version; name them in "groups", e.g. "groups": { "<name>": ["a"] }
```

If the joined or formed group breaks a rule of §7.3, that is an error.

### 7.5 Unit version

Every member of a unit must have the same manifest version. Otherwise stop with an error that lists each member and its version. This version is the **unit version**.

### 7.6 Unit dependencies

Unit A depends on unit B at runtime when a member of A has a runtime internal dependency (§11.1) on a member of B, and A is not B. Dev-only dependencies make no unit dependency.

## 8. Anchors and versions

The manifest is the authority for the version. The tag is the anchor for change detection. Both must agree.

### 8.1 Preconditions

- If `git rev-parse --is-shallow-repository` prints `true`, stop: `A full clone is needed: the history and tags are used to find changes (in CI, fetch all history and tags)`.
- If HEAD has no commit (`git rev-parse --verify HEAD` fails), stop: `The repository has no commits`.
- A detached HEAD is allowed.

### 8.2 Resolution per unit

For each unit in scope (§8.4), with manifest version `M`:

- **All tags** of the unit: `git tag --list`, filtered with the unit's tag expression (§5.3).
- **Reachable tags**: `git tag --merged HEAD`, filtered the same way.

Apply the first rule that matches:

| # | Condition | Result |
|---|---|---|
| 1 | A reachable tag has a version greater than `M`. | Error: `"<tag>" is released, but the manifest says <M>`. |
| 2 | The tag for `M` is reachable. | **Normal.** That tag is the anchor. |
| 3 | The tag for `M` exists, but is not reachable. | Error: `The "<tag>" release commit is not in the history of HEAD; merge it first`. |
| 4 | `M` is `0.0.0`. | **First release.** Reason `first`. All members count as changed. |
| 5 | Else. | **No anchor.** Error (§8.3), or with `--adopt`, reason `adopted`, and all members count as changed. |

Rules 1 and 3 have no override. Tags that are higher than `M` but not reachable are ignored: they belong to other branches.

Example for unit `app`:

| `app` manifest | Tags for `app` | Rule |
|---|---|---|
| `0.0.0` | none | 4 |
| `3.4.0` | `app@3.4.0`, reachable | 2 |
| `3.4.0` | none, or only `app@3.3.0` | 5 |
| `3.4.0` | `app@3.4.0`, only on another branch | 3 |
| `3.4.0` | `app@3.4.0` and `app@3.5.0`, both reachable | 1 |
| `3.4.0` | only `app@3.5.0`, reachable | 1 |
| `0.0.0` | `app@1.0.0`, reachable | 1 |

`--adopt` has no effect on units that have an anchor. When no unit needs it, it does nothing.

### 8.3 The no-anchor error

Collect **all** units in scope that match rule 5, then print one error:

```
error: no tag found for 2 units whose manifests are past 0.0.0

  app   manifest 3.4.0   expected tag app@3.4.0
  api   manifest 1.1.0   expected tag api@1.1.0

To continue from the last release, tag the commit that released it:
  git tag -a app@3.4.0 -m app@3.4.0 <commit>
  git tag -a api@1.1.0 -m api@1.1.0 <commit>

To use the manifest versions as the base, run again with --adopt:
  bump minor --adopt   →   app 3.5.0, api 1.2.0
```

- The first column is the unit name. The lockstep unit uses `(lockstep)`.
- The last line repeats the original arguments with `--adopt` added. It lists every unit that this command would release with `--adopt`, dependents too, in unit order, with their new versions.

### 8.4 Scope

Anchors are resolved only for units that the command can select:

- without targets: every unit;
- with targets: the target units, and every unit that depends on one of them at runtime, directly or through other units.

So an unrelated unit with no tag does not block `bump patch foo`.

## 9. Release flow

### 9.1 Order

1. Parse the arguments (§4).
2. Find the root and read the config (§5).
3. Discover the packages (§6) and build the units (§7).
4. Check the preconditions and resolve the anchors (§8).
5. Detect changes (§9.2) and select the units (§9.3, §9.4).
6. Compute each unit's next version (§10).
7. Compute the range edits (§11) and the file edits (§12).
8. Run the preflight checks (§14.1).
9. Print the result (§13). If `--dryrun`, stop here.
10. Write, commit, and tag (§14.2).

### 9.2 Change detection

A unit is **changed** when a file that one of its members owns changed since the unit's anchor, by a commit that is not a release commit. Use `-z` on every git command that prints paths: without it, git quotes non-ASCII paths.

1. **Changed files**: `git diff -z --name-only --no-renames <anchor> HEAD --`.
2. **Owners**: for each file, find the deepest package directory (of any package, versioned or not) that holds the file. Every package in that directory owns the file. A file under no package directory is ignored. A root package (`.`) owns every file that no deeper package owns.
3. **Release commits**: `git for-each-ref --format='%(refname:short)%00%(objectname)%00%(*objectname)' refs/tags`. Keep the tags that match the tag expression of any unit. The commit of a tag is `%(*objectname)` when it is not empty (an annotated tag, peeled), else `%(objectname)`.
4. **Remove the changes that only release commits made**:
   - `git rev-list --no-merges <anchor>..HEAD` lists the commits. Split them into release commits and other commits.
   - For each set, pipe its SHAs to `git diff-tree --stdin -z -r --no-commit-id --name-only --no-renames`. This gives the files of release commits `R`, and the files of other commits `S`.
   - A changed file from step 1 is removed if it is in `R` and not in `S`. A file in neither set was changed by a merge resolution, and it counts.

Step 4 exists because one unit's release commit can edit files that another unit owns: a dev-dependency range (§11.1), a `Cargo.lock`, or `[workspace.dependencies]`. Without step 4, that other unit would count as changed in the next release, with no real change.

Units with reason `first` or `adopted` have no anchor. All of them count as changed.

### 9.3 Selection

**Lockstep mode.** The unit is selected if it is changed, `first`, or `adopted`, or if `--all` is set. Else there is nothing to release.

**Independent mode.**

1. Seeds:
   - without targets: each unit that is changed, `first`, or `adopted`; with `--all`, every unit;
   - with targets: the units of the targets, changed or not. A package name selects that package's unit. Other changed units are not selected. An unknown target is an error that lists all unknown targets.
2. Dependents: repeat until nothing is added. Each unit that depends at runtime (§7.6) on a selected unit is selected, unless it is already selected.

If no unit is selected, print `nothing to release` and exit 0. With `--json`, see §13.2.

### 9.4 Reasons

Each selected unit has exactly one reason. When several apply, the first in this list wins:

1. `target`: named on the command line.
2. `first`: version `0.0.0` with no tag.
3. `adopted`: no anchor, with `--adopt`.
4. `changed`: files changed since the anchor.
5. `all`: `--all`.
6. `dependent`: a runtime dependency is released.

### 9.5 Applied type

- A seed gets the command's type or exact version.
- A dependent gets a type from §10.5.

### 9.6 Order

Units and the members inside a unit use the same ordering algorithm, Kahn's algorithm with a priority queue:

1. The edges are runtime dependencies: unit dependencies (§7.6) for units, runtime internal dependencies (§11.1) between members for members.
2. The ready set holds the nodes whose dependencies are all already output. Output the smallest ready name in byte order. Repeat.
3. If nodes remain but none is ready (a cycle), output the smallest remaining name, and continue.

The lockstep unit has no name. It is alone, so it needs no compare.

This order is used for the log, `{tags}`, tag creation, and `--json`.

## 10. Version rules

### 10.1 From a stable version

From `1.2.3`:

| Type | Result |
|---|---|
| `major` | `2.0.0` |
| `minor` | `1.3.0` |
| `patch` | `1.2.4` |
| `premajor` | `2.0.0-<preid>.0` |
| `preminor` | `1.3.0-<preid>.0` |
| `prepatch` | `1.2.4-<preid>.0` |
| `prerelease` | `1.2.4-<preid>.0` (the same as `prepatch`) |

### 10.2 From a prerelease

From `1.3.0-next.2`:

| Type | Result | Rule |
|---|---|---|
| `patch` | `1.3.0` | Graduate: remove the prerelease. |
| `minor` | `1.3.0` | Graduate if the patch is `0`. From `1.3.1-next.0`, it gives `1.4.0`. |
| `major` | `2.0.0` | Graduate if minor and patch are `0`. From `2.0.0-next.3`, it gives `2.0.0`. |
| `premajor` | `2.0.0-<preid>.0` | Always start a new line. |
| `preminor` | `1.4.0-<preid>.0` | Always start a new line. |
| `prepatch` | `1.3.1-<preid>.0` | Always start a new line. |
| `prerelease` | `1.3.0-next.3` | Continue the line. |
| `prerelease --preid rc` | `1.3.0-rc.0` | A different preid starts a new line on the same version. |

For the prerelease forms that §10.4 accepts, these rules match node-semver `inc()`.

### 10.3 Which preid

- **Starting a line** (`premajor`, `preminor`, `prepatch`, or `prerelease` from a stable version): `--preid`, else the config `preid`, else `next`. This is the **command preid**.
- **Continuing** (`prerelease` from a prerelease): the current preid, unless `--preid` is given.

### 10.4 Prerelease format

- A preid matches `[0-9A-Za-z-]+` and is not only digits.
- `bump` makes only prereleases of the form `X-<preid>.<n>`.
- To continue a current prerelease:
  - `X-<id>.<n>` gives `X-<id>.<n+1>`;
  - `X-<id>` gives `X-<id>.0`;
  - any other form (for example `1.3.0-0` or `1.3.0-a.b.c`) is an error that names the unit and asks for an exact version. If the unit is a dependent, the message says to release it as a target with an exact version first.
- Build metadata (`+…`) on a current version is dropped. New versions never have build metadata.

### 10.5 Dependents

First compute the new versions of all seeds. Then compute the dependents as a fixed point, because dependents can form cycles:

1. Each dependent is **pre-triggered** if a unit it depends on directly has a new version that is a prerelease. A dependent's new version is a prerelease when its current version is a prerelease, or when it is pre-triggered. Start with no dependent pre-triggered, and repeat until nothing changes. The result does not depend on the order, because the flag only goes from false to true.
2. Then apply:

| Dependent's current version | Pre-triggered | Applied type | Preid |
|---|---|---|---|
| stable | no | `patch` | — |
| stable | yes | `prepatch` | see below |
| prerelease | either | `prerelease` | its own current preid; `--preid` does not apply to dependents |

The preid of a stable, pre-triggered dependent: collect the preids of the new versions of every seed and every already-prerelease dependent that it depends on, directly or through other selected units. If there is exactly one preid, use it. Else use the command preid (§10.3).

Examples, with trigger `app` and dependent `cli`:

- `app` 1.2.0 → 1.3.0: `cli` 0.4.1 → `0.4.2`.
- `app` 1.2.0 → 1.3.0-next.0: `cli` 0.4.1 → `0.4.2-next.0`.
- `bump 2.0.0-rc.0 app`: `cli` 0.4.1 → `0.4.2-rc.0`.
- `app` 1.3.0-next.0 → 1.3.0-next.1: `cli` 0.4.2-next.0 → `0.4.2-next.1`.

### 10.6 Exact version

Every seed gets the same exact version. Dependents follow §10.5.

### 10.7 Checks

- Every new version must be greater than the unit's current version. Otherwise stop with an error that names the unit and both versions. This catches a preid that sorts lower (`--preid beta` from `1.3.0-next.2` gives `1.3.0-beta.0`), and an exact version that is not higher.
- No new tag can exist. Collect all existing tags and list them in one error.

## 11. Internal dependency ranges

### 11.1 Internal dependencies

An **internal dependency** is a dependency entry whose dependency name (§11.2, §11.3) is the name of a discovered package **of the same ecosystem**. Every range form counts, also forms that §11.4 keeps as they are (`workspace:*`, a path-only Cargo entry). An npm entry whose range starts with `npm:` is an alias to another package, and is not internal.

Each internal dependency is **runtime** or **dev** (§11.2, §11.3).

- Runtime dependencies make unit dependencies (§7.6) and cause dependent releases.
- Dev dependencies get range edits only.

For every package (released or not, versioned or not) and every internal dependency on a member of a **released** unit, compute the new range (§11.4). If it differs from the old range, edit it.

### 11.2 npm

| Field | Kind |
|---|---|
| `dependencies` | runtime |
| `peerDependencies` | runtime |
| `optionalDependencies` | runtime |
| `devDependencies` | dev |

The dependency name is the object key.

### 11.3 Cargo

| Table | Kind |
|---|---|
| `dependencies`, `build-dependencies` | runtime |
| `target.<cfg>.dependencies`, `target.<cfg>.build-dependencies` | runtime |
| `dev-dependencies`, `target.<cfg>.dev-dependencies` | dev |

Forms of an entry:

- `foo = "1.2.0"`: the string is the range.
- `foo = { path = "../foo", version = "1.2.0" }`, or a `[dependencies.foo]` table: the `version` key is the range.
- `foo = { workspace = true }`: the range is the `[workspace.dependencies]` entry for `foo` in the Cargo workspace root (§7.4). Edit it there, one time. It is runtime if any entry that refers to it is runtime.
- An entry with `path` and no `version`: nothing to edit. It still counts as an internal dependency.
- `bar = { package = "foo", … }`: the dependency name is `foo`, not `bar`.

### 11.4 Range rewrite

Trim the range, and match it with:

```
^(\^|~|=)?v?(?:(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?|(\d+)\.(\d+)|(\d+))$
```

If it does not match, keep the range as it is. This covers `workspace:*`, `workspace:^`, `*`, `latest`, `1.x`, `>=1.0.0 <2`, `file:…`, `npm:…`, and Git or path sources.

If it matches, the new range is the same prefix (`^`, `~`, `=`, or none) and the new version, with the same precision. The new range has no surrounding whitespace and no `v`.

| Old range | New version | New range |
|---|---|---|
| `^1.2.0` | `2.0.0` | `^2.0.0` |
| `~1.2.3` | `1.3.0` | `~1.3.0` |
| `1.2` | `2.0.0` | `2.0` |
| `^1.2` | `1.3.0` | `^1.3` |
| `1` | `2.0.0` | `2` |
| `1.2` | `1.3.0-next.0` | `1.3.0-next.0` (a prerelease always uses all three numbers) |
| `v1.2.0` | `1.3.0` | `1.3.0` |

## 12. File edits

### 12.1 Edit model

All edits are computed first, checked, and written only after every check passes.

- An adapter turns changes into edits. A change is "set the version of package P", "set the range of dependency D in package P", "set `[workspace.package] version`", "set the range of D in `[workspace.dependencies]`", or "set the `Cargo.lock` version of crate C".
- An edit is `{ file, text }`: the full new text of one file.
- Several changes to one file make one edit.

### 12.2 Targeted text edits

Every format is edited by replacing only the characters of the old value inside its quotes. The rest of the file stays byte for byte the same: comments, key order, whitespace, indentation, line endings, the final newline.

- **JSON**: find the value by its key path. Do not serialize the file again: `JSON.stringify` changes escapes and number formats. Bun accepts comments and trailing commas in `package.json`, so scan the output of `jsonc.toJSON(text)`: it turns them into spaces and keeps every offset, so the spans apply to the original text. The parse-again check uses `jsonc.parse`.
- **TOML**: any valid TOML way of writing the keys must work. This includes:
  - standard tables (`[package]`, `[dependencies.foo]`, `[workspace.package]`);
  - array tables (`[[package]]` in `Cargo.lock`);
  - dotted keys (`version.workspace = true`, `package.version = "1.0.0"` at the top level);
  - inline tables (`foo = { version = "1.2.0" }`);
  - quoted keys and headers (`target.'cfg(unix)'.dependencies`, `target."cfg(unix)".dependencies`, `target.x86_64-unknown-linux-gnu.dependencies`);
  - basic (`"…"`) and literal (`'…'`) strings. Keep the string's quote style.

### 12.3 Parse-again check

For each edit:

1. Parse the original text, and apply the intended changes to that parsed value.
2. Parse the new text.
3. The two values must be deeply equal. If not, stop with an error that names the file, before anything is written.

This makes a bug in the text edits fail safely.

### 12.4 What each adapter writes

- **npm**: `version` of each released member, and the ranges of §11.2.
- **Cargo**:
  - `[package] version` of each released member that has its own version;
  - for crates that inherit the version: `[workspace.package] version` of their Cargo workspace root, one time;
  - the ranges of §11.3, including `[workspace.dependencies]`;
  - `Cargo.lock` in the Cargo workspace root (§7.4), only if git tracks it (`git ls-files --error-unmatch`). If git does not track it, do not write it: Cargo makes it again. In it:
    - for each `[[package]]` entry with no `source` key and the name of a released crate: the `version`;
    - each string `"<name> <version>"` in a `dependencies` array, where `<name>` is a released crate: the version part.
  - Every tracked `Cargo.lock` of any discovered crate gets these changes, not only the lockfile of the released crates' own workspace: a path dependency can cross workspaces.

- **npm lockfiles** (§12.5).

Write no other file. `bump.json` is never written.

### 12.5 npm lockfiles

npm lockfiles can record workspace versions and internal ranges. A stale lockfile makes a frozen install (`npm ci`, `bun install --frozen-lockfile`, `pnpm install --frozen-lockfile`) fail. Their formats belong to their package managers, so `bump` runs the package manager to update them, and does not edit them as text.

When at least one npm package is released or gets a range edit, check the root (§5.1) for each lockfile that git tracks:

| Lockfile | Command, run in the root |
|---|---|
| `package-lock.json` | `npm install --package-lock-only --ignore-scripts` |
| `bun.lock` or `bun.lockb` | `bun install --lockfile-only --ignore-scripts` |
| `pnpm-lock.yaml` | `pnpm install --lockfile-only --ignore-scripts --no-frozen-lockfile` |
| `yarn.lock`, Yarn 2 or later | `yarn install --mode=update-lockfile --no-immutable` |

- A lockfile that git does not track is not updated.
- Yarn 1 has no lockfile-only mode. For a `yarn.lock` with Yarn 1 (`yarn --version` starts with `1.`), print a warning that the lockfile is not updated.
- Several lockfiles: run each command, in the order of the table.
- These commands can need network access. They do not install packages and do not run scripts.
- In CI (`CI=1`), pnpm and Yarn freeze their lockfiles by default. `--no-frozen-lockfile` and `--no-immutable` turn that off, because the update is the goal.
- The commands run after the manifests are written (§14.2). Their output cannot get the parse-again check.
- A lockfile is in `files` (§13.2) only if its text changed. With `--dryrun`, the commands do not run, and `files` lists every lockfile that would be updated.

## 13. Output

### 13.1 Human log

The library sends each log line to the `log` function of §13.3. The CLI prints the lines to stdout, or to stderr with `--json`. Example:

```
~> fast 1.2.0 → 1.3.0 (changed)
     @acme/fast-darwin-arm64, @acme/fast-linux-x64-gnu, @acme/fast, acme-fast
~> @acme/cli 0.4.1 → 0.4.2 (dependent)
~> @acme/cli dependencies["@acme/fast"]: ^1.2.0 → ^1.3.0
~> Cargo.toml workspace.dependencies["acme-core"]: 1.2 → 1.3
release: fast@1.3.0, @acme/cli@0.4.2 (a1b2c3d)
```

- One line per unit, in unit order: `~> <name> <from> → <to> (<reason>)`. In lockstep mode, the name is left out: `~> 1.2.0 → 1.3.0 (changed)`.
- Below a unit, one member line, in member order, when the unit has more than one member, or when its only member's name differs from the unit name.
- Then one line per range edit: `~> <package> <field>["<dependency>"]: <from> → <to>`. For an edit that belongs to no package (`[workspace.dependencies]`), the file path relative to the git top level replaces the package name.
- The last line is `release: <message> (<sha>)`, with the SHA from `git rev-parse --short <sha>`.
- With `--dryrun`, the last line is `dry run: no files were written`. If tracked files have changes, a dry run still runs and prints a warning (§4.4) that lists them.
- When nothing is selected, the only line is `nothing to release`.

### 13.2 JSON result

`version()` returns this object. `--json` prints it as JSON on stdout, and stdout has nothing else.

```json
{
  "dryrun": false,
  "type": "minor",
  "commit": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  "message": "release: fast@1.3.0, @acme/cli@0.4.2",
  "units": [
    {
      "name": "fast",
      "type": "minor",
      "tag": "fast@1.3.0",
      "from": "1.2.0",
      "to": "1.3.0",
      "reason": "changed",
      "packages": [
        { "name": "@acme/fast-darwin-arm64", "ecosystem": "npm", "dir": "npm/darwin-arm64", "publish": true },
        { "name": "@acme/fast-linux-x64-gnu", "ecosystem": "npm", "dir": "npm/linux-x64-gnu", "publish": true },
        { "name": "@acme/fast", "ecosystem": "npm", "dir": ".", "publish": true },
        { "name": "acme-fast", "ecosystem": "cargo", "dir": ".", "publish": true }
      ]
    },
    {
      "name": "@acme/cli",
      "type": "patch",
      "tag": "@acme/cli@0.4.2",
      "from": "0.4.1",
      "to": "0.4.2",
      "reason": "dependent",
      "packages": [
        { "name": "@acme/cli", "ecosystem": "npm", "dir": "packages/cli", "publish": true }
      ]
    }
  ],
  "ranges": [
    { "file": "packages/cli/package.json", "package": "@acme/cli", "dependency": "@acme/fast", "field": "dependencies", "from": "^1.2.0", "to": "^1.3.0" }
  ],
  "files": ["Cargo.lock", "Cargo.toml", "npm/darwin-arm64/package.json", "npm/linux-x64-gnu/package.json", "package.json", "packages/cli/package.json"]
}
```

| Field | Rule |
|---|---|
| `dryrun` | `true` with `--dryrun`. |
| `type` | The command's input: one of the seven types, or `"exact"` for an exact version. |
| `commit` | The full SHA of the release commit. `null` with `--dryrun` or when nothing is released. |
| `message` | The commit subject. `null` when nothing is released. With `--dryrun`, the subject that would be used. |
| `units` | The selected units, in unit order (§9.6). Empty when nothing is released. |
| `units[].name` | `null` in lockstep mode. |
| `units[].type` | The type applied to this unit (§9.5, §10.5), or `"exact"`. |
| `units[].reason` | A reason of §9.4. |
| `units[].packages` | The members, in member order (§9.6). |
| `ranges` | Every range edit, in the order of the log. `package` is `null` for `[workspace.dependencies]`. `field` is the npm field name, or the Cargo table path with a target in single quotes (`dependencies`, `target.'cfg(unix)'.dependencies`, `workspace.dependencies`). |
| `files` | Every written file (with `--dryrun`, every file that would be written), sorted in byte order. |

All paths are relative to the git top level and use `/`. There is no `prerelease` field: it follows from `to`.

With `--json`, an error is plain text on stderr and exit code 1, with nothing on stdout.

### 13.3 Library API

```ts
export type Type = 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch' | 'prerelease';

export type Config = {
  $schema?: string;
  independent?: boolean;
  packages?: string | [string, ...string[]];
  groups?: Record<string, [string, ...string[]]>;
  preid?: string;
  tag?: string;
  message?: string;
};

export type Options = Omit<Config, '$schema' | 'preid'> & {
  cwd?: string;
  targets?: string[];
  all?: boolean;
  preid?: string;
  adopt?: boolean;
  dryrun?: boolean;
  log?: (line: string) => void;
};

export function version(input: Type | string, options?: Options): Promise<Result>;

export class Interrupt extends Error {
  signal: 'SIGINT' | 'SIGTERM';
}
```

The package exports `.` (`index.js` with `index.d.ts`), `./schema.json`, and `./package.json`. `version()` throws an `Interrupt` after the undo of a release that a signal stopped.

- `Config` is the shape of the config file (§5.2).
- `Options` takes every `Config` key except `$schema` and `preid`. An inline key replaces the same key of the config file, and its errors end with `in the options`. `Options.preid` is the `--preid` override of §10.3, not the config default.
- `Result` is the object of §13.2.
- Without `log`, the library prints nothing. Warnings go to `log` too, with their `warning: ` prefix.
- Errors are thrown as `Error` objects with the messages of this document. The CLI prints them as §4.4 says.

### 13.4 JSON schema

The build generates `schema.json` from the `Config` type in `index.d.ts`, with `ts-json-schema-generator` (it brings its own TypeScript 5, because TypeScript 7 has no compiler API). JSDoc tags carry the rules a type cannot: `@pattern` for `preid`, `@minLength` for `tag` and `message`, and `@default` values. The placeholder rules of §5.3 stay runtime checks only. A test checks that the schema keys equal the keys that §5.2 accepts.

## 14. Git operations

### 14.1 Preflight

These checks run before anything is written. A dry run runs the same checks; only the dirty-tree check becomes a warning there.

- Tracked files are clean: `git status --porcelain --untracked-files=no` is empty. If not, list the files.
- No merge, rebase, cherry-pick, revert, or bisect is in progress. Check `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`, `rebase-merge`, and `rebase-apply` with `git rev-parse --git-path <name>`.
- Every file to write, except an untracked `Cargo.lock` (§12.4), is tracked by git. List the files that are not.
- Each package manager that §12.5 needs is on `PATH` (`<binary> --version` succeeds). Else the error names the binary and the lockfile.
- The checks of §10.7.
- Every new tag is a valid ref name (§5.3).
- Every edit passes the parse-again check (§12.3).
- Record the original HEAD SHA, and the original text of every file to write, including the lockfiles of §12.5.

### 14.2 Release

In this order:

1. Write the files.
2. Update the npm lockfiles (§12.5). Add each lockfile whose text changed to the files.
3. `git add -- <files>`.
4. `git commit --message <message> -- <files>`. Hooks run normally. There is no `--no-verify`.
5. Record the release commit: the first commit after the original HEAD on the first-parent line of HEAD (`git rev-list --first-parent --reverse <original HEAD>..HEAD`). A `post-commit` hook runs before `git commit` returns, so HEAD can already point to a later commit.
6. For each unit, in unit order: `git tag --annotate --message <tag> <tag> <release commit>`. Name the commit explicitly, because a `post-commit` hook can move HEAD. Git config such as `tag.gpgSign` applies.

### 14.3 Undo

If any step of §14.2 fails, or the process gets SIGINT or SIGTERM during §14.2, undo in reverse order:

1. Delete each tag that this run created (`git tag -d`).
2. If the commit was made: `git reset --soft <original HEAD>`. Use the recorded SHA, not `HEAD~1`, because a `post-commit` hook can add commits.
3. Write back the original text of each file, from memory. Then unstage them: `git reset --quiet <original HEAD> -- <files>`.
4. Throw the original error.

If the undo itself fails, print both errors and the remaining state: the tags that still exist, the commit SHA if it still exists, the files that differ, and the commands to clean up by hand. Never hide the first error.

Tags are created one at a time, not with an atomic `git update-ref --stdin` transaction. Atomic creation needs existing tag objects, and making them with `git mktag` skips tag signing. The most likely failure is signing, and it fails on the first tag, when only the commit must be undone.

## 15. Migration from 1.0.0-next

- `bump.json` loses `version`, `single`, and `all` (§5.2 gives the messages).
- A lockstep repository from the old sparse behavior can have members with different versions. §7.5 then stops with the list. The user sets one version in all manifests, commits, and tags that commit, or uses `--adopt`.
- Tags keep the `v{version}` form in lockstep mode, so old tags stay valid anchors.

## 16. Tests

The tests are end to end:

- Build the program once before the tests.
- For each test, make a temporary directory with symlinks resolved, and a git repository in it.
- Give each repository its own git config: set `HOME` to a directory inside the temporary directory, `GIT_CONFIG_GLOBAL` to a `.gitconfig` there with `user.name`, `user.email`, and `init.defaultBranch`, and `GIT_CONFIG_NOSYSTEM=1`. Ignore that home directory in `.gitignore`.
- Commit the files, and tag them with annotated, unsigned tags where the test needs anchors.
- Run the CLI as a subprocess, and check the files, the commits, the tags, the exit code, and stdout and stderr.
- To test signing, set `tag.gpgSign=true`, `user.signingkey`, and `gpg.program` to a shell script. The passing script reads stdin, prints `[GNUPG:] SIG_CREATED ` to stderr, and prints a fake `-----BEGIN PGP SIGNATURE-----` block to stdout. The failing script prints an error to stderr and exits 2.
- Delete the temporary directories after each test.

Each rule needs at least one test. Required scenarios:

- **CLI**: help, version, their precedence, an unknown option, a missing option value, each conflict of §4.3, each invalid first positional, the exit codes.
- **Discovery**: globs with `!` exclusions on parents; `.`; each workspace file kind; per-ecosystem member sets; Cargo implicit path members; npm and Cargo mixed; two packages in one directory; duplicate names; a manifest without a name; a Cargo virtual manifest; a package without a version; each `publish` form.
- **Config**: every validation error of §5.2 and §5.3, including the removed keys; the `bump.json` search stops at the git top level; not a git repository.
- **Units**: groups; every group error; a versionless package as target or member; each case of §7.4, also two Cargo workspaces in one repository; members that disagree.
- **Anchors**: each rule and each example of §8.2; the no-anchor error text; `--adopt`; scope with targets (§8.4); a shallow clone; a repository with no commits.
- **Change detection**: a change in a subfolder; nested package directories; a file owned by two packages; a root package; a non-ASCII file name; a release commit that edits another unit's dev range or `Cargo.lock`, which must not count; a change by a merge resolution, which must count.
- **Selection**: lockstep with and without changes; independent with changes, with targets, with an unknown target, with a group target, with a member target; `--all`; transitive dependents; a dependency cycle; unit and member order.
- **Versions**: every row of §10.1, §10.2, and §10.5, and its examples; the fixed point with a cycle; preid resolution; every error of §10.4 and §10.7; exact versions.
- **Ranges**: every row of §11.4 and every kept form; each npm field and each Cargo form of §11.3; `[workspace.dependencies]`; a renamed Cargo dependency; an `npm:` alias; same names in different ecosystems.
- **Edits**: byte-for-byte preservation of JSON and TOML with comments, tabs, CRLF, no final newline, and each TOML form of §12.2; the parse-again check (force a bad edit); `Cargo.lock` tracked and untracked; inherited Cargo versions.
- **Git**: a signed tag; a failing hook; a `post-commit` hook that adds a commit; a failing first tag and a failing later tag, each fully undone; an existing tag; a merge in progress; a dirty tree; an untracked manifest; a dry run on a dirty tree; a detached HEAD.
- **Lockfiles**: for each package manager of §12.5, a release leaves a lockfile that passes its frozen install; an untracked lockfile is not touched; a missing package manager binary; a failing lockfile command, fully undone; Yarn 1 warning; `--dryrun` lists the lockfile and runs nothing. The test environment needs npm, pnpm, and Yarn 2 or later. If one is missing, the test setup fails; tests are never skipped.
- **Output**: the human log; the full `--json` shape; `--json` with nothing to release; `--json --dryrun`; `--json` with an error.
