# Arcko Academy update
Copy this folder's contents into your existing website Git checkout, retaining its .git folder and hosting settings. No build is needed. Keep your existing config.js if it differs.

## One terminal deployment
Prerequisites: Supabase CLI installed and logged in (`supabase login`), existing Git remote and push access, hosting connected to that repository. Then run:

```bash
SUPABASE_PROJECT_REF=your_project_reference bash deploy.sh
```
This applies the trial column migration, deploys the owner-only teacher account endpoint, commits the site files and pushes the current branch. Your host must deploy that branch automatically; Git push alone does not configure hosting. If your remote is not set up, supply your repository URL first. Never place a service-role key in config.js. Supabase provides it to the server function.

## Changes
- Leads opens in Kanban; drag cards on desktop or use the status selector on mobile.
- Moving a client back to leads hides the linked archived student from client/student lists. Converting again restores the original student and history. Older duplicated records are matched only when archived name, parent, phone and the conversion note agree uniquely.
- Trial booked leads have an Add trial class action in list and board. Guests persist on the lesson, count toward eight seats, and have separate attendance without consuming paid sessions. Open a lesson to see/remove trial guests.
- Owners can add teachers with email and an initial password. No invitation email is sent. Share credentials privately.

Apply the database migration BEFORE uploading the new frontend. The uploaded archive contained no database schema or credentials for backend deployment, so server permissions and live account creation require verification in your Supabase project. Existing row policies govern lesson guest visibility and edits.

## Preview
Open preview.html locally. It uses fictional data and never connects to Supabase. Refresh resets demo changes. It previews the actual UI; account creation is disabled in the demo.
