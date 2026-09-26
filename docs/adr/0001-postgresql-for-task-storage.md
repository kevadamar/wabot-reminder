# 1. Use PostgreSQL for Task and State Storage

The initial PRD specified `bun:sqlite` for single-node local storage. We decided to adopt PostgreSQL to ensure scalability, ease of external management (e.g. pgAdmin, GUI dashboards, cloud-hosted DB), and support for horizontal growth.

## Context
The bot needs to persist tasks, reminder timestamps, conversation context states, and WhatsApp message ID mappings for reaction tracking. While SQLite is fast for single-instance embedded use, PostgreSQL allows decoupled database management, reliable backups, multi-instance concurrency, and easier integration with external reporting or web dashboards.

## Decision
We replace `bun:sqlite` with PostgreSQL as the primary database. Timestamps will be stored using timezone-aware UTC (`TIMESTAMPTZ`), with application logic handling local display (WIB / `Asia/Jakarta`).
