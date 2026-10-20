---
name: Production database choice
description: The target provider for this app's production database and its connection status.
---

Use Supabase as the production database target for this app. The current development PostgreSQL database is separate, and development schema pushes must not be treated as production migrations.

**Why:** The user selected Supabase for the production database.

**How to apply:** Keep production data and schema operations separate from the development database. Configure the production connection through the supported secrets flow before deploying or migrating production data.
