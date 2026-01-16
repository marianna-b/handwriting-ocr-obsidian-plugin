#!/bin/bash

# Release script for Handwriting OCR Plugin
# Usage: ./release.sh <version>
# Example: ./release.sh 1.0.1

set -e

if [ -z "$1" ]; then
  echo "Usage: ./release.sh <version>"
  echo "Example: ./release.sh 1.0.1"
  exit 1
fi

VERSION=$1

# Validate version format
if ! [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must be in format X.Y.Z (e.g., 1.0.1)"
  exit 1
fi

echo "Creating release for version $VERSION"

# Check if working directory is clean
if ! git diff-index --quiet HEAD --; then
  echo "Error: Working directory has uncommitted changes"
  exit 1
fi

# Update version in package.json and manifest.json
echo "Updating version numbers..."
npm version "$VERSION" --no-git-tag-version

# Build the plugin
echo "Building plugin..."
npm run build

# Commit version changes
echo "Committing version changes..."
git add package.json package-lock.json manifest.json versions.json
git commit -m "chore: bump version to $VERSION"

# Create and push tag
echo "Creating and pushing tag..."
git tag "$VERSION"
git push origin main
git push origin "$VERSION"

echo ""
echo "✅ Release process initiated!"
echo "GitHub Actions will build and create a draft release at:"
echo "https://github.com/marianna-b/handwriting-ocr-obsidian-plugin/releases"
echo ""
echo "Next steps:"
echo "1. Wait for GitHub Actions to complete"
echo "2. Edit the draft release to add release notes"
echo "3. Publish the release"
