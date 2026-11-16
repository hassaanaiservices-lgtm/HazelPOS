// Installers for restaurants are built on GitHub's Windows machine only (.github/workflows/desktop.yml).
// A Windows installer built on Linux or Mac carries that system's native parts (e.g. sharp, which sends the WhatsApp
// menu pictures): the POS starts, but menu pictures fail. This stops a local build from being given to a client by mistake.
// A throw-away test build is still possible on purpose:  ALLOW_CROSS_BUILD=1 npm run dist:win
if (process.platform === 'win32' || process.env.CI || process.env.ALLOW_CROSS_BUILD === '1') process.exit(0);
console.error(`
Not building: this is ${process.platform}, and the installer for restaurants must be built on Windows.
Push a version tag and GitHub builds it:   git tag v1.0.1 && git push --tags     (see desktop/README.md)
For a test build only (never give it to a client):   ALLOW_CROSS_BUILD=1 npm run dist:win
`);
process.exit(1);
