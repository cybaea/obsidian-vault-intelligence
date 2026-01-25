---
name: project
description: Project-specific architecture, maintenance tasks, and unique conventions. Load when performing project-wide maintenance or working with the core architecture.
---

# Project Context

This skill provides the unique context and architectural details for this repository.

## Purpose

To provide guidance on project-specific structures and tasks that differ from general Obsidian development patterns.

## When to Use

Load this skill when:
- Understanding the repository's unique architecture.
- Performing recurring maintenance tasks.
- Following project-specific coding conventions.

## Project Overview

- **Primary Stack**: TypeScript, Obsidian API
- **Key Directories**: `src/`, `devs/`

## Core Architecture

- See `devs/ARCHITECTURE.md` for a high-level overview of the project's architecture.
- See `devs/adr/` for a collection of Architecture Decision Records (ADRs) that document key design decisions and their rationales.
- See `devs/` for additional documentation and notes.

## Key Files

- `manifest.json`: Plugin manifest
- `package.json`: Build scripts and dependencies
- `CHANGELOG.md`: Version history and release notes
- `styles.css`: Plugin styles

## Maintenance Tasks

- DO NOT change version numbers or attempt to release new versions! This is a manual process.
