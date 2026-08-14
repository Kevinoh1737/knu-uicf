# KNU UICF 교육사업팀 Handover

Last updated: 2026-08-14

This project is the internal web app for `KNU UICF 교육사업팀`, built to reduce the education team’s manual work when planning company AI/AX training programs. The user will continue development in Claude Code, so this file is intentionally practical and handoff-oriented.

## Project Location

- Local workspace: `/Users/kevinoh/Documents/ChatGPT/강원대 산학협력단`
- GitHub repo: `https://github.com/Kevinoh1737/knu-uicf.git`
- Vercel: already connected and deployed by the user earlier
- Supabase project: `KNU-UICF`, project id observed during prior work: `xdersqmbuvfcbijotzcq`
- Current local app URL during development: `http://localhost:3000/`

Do not commit, push, or deploy after every small change. The user explicitly wants to keep developing locally and batch commits/deployments later.

## Product Direction

The app is for education program operators who may not deeply understand AI or the target company’s industry. The app should explain companies in plain Korean, help the manager understand what the company does, then generate practical AI/AX education questions and later convert consultation recordings into usable education planning notes.

Important UX rules from the user:

- Use `Pretendard` everywhere.
- Official service name: `KNU UICF 교육사업팀`.
- Keep UI professional, premium, quiet, and work-focused.
- Remove unnecessary explanatory copy.
- Avoid visible phrases such as `Gemini가 분석`, `실제 웹수집`, or feature descriptions that do not help the user act.
- Prefer short phrases over full `~다`, `~합니다`, `~됩니다` style sentences.
- Prevent awkward Korean word breaks globally.
- Mock data and non-working features should not clutter active workflows.
- Logos extracted from company websites are currently paused because quality was inconsistent.
- Company cards should not show `주식회사` as meaningful text; ignore/remove it in display normalization.

## Current Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Supabase for DB and private Storage
- Gemini API for company research, document extraction, question design, STT, and consultation analysis
- `pdf-lib` for PDF export
- `xlsx`-style export is implemented through API routes/dependencies in this repo
- Main UI is currently concentrated in `app/page.tsx`

Useful commands:

```bash
npm install
npm run dev
npx tsc --noEmit
npm run build
git diff --check
```

## Environment

`.env.local` exists locally. Do not print or copy the actual values into logs or docs.

