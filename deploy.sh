#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF to your project reference}"
command -v supabase >/dev/null || { echo 'Install the Supabase CLI first'; exit 1; }
git rev-parse --show-toplevel >/dev/null
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push
supabase functions deploy add-teacher --project-ref "$SUPABASE_PROJECT_REF"
git add app.js data.js index.html style.css assets config.js supabase deploy.sh README.md
git diff --cached --quiet || git commit -m "Fix lead lifecycle, trial bookings and teacher creation"
git push
