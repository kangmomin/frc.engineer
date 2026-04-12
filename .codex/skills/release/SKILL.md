---
name: release
description: Execute the frc.engineer release workflow by adapting the project's Claude /release command to Codex. Use when the user asks to release, publish, tag, build deploy artifacts, or create a GitHub release for this repo.
---

# Release

Use this skill for project releases in `frc.engineer`.

## Sources of truth

- Base workflow: `.claude/commands/release.md`
- Current project rules: `CLAUDE.md` "Release & Deploy"
- Detailed notes: `docs/deployment-guide.md`

## Version rules

- If the user supplies a version, use it.
- Otherwise fetch deploy tags from `build/deploy-inspect-1` and bump the latest deploy tag's minor version.
- Current project source of truth is `apps/setup-manager/package.json` `version`.
- Keep these in sync for release:
  - `apps/setup-manager/package.json` `version` without leading `v`
  - `cmd/sender/main.go` `appVersion` with leading `v`
- Do not update `cmd/server/update_notice.go` unless the release explicitly targets the server binary flow.

## Release steps

1. Verify prerequisites:
   - clean understanding of current git state
   - `gh auth status`
   - release repos exist: `build/source-deploy-1`, `build/deploy-inspect-1`
2. Determine the release version.
3. Update version files in the main repo.
4. Commit and push the main repo release changes.
5. Sync `build/source-deploy-1` to `origin/main`.
6. Build sender Windows GUI binary:
   - `GOOS=windows GOARCH=amd64 go build -ldflags "-H windowsgui" -o frc-pitwall-sender.exe ./cmd/sender`
   - verify with `file frc-pitwall-sender.exe` and require `PE32+` and `GUI`
   - copy to `build/artifacts/frc-pitwall-sender.exe`
7. Build Electron Windows artifacts in `apps/setup-manager`:
   - install deps if needed
   - run the Windows distribution script that works in the current environment
   - collect `Minmo-Driver-Pack-Setup.exe`, `Minmo-Driver-Pack-Setup.exe.blockmap`, and `latest.yml` from `apps/setup-manager/release/`
8. Sync `build/deploy-inspect-1` to `origin/main`.
9. Delete legacy versioned installer / blockmap / portable files from `build/deploy-inspect-1/`, then copy only the latest release artifacts into it.
10. Commit deploy repo changes, tag, and push branch + tag.
11. Create GitHub release in deploy repo with the generated `.exe` assets.
12. Tag and push the main repo with the same release version.
13. Report:
   - release version
   - source commit
   - deploy commit
   - uploaded assets
   - release URL

## Safety checks

- Never revert unrelated user changes in the main repo.
- If the working tree contains unrelated tracked changes that would contaminate the release, stop and ask only if there is no safe way to proceed.
- Prefer committing only the files required for the release.
- If Electron Windows packaging cannot run in the current environment, state that clearly and stop before creating tags/releases.
- Use `--notes-file` for release notes when creating the GitHub release.

## Notes template

Write release notes in Korean and include:

- 릴리즈 제목
- 포함 산출물 목록
- source commit hash
- deploy commit hash
