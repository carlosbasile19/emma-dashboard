# Emma Frontend Updates (Calendar · Outcomes+ · Lead page · DM threads · Console costs) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Deviation note (executed inline, same session):** this plan is being executed by the author in the same session with full context, so component JSX is specified at contract level (exact types, endpoints, file paths, layout/copy requirements) rather than verbatim code. All data contracts and function signatures below are exact.

**Goal:** Wire five new/changed Emma views (client dashboard + agency console) to the extended Olivia external API — Calendar tab (replacing Funnel), Outcomes daily-trend + best-times heatmap, full-page lead detail with editable notes, DM-thread conversations with a chat drawer, and per-client cost (+$300/mo maintenance) in the console.

**Architecture:** Additive UI on the existing patterns: Server Components fetch via `lib/olivia/service.ts` (session-scoped, Supabase-backed SWR cache + governor); new upstream endpoints are added to `lib/olivia/api.ts`; the only write (lead notes) goes through a server action → `oliviaFetch` `PUT`. No browser ever calls Olivia. New `locked: true` PII envelopes are modeled explicitly in types and rendered with the existing "PII hidden" affordances.

**Tech stack:** Next.js 15 App Router, React 19, Tailwind v4 (`@theme` tokens in `app/globals.css`), Recharts (Donut precedent), Supabase auth/cache.

## Global constraints (copied from the spec)

- Server-to-server ONLY; `x-api-key` from Emma's backend; never call Olivia from the browser.
- Scopes: `dashboard:read` (all), `dashboard:pii` (person data), `dashboard:notes` (notes save ONLY).
- Errors `{ error, code }`; 404 codes (`client_not_found`, `lead_not_found`, `conversation_not_found`, `agency_not_found`) = "doesn't exist" — never retry.
- All money is integer USD cents; format at render time only (`centsToMoney`).
- Calendar `date`/`time` are ALREADY client-tz local strings — never re-convert through the browser timezone.
- `best_times` `null` = NO DATA (render neutral, never 0%); row 0 = **Sunday**; fade cells by `min(1, calls/5)` from `best_times_calls`.
- `summary.calls`/`bookings` on the lead page are EXACT totals — never show sublist `.length`.
- Notes ≤ 20 000 chars; empty clears; response `{ notes, updated_at }` replaces local state; debounce (write bucket 120/min/key); 403 → "notes are read-only for this key".
- `unread` on DM threads is derived — NO mark-as-read UI.
- Console: use server `totals` — do NOT re-sum client-side; maintenance is flat monthly, $0 for paused/archived, not prorated.
- No new colors/fonts/component patterns — reuse tokens (`violet #6D4AFF`, ink, lavender, Space Grotesk/Mono) and primitives (`Card`, `Badge`, `Skeleton`, `EmptyState`, `ErrorState`, `FreshnessNote`).
- Missing references, flagged: the `Emma Dashboard.dc.html` / `Emma Console.dc.html` design files are not reachable this session (no active /design-login), and `docs/superpowers/specs/2026-06-19-emma-external-api-contract.md` is not in the repo — the prompt's endpoint spec is the contract source. Pixel-level reconciliation against the Claude designs is deferred; layout/copy follow the written spec.
- Documented deviation: new client-dashboard DTOs keep Olivia snake_case (repo convention in `lib/types.ts`); the console layer camelCases (repo convention in `lib/olivia/agency.ts`). The spec's "map to camelCase at the adapter" is satisfied where the repo already does it.

## New upstream endpoints (exact)

| # | Endpoint | Notes |
|---|---|---|
| 1 | `GET {ANALYTICS}/clients/{clientId}/calendar?month=YYYY-MM&upcoming_limit=N` | `events[]: { id, title, date, time, duration_min, lead_id, status }`, `upcoming[]` (any month), `locked?` |
| 2 | `GET {ANALYTICS}/clients/{clientId}/outcomes?from&to&tz` | now also `daily_trend[] { date, bookings, calls, picked_up }`, `best_times[7][24]` (0–1 or null), `best_times_calls[7][24]` |
| 3 | `GET {ANALYTICS}/clients/{clientId}/leads/{leadId}` | `{ lead, pipeline, summary, calls[≤50], bookings[≤50], conversations[] }` |
| 3b | `PUT {ANALYTICS}/clients/{clientId}/leads/{leadId}/notes` body `{ notes }` | → `{ notes, updated_at }`; scope `dashboard:notes` |
| 4 | `GET {ANALYTICS}/clients/{clientId}/dm-threads?page&limit[&lead_id=]` | thread stubs with `channel: ig\|fb\|wa\|tg\|tt`, `unread`, `locked` |
| 4b | `GET {ANALYTICS}/clients/{clientId}/conversations/{conversationId}?limit=` | `{ id, lead_id, channel, platform, agent, locked, messages[] }` oldest-first |
| 5 | `GET {ANALYTICS}/agencies/{agencyId}/clients?range=30d[&client_id=]` | per-client `spend_cents, maintenance_cents, total_cost_cents` + server `totals`; agencyId from new env `OLIVIA_AGENCY_ID` |

