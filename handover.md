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

Gemini calls use `lib/ai/gemini.ts`. It retries HTTP 429 and 503 with delays of 5s, 15s, and 30s.

Those delays used to be 2s/5s/10s, and 17s of total waiting was not enough. A real 45-minute upload on
2026-08-15 exhausted all four attempts in 64s and was recorded as failed. Reproducing it with the same
file and the same code showed why: the model returns `503 UNAVAILABLE — "This model is currently
experiencing high demand"`, twice in a row, then succeeds on the third attempt. Nothing was wrong with
the file, the key, or the quota.

The error handling was also hiding the cause. It threw one message for both 429 and 503 and discarded
the API's explanation, so a quota problem and a temporary overload looked identical. Now each failed
attempt logs `[gemini] <role> <model> HTTP <status> attempt n/4: <reason>`, and the thrown message
distinguishes "AI 사용량 한도에 걸렸습니다 (429)" from "AI 서버가 혼잡합니다 (503)".

The ladder is now exponential and bounded by two knobs rather than a fixed list of three delays.
`maxRetryWaitMs` caps the total time spent waiting (default 50s; transcription passes 240s) and
`budgetMs` still truncates it when the caller has less time. Measured against an always-503 endpoint:
the default runs 4 attempts over 35s, transcription's allowance runs 7 attempts over 195s, and a 45s
budget correctly falls back to 4 attempts. A rejected attempt consumes no tokens, so waiting is cheap.

**Model fallback.** Overload is per model, not per key. Measured within the same minute on one
58-minute recording: `gemini-3.6-flash` and `gemini-3.7-flash` both returned 503 while
`gemini-3.5-flash` accepted the identical request. When the primary model stays overloaded for its
share of the retry allowance (`PRIMARY_RETRY_SHARE`, 35%), the call switches to the tier's fallback
from `FALLBACK_MODELS` in `lib/ai/models.ts` and spends the remaining allowance there. Waiting longer
on one model is worse than switching, because these spikes last minutes rather than seconds.

Note: the fallback path is typechecked and its trigger conditions are measured, but it has not yet
been observed firing during a real end-to-end upload — the successful run recovered on the primary
after one 503. Treat it as untested-in-anger insurance.

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

### Time Budgets

Each long route used to declare a `maxDuration` smaller than its own worst case, so a slow site or a
retrying Gemini call could be killed by the platform mid-flight. Crawling, OpenDART, and the Gemini
calls now draw from one budget per route that ends before the platform limit.

- `generateWithGemini` accepts `budgetMs` covering all attempts and retry waits, alongside the
  per-attempt `timeoutMs`. Retries still run when the budget allows (measured: no budget and a 180s
  budget both make all 4 attempts; 20s makes 3; 10s makes 2; 1s fails immediately without calling out).
- `uploadGeminiFile` takes a budget so the ACTIVE-state polling loop cannot run for its full 120s.
- `research` route: `maxDuration` 60 → 300, with 70s for crawling, 35s for OpenDART/recruiting, and the
  remainder split across the three Gemini calls. The questionnaire review is skipped when time runs
  short, which only means the draft questions survive untrimmed; the response reports
  `ai.questionnaireReview.skippedForTime` and `ai.elapsedMs`.
- `discover` route: `maxDuration` 60 → 300, since a 50MB PDF goes to Gemini inline.
- `consultations` route: budgets added under the existing 300s. This one matters most — a platform kill
  skips the catch block that marks the row failed, so the record would sit on "처리 중" forever. It now
  fails in-process and writes `status = failed`.
- OpenDART's year x consolidation search has its own 25s deadline; it was otherwise eight sequential
  retrying calls.

Measured after the change: a real research run against douzone.com finished in 39 seconds (10 pages
crawled), and a bad hostname still fails in under a second.

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
- Supported extensions: `.mp3`, `.m4a`, `.wav`, `.aac`, `.ogg`, `.oga`, `.flac`, `.mp4`.
- The limit shown to the operator is **time, not size**: 60 minutes per upload. Size is handled by the
  browser conversion below, so operators no longer have to think about megabytes.
- Server downloads from Supabase, uploads temporary file to Gemini Files API, requests transcript, then analysis summary.
- Saves transcript and summary to `company_consultations`.
- Displays full transcript and education-focused summary.
- Creates signed audio URL for playback/download display.
- Cleans temporary Gemini file after processing.

#### Combined briefing across consultations

A company is rarely understood in one call. Each recording still gets its own summary, and on top of
that `POST /api/companies/[id]/consultation-briefing` reads **every completed transcript** for the
company and produces one cross-session briefing, stored on `company_research.consultation_briefing`.

It is rebuilt automatically whenever the set of completed recordings changes — after an upload
finishes and after a delete — so it cannot quietly go stale. `sourceIds` records exactly which
consultations it covers, and `isBriefingStale()` compares that against what exists. Fewer than two
completed recordings returns nothing: a briefing only earns its cost from the second session onward.

The field that justifies the whole feature is `changes`. Reading two summaries side by side does not
tell you that something moved; this does. Verified on two deliberately conflicting sessions, it caught
all three shifts unprompted — headcount 20 to 15, schedule September to October, and priority from
quote automation to drawing review — and reordered `keyNeeds` to match the new priority. Oldest
sessions are trimmed first if the transcripts exceed the prompt budget, so the most recent picture
always survives.