Expected environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GEMINI_MODEL_FAST=gemini-3.5-flash-lite
GEMINI_MODEL_BALANCED=gemini-3.6-flash
GEMINI_MODEL_DEEP=gemini-3.1-pro-preview
RESEND_API_KEY=
EMAIL_FROM=education@knu.ac.kr
CRON_SECRET=
OPENDART_API_KEY=
AUTH_SECRET=
TEAM_ACCESS_CODE=
```

`AUTH_SECRET` (32+ characters, random) signs the session cookie and `TEAM_ACCESS_CODE` is the shared
passcode the team types on `/login`. Without them every request fails closed and the app is unreachable.

Both are already registered on Vercel for Production and Preview (verified by pulling each environment
back and comparing). Production and Preview deliberately use a **different** `AUTH_SECRET` than local
development, so a leaked development secret cannot forge production sessions; `TEAM_ACCESS_CODE` is the
same everywhere. Rotating `AUTH_SECRET` simply signs everyone out — no data is affected.

Note when pulling: `vercel env pull` writes to `.env.local` by default and will overwrite it. Always
pass an explicit output path.

Resend was not fully configured earlier. The user said most other keys were added, including Supabase, Gemini, OpenDART, and cron secret. Verify only by running feature checks, not by exposing secrets.

## AI Model Roles

Defined in `lib/ai/models.ts`:

- `companyResearch`: balanced, company website/PDF/recruiting/DART research
- `documentExtraction`: fast, extracting structured data from uploaded documents
- `questionnaireDesign`: balanced, AI/AX needs questionnaire generation and review
- `consultationTranscription`: balanced, STT/transcript from consultation recordings
- `consultationAnalysis`: deep, consultation summary and education-planning analysis
- `courseDesign`: deep, later 4-hour course design
- `surveyDesign`: balanced, later satisfaction survey design
- `instructorMatching`: balanced, later instructor recommendation

Gemini calls use `lib/ai/gemini.ts`. It retries HTTP 429 and 503 with delays of 2s, 5s, and 10s, then returns a friendly Korean error if demand is high.

## Supabase

Key files:

- `lib/supabase/admin.ts`
- `lib/supabase/browser.ts`
- `supabase/migrations/20260814054649_persist_company_research.sql`
- `supabase/migrations/20260814054910_deny_direct_company_research_access.sql`
- `supabase/migrations/20260814062000_create_company_source_documents_bucket.sql`
- `supabase/migrations/20260814184212_create_company_consultations.sql`

Important tables/buckets:

- `company_research`: persisted company research, questions, intelligence, crawl metadata
- `company_consultations`: consultation audio processing records, transcript JSON, summary JSON
- `company-source-documents`: private bucket for temporary company PDF intake, max 50 MiB
- `consultation-audio`: private bucket for consultation recordings, max 50 MiB

The `company_consultations` migration was already applied remotely to Supabase during prior work. Security advisor reported no lints. Performance advisor only flagged the new index as unused, which is expected because the table was new.

## Implemented Main Workflows

### Team Access Gate

Relevant files:

- `proxy.ts` (Next.js 16 renamed Middleware to Proxy; the file must stay in the project root)
- `lib/auth/session.ts`
- `lib/auth/guard.ts`
- `app/login/page.tsx`, `app/login/login-form.tsx`
- `app/api/auth/login/route.ts`, `app/api/auth/logout/route.ts`

Every page and API route requires a shared team passcode. `proxy.ts` redirects unauthenticated page
requests to `/login?next=…` and answers `/api/*` with 401. Each route handler additionally calls
`requireTeamSession()`, so a request that somehow skips the proxy is still rejected.

- Session cookie `knu_session`: HttpOnly, SameSite=Lax, Secure in production, HMAC-SHA256 signed, 12 hours.
- Everything fails closed. A missing `AUTH_SECRET`, a tampered signature, or an expired claim all deny access.
- Login attempts are rate limited to 8 per 10 minutes per IP, and the passcode comparison is constant-time.
- Exempt from the gate: `/login`, the two auth routes, and `/api/ai/health` (it carries its own `CRON_SECRET` check).
- Sign out from the sidebar. The sidebar still shows a placeholder operator name; passcode login has no
  per-user identity, so that label is mock data waiting on the cleanup pass.

Verified locally: unauthenticated page 307 → `/login`, unauthenticated API 401, wrong passcode 401,
correct passcode 200 with cookie, session grants page and API access, logout clears it, forged cookie
rejected, `npm run build` registers the proxy.

### Company Intake

Relevant files:

- `app/page.tsx`
- `app/api/uploads/company-pdf/route.ts`
- `app/api/companies/discover/route.ts`
- `app/api/companies/research/route.ts`
- `app/api/companies/route.ts`
- `app/api/companies/[id]/route.ts`

Supported intake methods:

- Homepage URL: directly starts company research.
- Company name: searches Naver, filters blocked/non-official domains, profiles candidates, and only shows a selection step when more than one plausible company remains.
- Company PDF: uploads directly to Supabase signed URL, extracts company name, official website, and summary from the PDF, then starts research directly. No candidate step should appear for PDF intake.

Important current behavior:

- PDF max size: 50MB visible in UI.
- Uploaded PDF size is shown after selecting a file.
- Company name candidate cards should show short company summary and URL.
- If Naver search returns exactly one good candidate, skip candidate selection and start research.
- Search uses public pages only and blocks private/local IPs.

### Company Research

Relevant file: `app/api/companies/research/route.ts`

Current data sources:

- Company homepage and internal pages up to `PAGE_LIMIT = 12`
- Linked attachments discovery, not full attachment parsing yet
- OpenDART via `lib/company-intelligence/dart.ts`
- Public recruiting search via `lib/company-intelligence/recruiting.ts`
  - Saramin
  - Incruit
  - Detects internal IT/developer/data/infrastructure signals

Research output should help a non-specialist manager understand:

- What the company does in plain language
- Products/services
- Customers
- How work likely flows
- Industry terms explained simply
- AI/AX education opportunities
- Uncertainties to verify during consultation
- Similar companies inside our own system, not external competitors

Important product clarification:

- “Similar companies” means companies already stored in this system, not competitors from the public web.
- If there are too few companies or no meaningful matches, show nothing.
- DART/public financial info should be supporting evidence or additional info, not the top of the page.

### Needs Questionnaire

Relevant files:

- `lib/ai/ax-questionnaire.ts`
- `app/api/companies/research/route.ts`
- `app/api/companies/[id]/questions/route.ts`
- `app/page.tsx`

Current direction:

- Most companies are legacy/manufacturing-like industries.
- UICF free programs are AI-related, so questions should focus on AI/AX education design.
- Keep a basic reusable foundation question set now.
- Add only 0-3 tailored questions after company research.
- A second Gemini review pass asks whether each tailored question truly affects the 4-hour AI course topic, level, practice, instructor expertise, or prep materials.
- If not essential, remove it.

Must-have question themes:

- Company organization structure
- Which departments exist
- Which department is core
- Most repetitive internal work
- Training attendees: headcount, department, role, age range, gender mix, AI level
- Desired outcome and first work area to improve
- Practical data/examples that can be used in class
- Constraints: security, data, devices, location, schedule

UI behavior:

- Questions are editable.
- Questions can be added/deleted.
- Questions can be reordered by grab/drag.
- Drag should show a clear insertion line at the current mouse position.
- Question card text should be vertically centered; sequence numbers like `01` should align cleanly.
- Needs questionnaire can be downloaded as Excel.

### Exports

Relevant files:

- `app/api/exports/company-report/route.ts`
- `app/api/exports/questionnaire/route.ts`
- `app/page.tsx`

Implemented:

- Company research detail page can export PDF.
- Needs questionnaire can export Excel.

Recent UI note:

- On research tab, button text is `PDF 다운로드`.
- On questions tab, button text is `Excel 다운로드`.
- The export button is hidden on `상담 기록`.

### Consultation Recording Upload / STT / Summary

Relevant files:

- `app/api/uploads/consultation-audio/route.ts`
- `app/api/companies/[id]/consultations/route.ts`
- `lib/consultations.ts`
- `lib/ai/gemini-files.ts`
- `lib/ai/gemini.ts`
- `app/page.tsx`
- `supabase/migrations/20260814184212_create_company_consultations.sql`

Implemented:

- Company detail third tab: `상담 기록`.
- Upload consultation audio/video file.
- Direct signed upload to private Supabase bucket `consultation-audio`.
- Supported extensions: `.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.oga`, `.flac`, `.mp4`.
- Max file size: 50 MiB.
- Server downloads from Supabase, uploads temporary file to Gemini Files API, requests transcript, then analysis summary.
- Saves transcript and summary to `company_consultations`.
- Displays full transcript and education-focused summary.
- Creates signed audio URL for playback/download display.
- Cleans temporary Gemini file after processing.

Consultation summary fields:

- Overview
- Key needs
- Audience
- Constraints
- Decisions
- Instructor notes
- Follow-up questions

Test performed:

- Used official NASA podcast episode “AI at NASA” as a realistic 34m24s conversation audio file.
- File size: about 24 MiB.
- Bitrate: about 96 kbps.
- First attempt hit Gemini 503 high demand.
- Added 429/503 retry logic.
- Retest succeeded.
- Processing time in Supabase timestamps: 107 seconds.
- Transcript had speaker/timestamp segments and summary behaved correctly.
- Important limitation: English sample was translated/cleaned into Korean and somewhat condensed despite the “full transcript” prompt. Korean real consultations may be better, but for truly verbatim archive-quality transcription, consider 10-15 minute chunked transcription or a dedicated STT service later.
- Test DB record and audio object were deleted afterward to avoid polluting company data.

File size guidance from test:

- 30 min at 64 kbps: about 14 MB
- 1 hour at 64 kbps: about 29 MB
- 30 min at 96 kbps: about 22 MB
- 1 hour at 96 kbps: about 43 MB
- 30 min at 128 kbps: about 29 MB
- 1 hour at 128 kbps: about 58 MB
- 1 hour should fit under 50MB if encoded around 64-96 kbps voice audio.
- 1 hour at 128 kbps or higher may exceed the current 50MB cap.

Known consultation improvement:

- The frontend currently switches from upload/transcribe messaging to summary messaging after a fixed timer, not based on actual backend stage. This is acceptable for MVP but should eventually become a real job/status flow.
- Current processing is synchronous in a Vercel function with `maxDuration = 300`. A 34m file completed in 107s. A 1h file may still fit, but a background job/workflow would be more robust.

## UI Issues Recently Fixed or Requested

Already handled in local code:

- Removed extra “조사 범위” card from intake modal.
- Removed unnecessary `Gemini` wording in UI.
- Company name/PDF CTA unified to `기업 조사 시작`.
- PDF upload uses a clearer upload symbol.
- PDF max size shown as `최대 50MB`.
- Candidate selection skipped for one candidate.
- Candidate cards show summary and URL.
- Processing state has motion/visual feedback.
- Company card delete via trash icon.
- Trash should be bottom-right; status should be top-right.
- `주식회사` should be ignored in company display.
- Research detail copy simplified and sentence endings shortened.
- Cards should avoid empty logo boxes or awkward first-letter cards when not useful.

Watch carefully:

- Some UI is still in a large `app/page.tsx`; refactoring into components would help once behavior settles.
- The sidebar/topbar/card layout has gone through many small changes. Verify visually after every CSS edit.
- Korean text wrapping and word-breaking should be checked on desktop and mobile widths.

## Git State

At handoff time, the working tree has many uncommitted changes and untracked files. This is expected. Do not reset or revert unless the user explicitly asks.

Files known to be modified or newly added include:

- `app/page.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/api/companies/discover/route.ts`
- `app/api/companies/research/route.ts`
- `app/api/companies/[id]/route.ts`
- `app/api/companies/[id]/consultations/route.ts`
- `app/api/companies/[id]/questions/route.ts`
- `app/api/uploads/company-pdf/route.ts`
- `app/api/uploads/consultation-audio/route.ts`
- `app/api/exports/company-report/route.ts`
- `app/api/exports/questionnaire/route.ts`
- `lib/ai/gemini.ts`
- `lib/ai/gemini-files.ts`
- `lib/ai/models.ts`
- `lib/ai/ax-questionnaire.ts`
- `lib/consultations.ts`
- `lib/supabase/admin.ts`
- `lib/supabase/browser.ts`
- `lib/company-intelligence/dart.ts`
- `lib/company-intelligence/recruiting.ts`
- `supabase/migrations/*.sql`
- `public/fonts/*`
- `package.json`
- `package-lock.json`

There are also some suspicious duplicate/generated files such as `README 2.md`, `package 2.json`, `public/favicon 2.svg`, `examples/`, `worker/`, `drizzle/`, `build/`, `.openai/`, and `tsconfig.tsbuildinfo`. Do not delete them blindly. Review whether they are project leftovers, generated by earlier tooling, or intentionally needed before cleanup.

## Verification Already Done

After the consultation/STT implementation and retry patch, these checks passed:

```bash
npx tsc --noEmit
git diff --check
npm run build
```

The browser flow for consultation upload was tested with a 34m24s real conversation audio file and succeeded after retry handling.

## Recommended Next Steps

1. Stabilize consultation processing UX.
   - Replace timer-based processing labels with actual backend stages or a polling job state.
   - Consider background processing before testing many 1-hour files.

2. Decide audio strategy.
   - Keep current 50MB cap for MVP.
   - Recommend or implement client-side/browser-side voice compression to 64-96 kbps for 30-60 minute recordings.
   - If exact transcript quality matters, implement chunked STT.

3. Continue product flow after consultation.
   - Use transcript + summary + original needs questionnaire to design 4-hour AI/AX course modules.
   - Store course designs per company and session.
   - Connect course designs to instructor assignment.

4. Improve company research detail.
   - Make the top section answer: “이 회사는 무엇을 하는 회사인가?”
   - Show easy business explanation first.
   - Show AI/AX education opportunities next.
   - Show internal similar companies only if meaningful matches exist.
   - Put DART/financial/recruiting evidence lower as supporting info.

5. Clean repository before batch commit.
   - Inspect duplicate/generated files.
   - Run typecheck/build.
   - Then commit once with a clear message.

## Do Not Forget

- User wants to continue development without frequent commits/deploys.
- Never expose `.env.local` values.
- Keep UI text minimal.
- Do not bring back company logo extraction unless the user reopens that direction.
- For AI-generated questions, basic reusable questions are preferred now; tailored questions should be strict and only added when they genuinely affect education design.
