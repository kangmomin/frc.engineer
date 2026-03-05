# Update Check

The program checks for a newer deploy release at startup.

## Target
- GitHub Release: `https://github.com/kangmomin/frc.engineer-deploy/releases/tag/main`
- API: `https://api.github.com/repos/kangmomin/frc.engineer-deploy/releases/tags/main`

## Behavior
1. On startup, fetch the latest release metadata.
2. Compare local build info with the latest release.
3. If an update is available, show: `Open update page now? [Y/n]`.
4. `Y` (or Enter): open the release page and exit the program.
5. `N`: skip update and continue normal startup.

## Version Rule
- Version format: `major.minor.patch`
- Normal commit build: increase `patch` (3rd depth)
- Release build: increase `minor` (2nd depth)

## Disable
- Set `FRC_SKIP_UPDATE_CHECK=1` to skip update check at startup.
