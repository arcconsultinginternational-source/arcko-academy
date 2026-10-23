# Arcko Academy Studio

Plain HTML, CSS and JavaScript. No build step, no framework. The data lives in Supabase.

| File | What it is |
|---|---|
| `index.html`, `style.css`, `app.js` | The screens (from the prototype, now using real data) |
| `data.js` | Login, roles, loading and saving data, CSV export |
| `config.js` | Your two Supabase values (URL and anon key) |
| `supabase/schema.sql` | Database tables and the rules for who can see and change what |
| `supabase/bootstrap.sql` | Creates your first branch and the first accounts |
| `vercel.json` | Basic security headers for the host |

## Roles
| | Owner | Manager (also a franchisee) | Admin | Teacher |
|---|---|---|---|---|
| Branches | All (switch in sidebar) | Own | Own | Own |
| Students, leads, calendar, enrolments | All | Edit | Edit | Own classes only |
| Parent contacts | Yes | Yes | Yes | **No** |
| Attendance, progress notes | All | Edit | Edit | Own classes |
| Invoices, payroll, recurring invoices | Yes | Yes | **No** | **No** |
| CSV downloads (Export data) | All data | All data | Everything except finance | None |

The rules are enforced by the database, not by hiding buttons. Someone who edits the page in their browser still cannot read or change anything their role does not allow.

## 1. Supabase setup (about 15 minutes, in the dashboard)
1. **SQL Editor** → New query → paste all of `supabase/schema.sql` → Run. Run it only once, on an empty project.
2. **Authentication → Sign In / Providers** (or Settings) → turn **off** "Allow new users to sign up". Only you create accounts.
3. **Authentication → Users → Add user** → create four test accounts (owner, manager, admin, teacher). Tick **Auto Confirm User**.
4. Click each user and copy the **User UID**. Paste the four UIDs into `supabase/bootstrap.sql`, then run it in the SQL Editor.
5. **Project Settings → API** → copy the **Project URL** and the **anon public** key into `config.js`. Never use the `service_role` key anywhere in this project.

## 2. Try it on your computer
```bash
cd arcko-academy
python3 -m http.server 8000
# open http://localhost:8000 and sign in
```

## 3. Push to GitHub and deploy on Vercel
```bash
cd arcko-academy
git init
git add .
git commit -m "Arcko Academy Studio with Supabase backend"
git branch -M main

# Option A: GitHub CLI (https://cli.github.com)
gh auth login
gh repo create arcko-academy --private --source=. --push

# Option B: no CLI. Create an empty private repo on github.com, then:
# git remote add origin https://github.com/YOUR-USERNAME/arcko-academy.git
# git push -u origin main

npm install -g vercel
vercel login
vercel --prod
# Answer: Set up and deploy? Y · Link to existing project? N · Directory? ./ · Override settings? N
vercel git connect      # optional: every git push then redeploys automatically
```
Custom domain (optional): Vercel → Project → Settings → Domains → add it, then add the CNAME record Vercel shows you in Namecheap.

## 4. Check it before real data goes in
Sign in as each test account and confirm:
- **Teacher:** sees only the classroom view, only their own lessons and students, no phone numbers anywhere, can mark attendance and add a progress note.
- **Admin:** no Invoices, Payroll, Recurring invoices, Personnel or Settings in the menu; can add students, enrol, reschedule, mark attendance.
- **Manager:** sees invoices and can record a payment; sees only their own branch.
- **Owner:** can switch branches; every Export data button downloads a CSV.
- Create a second branch with its own manager and confirm that manager sees none of the first branch's data.

## Behaviour changes from the prototype
- Sample data, the Parent view, the role-preview dropdown, simulated payments and "Reset sample data" are gone. The dashboard chart now shows real numbers by programme.
- New students start with **0 sessions** (the prototype gave 8 free). Sessions are added by enrolling.
- Session balance is maintained by the database from attendance: marking Present uses one, changing it gives it back, and Present is refused when none remain.
- A new enrolment still creates one first lesson, as in the prototype.
- Teacher classroom: Make-up and Payroll tabs removed (teachers cannot see finance or other people's requests).
- Venue is now free text. Teacher is chosen from real teacher accounts.
- Owner sees one branch at a time (sidebar switch). CSV exports cover the branch currently shown.

## Known limits
- New team accounts are created by you in Supabase (steps in `bootstrap.sql`). A franchisee manager cannot yet invite their own staff in the app. That needs a small server function and is the next thing to build.
- Package prices on the Packages page and `PAY_RATE` (payroll) are fixed values in `app.js` / `data.js`.
- The app loads all of a branch's records into the browser. Fine for the first years of one branch; add a date window to lessons and attendance if a branch grows past several thousand lessons.
- Have a developer review `supabase/schema.sql` and test with two real branches before the first franchisee uses it.
- Check Supabase's current plan limits: free projects can be paused when inactive, which is not acceptable for a live academy.

## Fonts
`assets/Jua-Latin.ttf` is licensed under the SIL Open Font License (`assets/Jua-LICENSE.txt`).