Calendar event statuses (color categories): `tentative` (maps to the old "scheduled" blue), `confirmed`, `completed`, `cancelled`, `no_show` (own color `#E8A33D` amber — matches booking no_show).

---

### Task 1: Adapter foundation (types + api + service + cache tiers + PUT)

**Files:**
- Modify: `lib/types.ts` — add `CalendarEvent`, `CalendarResponse`, `DailyTrendPoint`, `BestTimesGrid` (extend `Outcomes` with optional `daily_trend`, `best_times`, `best_times_calls`), `LeadDetail` (lead + pipeline + summary + calls + bookings + conversation stubs + `locked`), `DmThread`, `ThreadMessage`, `ConversationThread`, `CALENDAR_EVENT_STATUSES`, `DM_CHANNELS`.
- Modify: `lib/olivia/client.ts` — allow `method: "PUT"`.
- Modify: `lib/olivia/errors.ts` — add codes `lead_not_found`, `conversation_not_found`, `agency_not_found`.
- Modify: `lib/olivia/api.ts` — `getCalendar`, `getLeadDetail`, `putLeadNotes`, `getDmThreads`, `getConversationThread`, `getAgencyClientCosts`; extend `getOutcomes` typing.
- Modify: `lib/olivia/cache.ts` — TIERS: `calendar {60,300}`, `leadDetail {30,60}`, `dmThreads {30,60}`, `thread {15,60}`, `agencyCosts {120,600}`.
- Modify: `lib/olivia/service.ts` — `fetchCalendar`, `fetchLeadDetail`, `saveLeadNotes` (no cache; force-refresh lead detail after), `fetchDmThreads`, `fetchConversationThread`.
- Modify: `.env.example` — document `OLIVIA_AGENCY_ID`.

**Interfaces (exact, consumed by later tasks):**
```ts
// lib/types.ts
export const CALENDAR_EVENT_STATUSES = ["tentative","confirmed","completed","cancelled","no_show"] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];
export interface CalendarEvent { id: string; title: string | null; date: string; time: string; duration_min: number | null; lead_id: string | null; status: CalendarEventStatus; locked?: boolean; }
export interface CalendarResponse { client_id: string; month: string; events: CalendarEvent[]; upcoming: CalendarEvent[]; locked?: boolean; }
export interface DailyTrendPoint { date: string; bookings: number; calls: number; picked_up: number; }
export type BestTimesGrid = Array<Array<number | null>>; // [7][24], row 0 = Sunday
// Outcomes gains: daily_trend?: DailyTrendPoint[]; best_times?: BestTimesGrid; best_times_calls?: number[][];
export interface LeadSummary { total_spend_cents: number; currency: string; basis: string; calls: number; bookings: number; days_in_pipeline: number; }
export interface LeadBooking { id: string; scheduled_at: string; status: BookingStatus; service?: string | null; }
export interface ConversationStub { id: string; channel: string; platform?: string | null; last_message_at: string | null; }
export interface LeadDetailPipeline { pipeline_id: string; name: string; stage: string | null; stages: Array<Pick<PipelineStage,"id"|"name"|"color"|"stage_type"|"order_index">>; }
export interface LeadDetail { lead: Lead & { notes?: string | null; lead_context?: string | null; locked?: boolean }; pipeline: LeadDetailPipeline | null; summary: LeadSummary; calls: Call[]; bookings: LeadBooking[]; conversations: ConversationStub[]; }
export const DM_CHANNELS = ["ig","fb","wa","tg","tt"] as const;
export interface DmThread { id: string; lead_id: string; lead_name: string | null; channel: string; platform?: string | null; status: "active" | "ended"; bot_active?: boolean; last_message: string | null; last_message_at: string | null; unread: number; locked?: boolean; }
export interface ThreadMessage { from: "agent" | "lead"; text: string; timestamp: string; }
export interface ConversationThread { id: string; lead_id: string; channel: string; platform?: string | null; agent?: string | null; locked?: boolean; messages: ThreadMessage[]; }
```
```ts
// lib/olivia/service.ts (session-scoped)
fetchCalendar(params: { month: string; upcoming_limit?: number }, opts?): Promise<WithFreshness<CalendarResponse>>
fetchLeadDetail(leadId: string, opts?): Promise<WithFreshness<LeadDetail>>
saveLeadNotes(leadId: string, notes: string): Promise<{ notes: string; updated_at: string }>  // throws OliviaError; 403 => forbidden_scope
fetchDmThreads(params: PageParams & { lead_id?: string }, opts?): Promise<WithFreshness<ListResponse<DmThread>>>
fetchConversationThread(conversationId: string, limit?: number): Promise<WithFreshness<ConversationThread>>
```

