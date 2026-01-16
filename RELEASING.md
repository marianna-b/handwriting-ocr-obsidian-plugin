# Release Process

This document describes how to create a new release of the Handwriting OCR plugin.

## Prerequisites

- All changes committed and pushed to `main` branch
- Clean working directory (no uncommitted changes)
- GitHub CLI installed (optional, for manual releases)

## Automated Release (Recommended)

Use the release script to automate the entire process:

```bash
./release.sh 1.0.1
```

This script will:
1. Validate the version format
2. Check for uncommitted changes
3. Update version in `package.json`, `manifest.json`, and `versions.json`
4. Build the plugin
5. Commit the version changes
6. Create and push a git tag
7. Trigger GitHub Actions to create a draft release

## Manual Release

If you prefer to release manually:

### 1. Update Version

```bash
npm version 1.0.1 --no-git-tag-version
```

### 2. Build Plugin

```bash
npm run build
```

### 3. Commit Changes

```bash
git add package.json package-lock.json manifest.json versions.json
git commit -m "chore: bump version to 1.0.1"
```

### 4. Create and Push Tag

```bash
git tag 1.0.1
git push origin main
git push origin 1.0.1
```

### 5. Wait for GitHub Actions

GitHub Actions will automatically:
- Build the plugin
- Create a draft release with `main.js`, `manifest.json`, and `styles.css`

## Final Steps

After the automated process completes:

1. Go to [Releases](https://github.com/marianna-b/handwriting-ocr-obsidian-plugin/releases)
2. Find your draft release
3. Edit the release to add:
   - Release notes describing changes
   - Any breaking changes or migration notes
4. Publish the release

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes
- **MINOR** (0.X.0): New features, backwards compatible
- **PATCH** (0.0.X): Bug fixes, backwards compatible

## Troubleshooting

### Release script fails with uncommitted changes

Commit or stash your changes before running the release script.

### GitHub Actions fails

Check the [Actions tab](https://github.com/marianna-b/handwriting-ocr-obsidian-plugin/actions) for error details. Common issues:
- Build failures (check TypeScript errors)
- Missing dependencies

### Tag already exists

If you need to recreate a tag:

```bash
git tag -d 1.0.1
git push origin :refs/tags/1.0.1
./release.sh 1.0.1
```
