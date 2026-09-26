# 2. Store Operational Settings in Database

Operational configurations (such as user timezone, reminder lead times, and allowed user whitelists) are stored in PostgreSQL tables rather than hardcoded in `.env` variables.

## Context
Deploying the bot via Docker or VPS means updating `.env` requires restarting or redeploying the service. User preferences (e.g., timezone per user, custom reminder lead times) or changing access permissions should be manageable on the fly via DB GUI (pgAdmin/TablePlus) or chat commands without downtime.

## Decision
Keep only foundational credentials (`DATABASE_URL`, `GEMINI_API_KEY`) in `.env`. Store dynamic operational configurations in a `user_settings` / `system_settings` table in PostgreSQL. Application logic will read settings from the DB with fallback defaults.