**Steps:**
- [ ] Types in `lib/types.ts`; PUT in client.ts; new error codes
- [ ] `api.ts` endpoint fns (404 codes mapped, `flatText` on `last_message` not needed — strings per spec; guard anyway on thread `text`)
- [ ] cache tiers + service wrappers
- [ ] `npx tsc --noEmit` clean
- [ ] Commit `feat(olivia): adapter for calendar, lead detail, notes, dm-threads, agency costs`

### Task 2: Calendar tab (replaces Funnel)

**Files:**
- Modify: `lib/design.ts` — `NavKey` + `NAV_ITEMS`: `funnel` → hidden; add `{ key: "calendar", label: "Calendar", href: "/dashboard/calendar", group: "Analytics" }`; `SCREEN_TITLES.calendar = "Calendar"`; add `CALENDAR_EVENT_COLORS` (tentative `#2E86F2`, confirmed `#6D4AFF`, completed `#2BB673`, cancelled `#E5484D`, no_show `#E8A33D`).
- Modify: `components/dashboard/nav-icons.tsx` — `calendar` glyph (month grid square + binding rings, stroke style as siblings).
- Create: `lib/calendar.ts` — pure month-grid math (string-only, NO Date-tz): `monthLabel`, `addMonths(ym, n)`, `buildMonthGrid(ym): Array<{ ymd, inMonth }>` (42 cells, Mon-first), `todayYmdInTz(tz)`, `groupEventsByDay`, `fmtEventTime`.
- Create: `scripts/calendar-selftest.ts` + package script `test:calendar` (grid edges: Feb, Mon-start months, leap year; addMonths rollover).
- Create: `app/dashboard/calendar/page.tsx` (server: parse `?month=`, fetch, error → `ErrorState`), `loading.tsx` (Skeleton), `components/dashboard/calendar/CalendarView.tsx` (client: selected-day state, chips ≤2 + "+N more", today ring, dimmed leading/trailing days, right rail: selected-day list + Upcoming, header: All Clients no-op chip + active client chip, `‹ Month Year ›` nav via `?month=`, Today button, Month/Week/Day segmented control with Week/Day stubbed).
- Modify: `lib/copy.ts` — `calendar` empty/error copy; keep `funnel` entries (route still exists, hidden).
- Delete: nothing (funnel route stays, hidden — the repo's rollout pattern).

**Rules:** events render on `event.date` string match only; today = `todayYmdInTz(workspace.timezone)`; locked events show fallback label "Booking" + lock affordance; upcoming list independent of month.

- [ ] `lib/calendar.ts` + self-test green
- [ ] nav swap + icon + titles
- [ ] page + view + states
- [ ] Commit `feat(calendar): month calendar tab replacing funnel`

### Task 3: Outcomes — daily trend + best times

**Files:**
- Create: `components/charts/TrendLines.tsx` (client, Recharts `LineChart`: bookings/calls/picked_up, `CHART_PALETTE` colors, legend, `formatDayLabel` axis; **read `dataviz` skill before writing**).
- Create: `components/dashboard/outcomes/BestTimesHeatmap.tsx` (7×24 CSS grid, violet scale by likelihood, `opacity ∝ min(1, calls/5)`, null → neutral no-data cell, Mon→Sun row order (indices mapped from 0=Sunday), hour axis, `overflow-x-auto`).
- Modify: `app/dashboard/outcomes/page.tsx` — render both below donuts when fields present (graceful when backend omits).

- [ ] heatmap shading helper self-test (`scripts/best-times-selftest.ts`, `test:besttimes`): null vs 0, opacity clamp, day-index mapping
- [ ] components + page wiring
- [ ] Commit `feat(outcomes): daily trend chart and best-times heatmap`

### Task 4: Lead detail full page + notes

**Files:**
- Create: `app/dashboard/leads/[id]/page.tsx` (server; `fetchLeadDetail`; 404 → designed empty/error, back bar, no Edit/Open-conversation/Send/Delete actions), `loading.tsx`.
- Create: `components/dashboard/leads/LeadDetailView.tsx` — pipeline stage bar (from `pipeline.stages` or fixed `new→contacted→qualified→booked→converted→lost→dnc`; current highlighted, priors done; null stage → none highlighted), two columns: main (Lead details incl. PII-locked states, Conversation·DMs preview + "Open full thread" → `/dashboard/log?tab=conversations&thread={id}`, Calls list → existing `CallDrawer`, Bookings upcoming/past split on `scheduled_at` vs now, Notes card last) + right sticky dark ink Summary card (Total spend `centsToMoney`, Calls, Bookings from `summary` EXACT, Days in pipeline).
- Create: `components/dashboard/leads/NotesCard.tsx` (client; textarea + `Save note` + "Saved" confirmation; disabled/read-only notice on `forbidden_scope`).
- Create: `app/dashboard/leads/[id]/actions.ts` — `saveNotes(leadId, notes)` server action → `service.saveLeadNotes`; returns `{ ok, notes?, updatedAt?, error? }`.
- Modify: `components/dashboard/leads/LeadsTable.tsx` — row click navigates to `/dashboard/leads/{id}` (drop drawer usage).
- Delete: `components/dashboard/leads/LeadDrawer.tsx`.

- [ ] page + view + notes action (client keeps last-write-wins from response)
- [ ] leads table navigation swap; drawer removed
- [ ] Commit `feat(leads): full-page lead detail with pipeline bar, summary and notes`

### Task 5: Conversations tab = DM threads + chat drawer

**Files:**
- Modify: `app/dashboard/log/page.tsx` — conversations tab now fetches `fetchDmThreads({ page:1, limit:50 })`; keep calls fetch as-is; accept `?thread=` deep link.
- Modify: `components/dashboard/log/LogView.tsx` — conversations tab renders thread rows: channel badge (IG/FB/WA/TG/TT map + generic DM fallback), lead name (locked → placeholder), last-message preview, unread pink dot (existing pattern), `relTime`; row click + `?thread=` opens drawer.
- Create: `components/dashboard/log/ChatDrawer.tsx` (client portal drawer à la `CallDrawer`): channel header + agent label, bubbles (agent = `bg-gradient-brand` right, lead = white left) with timestamps, oldest-first, composer visual stub (disabled — **no send endpoint exists**; flagged), locked → thread shell + "PII locked" notice.
- Create: `app/dashboard/log/actions.ts` — `loadThread(conversationId)` server action → `service.fetchConversationThread`.

- [ ] page + list + drawer + action
- [ ] Commit `feat(log): DM thread list and chat drawer`

### Task 6: Console costs

**Files:**
- Modify: `lib/olivia/api.ts` (Task 1 added `getAgencyClientCosts(agencyId, { range, client_id? })`).
- Modify: `lib/olivia/agency.ts` — `getAgencyCosts(period)` (cached `agencyCosts` tier; `OLIVIA_AGENCY_ID` env; graceful `null` when unset/failed): returns `{ perClient: Map<clientId,{spendCents,maintenanceCents,totalCostCents}>, totals }` camelCased; merge into `getAgencyOverview` + `getClientDetail`.
- Modify: `components/console/ClientsTable.tsx` — add **Cost 30d** column: `centsToMoney(totalCostCents)` + subtitle `+$300 maint.` (from actual `maintenanceCents`); "—" when costs unavailable.
- Modify: `components/console/ClientDetailView.tsx` — Cost · 30d KPI (total) + Workspace details rows: Usage spend · 30d, Maintenance ($X / mo), highlighted Total · 30d; spend caveat tooltip (client-attributable usage only).
- Modify: `components/console/AgencyOverviewView.tsx` — aggregate **Cost · 30d** KPI from server `totals` (never re-summed).

- [ ] adapter + merge (+ `scripts/console-cost-selftest.ts` `test:costs` for the merge/format logic)
- [ ] three console views
- [ ] Commit `feat(console): per-client cost with monthly maintenance`

### Task 7: Verification (per superpowers:verification-before-completion + full-story verification)

- [ ] `npx tsc --noEmit` && `npm run build` green
- [ ] All self-tests green
- [ ] Live probe (server-side, curl with `.env` key): calendar / extended outcomes / lead detail / dm-threads / agency clients — record which are actually live; graceful states verified for any that 404
- [ ] Drive the app (`npm run dev` + authenticated session): five views render; locked-state check with the current key's scopes (full two-key matrix requires a second key — flag if unavailable)
- [ ] No `oa_live`/key in client bundle; no browser Olivia calls (grep `.next/static`)
- [ ] react-best-practices checklist over new TSX
- [ ] Final commit + report (PR-splitting guidance per screen)