**This needs a migration.** `supabase/migrations/20260815020000_add_consultation_briefing.sql` adds the
column. Until it is applied the briefing is still generated and returned, but not stored, and the
consultation list logs the missing column and carries on — verified, the screen keeps working.

#### Deleting a recording

`DELETE /api/companies/[id]/consultations/[consultationId]` removes the row and its audio object. The
delete is scoped by company as well as id, so a record id alone cannot reach another company's data
(verified: 401 unauthenticated, 404 with a mismatched company, 200 on the correct pair, with both row
and storage object gone). The trash control sits in the audio bar of the selected recording.

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

#### Recording size (solved by compressing in the browser)

A 30-60 minute consultation regularly exceeds the 50MB cap, and that cap cannot simply be raised:
**50MB is the Supabase project's global ceiling on the current plan.** Asking the API to raise the
bucket's own limit to 200MB is rejected with `413 EntityTooLarge`, so the bucket cannot exceed it.

The other half of the picture is that **Gemini downsamples every audio input to 16 Kbps and folds
multi-channel down to one channel** (`ai.google.dev/gemini-api/docs/audio`). A 128 kbps stereo
recording therefore costs storage, upload time, and nothing but waste — the model never sees the
extra data. Gemini itself is not a constraint: the Files API takes 2GB per file and 9.5 hours of
audio per prompt.

So `lib/audio/compress.ts` converts the recording to 16 kHz mono MP3 at 32 kbps before it is uploaded.
The browser's own decoder handles every format and does the resampling — `decodeAudioData` resamples
to the sample rate of the context it is called on — so no wasm codec bundle is needed. Only
`@breezystack/lamejs` (471KB) is added.

- Conversion runs when the file is lossless (wav/flac/aiff) or larger than 80% of the cap. Smaller
  compressed files upload untouched.
- Encoding runs in `lib/audio/mp3-encoder.worker.ts`, **not** a chunked loop on the page. Hidden tabs
  clamp `setTimeout` to over 1.5s per call here, so a cooperative loop stalled for minutes the moment
  the tab lost focus — the first implementation did exactly that and was rewritten.
- Duration is read from a media element before decoding and rejected past 3 hours. Peak memory tracks
  playing time, not file size (10 minutes of stereo decodes to 73MB of samples, so an hour is ~440MB).
- The source cap is 300MB (`MAX_CONSULTATION_SOURCE_SIZE`); the 50MB cap still applies to what is
  actually stored, enforced again on the server.
- `.mp4` always converts too. Handed to Gemini as video it bills 258 tokens per second instead of the
  32 it charges for audio, so a small screen recording would have cost eight times what it should.

#### Why the ceiling is 90 minutes, and how it was measured

Storage is not what binds. At 32 kbps the 50MB cap holds about 3.6 hours and Gemini accepts 9.5 hours
per prompt. What binds is the transcription route finishing inside `maxDuration`.

Two real uploads failed here before the numbers were measured rather than guessed:

1. The first failed after 64s with "현재 녹취 처리 요청이 많습니다". Cause: Gemini returned
   `503 UNAVAILABLE — high demand` on all four attempts, and the 2/5/10s backoff gave up after 17s.
2. The second failed after 186s with "The operation was aborted due to timeout". Cause: our own
   `TRANSCRIPTION_CALL_MS` of 150s aborted an attempt that needed far longer.

Measured directly on that 58-minute recording: **221s of transcription API time** (plus 50s of 503
backoff, so 271s wall clock), producing a complete transcript — 33,080 characters, 18,855 output
tokens, 291 timestamps running from 00:00 to 58:06, nothing truncated. That is about **3.8s of
processing per minute of audio**.

The project is on Vercel Pro, so `maxDuration` moved from 300s to **800s** (Hobby cannot go above 300s;
Pro reaches 800s, and 1800s in beta). With a 780s budget, 90 minutes of audio needs roughly 340s of
transcription and lands near 470s including upload, backoff, and analysis. The output-token cap
(65,536) is also far away — an hour used 18,855.

Beyond 90 minutes the next wall is browser memory during conversion, roughly 440MB per hour of audio,
which is why lifting the limit further means chunking rather than a bigger number (see TODO.md).

The upload screen no longer flips its label on a 12-second timer, which claimed "정리 중" while four
minutes of transcription were still running. It now shows one honest label plus an estimate derived
from the measured rate (58 minutes reads "약 5분 예상", against 4.5 minutes actual).

Duration is read from a media element on selection, before any upload or decoding — measured at 76ms
for a 56MB file — and applies to **every** file, not only the ones that get converted: a small but
very long recording would otherwise sail past the size checks and time out during transcription.

#### Format list, checked end to end

Every extension offered in the picker was traced through all four gates (picker → client validation →
Supabase `allowed_mime_types` → Gemini), and all eight pass. Two problems were found and fixed this way:

- **AIFF was offered but could never be uploaded.** `audio/aiff` is not in the bucket's allowed MIME
  list, and Chromium reports `canPlayType("audio/aiff") === "no"`, so conversion would have failed too.
  Removed from `MIME_BY_EXTENSION`.
- The upload screen listed six formats while the picker accepted ten. The visible list, the picker,
  and both "wrong format" error messages now come from one constant, `CONSULTATION_FORMAT_LABEL`.

Measured in-browser, tab hidden: a 100.9MB 10-minute stereo WAV became a 2.29MB MP3 in 7.3 seconds, a
44x reduction, and decoded back to exactly 600.1 seconds at 16 kHz mono. An hour of audio lands around
13.7MB, roughly a quarter of the cap.

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
