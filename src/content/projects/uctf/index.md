---
title: "UCTF"
description: "Managed CTF hosting: CTFd, per-team instanced challenges and git-synced deployment"
date: 2025-09-01
demoURL: "https://uctf.io"
---

UCTF is a platform for hosting capture-the-flag competitions without building the infrastructure yourself. It grew out of two events we ran on our own Kubernetes cluster: organisers kept needing the same things, so I turned them into a product — managed CTFd, challenges that can be instanced per team, and a deployment pipeline that follows a git repository.

## Features

- Managed CTFd instance, with themes and plugins delivered for you
- Shared and per-team instanced challenges, spun up on demand
- Git-synced challenge delivery straight from a GitHub repository
- Bring your own container images, so nothing is locked to the platform
- Custom domain with TLS and 10 GB of included storage
- Discord and generic webhooks, plus CTFtime support

## Technologies Used

- Kubernetes for scheduling the short-lived challenge instances
- Go for the instancer and the control plane
- CTFd as the scoreboard and player-facing platform
- Container registries and git as the delivery path for challenges

Two write-ups cover the events behind it: [How (not) to host your CTF](/blog/how-not-to-build-a-ctf/) on the first one, and [Universal CTF: 32 hours in data](/blog/universal-ctf-32-hours-in-data/) on the second, which ran 608 players and 3,807 throwaway pods on this platform.
