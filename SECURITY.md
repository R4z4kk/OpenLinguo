# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/R4z4kk/OpenLinguo/security/advisories/new). Do not open a public issue.

Include the affected component, steps to reproduce, and the impact you observed. You'll get an acknowledgment within 7 days.

## Supported versions

Only the latest release (a `v*` tag, such as `v1.0.0`) and the `main` branch, which runs in production, receive security fixes. The other releases (`audio-zh-*`, `whisper-*`, `paraformer-*`) hold datasets, not versions of the app.

## Scope

In scope: the web app, the API, the data pipeline, and the CI configuration in this repository.

Out of scope: third-party AI providers configured by users (bring your own key), and vulnerabilities in dependencies that are already tracked by Dependabot.
