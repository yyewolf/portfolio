---
title: "GitLab CI Visualizer"
description: "Preview a GitLab pipeline as a graph before you push it"
date: 2026-05-22
repoURL: "https://github.com/yyewolf/gitlab-ci-visualizer"
---

GitLab CI Visualizer parses a `.gitlab-ci.yml` and simulates what the pipeline would do under a given set of conditions — branch, pipeline source, variables — then draws the result as a graph. It answers the question that usually costs a few throwaway commits: which jobs actually run here, and why?

## Features

- Interactive graph with stage lanes, dependency edges and artifact flow between jobs
- Evaluates `rules:`, `only:` and `except:`, with a trace of how each decision was reached
- Resolves `extends:` and expands `parallel:matrix` definitions
- Job metadata at a glance: `allow_failure`, `retry`, coverage, trigger status
- GitLab API integration to resolve `include:` and downstream pipelines
- VSCode extension with live preview, plus a `glvis` CLI that opens the graph in a browser

## Technologies Used

- Go for the parser, rule evaluation and API
- React and TypeScript for the graph frontend
- GitLab API for remote includes and child pipelines

MIT licensed.
