# Code signing policy

Lipit Capture will use SignPath Foundation's free code signing service for public open source releases.

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## Release roles

- Source repository: [duhapolat/lipit-capture](https://github.com/duhapolat/lipit-capture)
- Committer, reviewer and release approver: [Muhammed Duha Polat](https://github.com/duhapolat)

Release signing will only accept artifacts produced from this repository's protected release workflow. Multi-factor authentication will be enabled for the source repository and SignPath account.

## Signing flow

1. GitHub Actions checks out an immutable version tag and runs the complete beta test gate.
2. The workflow builds the desktop application and Native Messaging host from source.
3. SignPath signs Lipit's own executable files. Upstream binaries keep their upstream identity and hashes.
4. The signed application is packaged as the NSIS installer.
5. SignPath signs the final setup executable after manual release approval.
6. GitHub Releases publishes the signed setup, SHA-256 checksums, source archive and release notes.

Private signing keys are generated and kept in SignPath's hardware security module. They are never stored in the repository or on a developer computer.

## Privacy

Lipit does not send analytics, advertising identifiers or crash reports. Network access happens only when the user requests media resolution, downloading, an engine update or an explicitly enabled compatibility component. See [PRIVACY.md](../PRIVACY.md).
