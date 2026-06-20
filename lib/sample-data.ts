// Placeholder data for Phase 2 — shaped exactly like the Olivia domain types so that
// Phase 6 can replace this module's exports with live proxy data without touching any
// component. Numbers mirror the imported design's sample workspace (Brightwater Dental).

import type {
  Agent,
  Call,
  Campaign,
  Conversation,
  Funnel,
  Lead,
  Outcomes,
  Overview,
  Period,
  Timeseries,
  Workspace,
} from "@/lib/types";

export const SAMPLE_PERIOD: Period = {
  from: "2026-05-22",
  to: "2026-06-20",
  tz: "America/New_York",
};

export const sampleWorkspace: Workspace = {
  clientId: "sample-brightwater",
  name: "Brightwater Dental",
  slug: "brightwater-dental",
  status: "active",
  industry: "dental",
  timezone: "America/New_York",
  user: "Jordan Pace",
  initials: "JP",
  role: "Practice Director",
};

export const sampleOverview: Overview = {
  client_id: sampleWorkspace.clientId,
  period: SAMPLE_PERIOD,
  kpis: {
    leads_total: 1284,
    calls_total: 3962,
    pickup_rate: 0.473,
    avg_call_duration_sec: 161,
    bookings_rate: 0.186,
    converted_count: 213,
    spend: { total_cents: 418000, currency: "usd", basis: "billed_voice" },
    leads_by_stage: {
      new: 318,
      contacted: 372,
      qualified: 168,
      booked: 96,
      converted: 213,
      lost: 84,
      dnc: 33,
    },
  },
};

// Previous equal-length period — used to compute KPI deltas (same approach as Phase 6).
export const sampleOverviewPrev: Overview = {
  client_id: sampleWorkspace.clientId,
  period: { from: "2026-04-22", to: "2026-05-21", tz: SAMPLE_PERIOD.tz },
  kpis: {
    leads_total: 1142,
    calls_total: 3665,
    pickup_rate: 0.458,
    avg_call_duration_sec: 170,
    bookings_rate: 0.171,
    converted_count: 194,
    spend: { total_cents: 394300, currency: "usd", basis: "billed_voice" },
    leads_by_stage: {
      new: 300,
      contacted: 352,
      qualified: 150,
      booked: 84,
      converted: 194,
      lost: 79,
      dnc: 31,
    },
  },
};

export const sampleFunnel: Funnel = {
  client_id: sampleWorkspace.clientId,
  period: SAMPLE_PERIOD,
  funnel: {
    new: 1284,
    contacted: 966,
    qualified: 534,
    booked: 330,
    converted: 213,
    lost: 84,
    dnc: 33,
  },
};

export const sampleOutcomes: Outcomes = {
  client_id: sampleWorkspace.clientId,
  period: SAMPLE_PERIOD,
  outcomes: {
    call_outcomes: { completed: 1873, no_answer: 1102, busy: 498, failed: 489 },
    call_dispositions: {
      interested: 642,
      booked: 330,
      callback_requested: 284,
      voicemail_left: 511,
      not_interested: 398,
      wrong_number: 96,
      dnc: 33,
      no_disposition: 178,
    },
    booking_outcomes: {
      scheduled: 124,
      confirmed: 88,
      completed: 71,
      cancelled: 29,
      no_show: 18,
    },
  },
};

// Deterministic 30-day series (mirrors the design's generator: gentle upward trend).
function genSeries(): Timeseries {
  const mk = (n: number, base: number, growth: number, amp: number, seed: number) => {
    let s = seed;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const trend = base * (1 + (growth * i) / n);
      const wave = Math.sin((i / n) * Math.PI * 5) * amp * 0.5;
      const wk = i % 7 >= 5 ? -amp * 0.6 : 0;
      out.push(Math.max(0, Math.round(trend + wave + wk + (rnd() - 0.5) * amp)));
    }
    return out;
  };
  const calls = mk(30, 118, 0.18, 26, 7);
  const pickups = mk(30, 54, 0.22, 16, 19);
  const bookings = mk(30, 9, 0.5, 4, 31);
  const spend = mk(30, 128, 0.16, 22, 53);
  const start = new Date(`${SAMPLE_PERIOD.from}T00:00:00Z`).getTime();
  const series = calls.map((c, i) => {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    return {
      date,
      calls: c,
      picked_up: pickups[i] ?? 0,
      bookings: bookings[i] ?? 0,
      spend_cents: (spend[i] ?? 0) * 100,
    };
  });
  return { client_id: sampleWorkspace.clientId, period: SAMPLE_PERIOD, series };
}
export const sampleTimeseries: Timeseries = genSeries();

export const sampleAgents: Agent[] = [
  { agent_id: "ag-recalls", name: "Emma · Recalls", total_leads: 412, total_calls: 1284, pickup_rate: 0.512, overall_booking_rate: 0.214, call_to_booking_rate: 0.21, avg_call_duration_sec: 178, total_conversion: 0.214 },
  { agent_id: "ag-react", name: "Emma · Reactivation", total_leads: 286, total_calls: 902, pickup_rate: 0.44, overall_booking_rate: 0.178, call_to_booking_rate: 0.175, avg_call_duration_sec: 192, total_conversion: 0.178 },
  { agent_id: "ag-new", name: "Emma · New Patient", total_leads: 208, total_calls: 541, pickup_rate: 0.586, overall_booking_rate: 0.241, call_to_booking_rate: 0.238, avg_call_duration_sec: 141, total_conversion: 0.241 },
  { agent_id: "ag-wait", name: "Emma · Waitlist", total_leads: 164, total_calls: 498, pickup_rate: 0.467, overall_booking_rate: 0.199, call_to_booking_rate: 0.195, avg_call_duration_sec: 164, total_conversion: 0.199 },
  { agent_id: "ag-reviews", name: "Emma · Reviews", total_leads: 121, total_calls: 402, pickup_rate: 0.391, overall_booking_rate: 0.084, call_to_booking_rate: 0.082, avg_call_duration_sec: 112, total_conversion: 0.084 },
  { agent_id: "ag-billing", name: "Emma · Billing", total_leads: 93, total_calls: 335, pickup_rate: 0.423, overall_booking_rate: 0.061, call_to_booking_rate: 0.06, avg_call_duration_sec: 129, total_conversion: 0.061 },
];

export const sampleCampaigns: Campaign[] = [
  { id: "cmp-1", name: "Q2 Recall Sweep", status: "active", created_at: "2026-04-01T00:00:00Z", leads_total: 512, leads_contacted: 431, replies: 188, opt_outs: 9, appointments_booked: 121, reply_rate: 0.436, opt_out_rate: 0.021 },
  { id: "cmp-2", name: "Lapsed Patient Reactivation", status: "active", created_at: "2026-04-12T00:00:00Z", leads_total: 348, leads_contacted: 281, replies: 97, opt_outs: 14, appointments_booked: 64, reply_rate: 0.345, opt_out_rate: 0.05 },
  { id: "cmp-3", name: "New Patient Welcome", status: "active", created_at: "2026-03-20T00:00:00Z", leads_total: 208, leads_contacted: 198, replies: 142, opt_outs: 3, appointments_booked: 58, reply_rate: 0.717, opt_out_rate: 0.015 },
  { id: "cmp-4", name: "Hygiene Reminder", status: "paused", created_at: "2026-02-18T00:00:00Z", leads_total: 164, leads_contacted: 121, replies: 38, opt_outs: 7, appointments_booked: 22, reply_rate: 0.314, opt_out_rate: 0.058 },
  { id: "cmp-5", name: "Annual Review Push", status: "completed", created_at: "2026-01-10T00:00:00Z", leads_total: 296, leads_contacted: 288, replies: 104, opt_outs: 11, appointments_booked: 71, reply_rate: 0.361, opt_out_rate: 0.038 },
  { id: "cmp-6", name: "Whitening Promo", status: "draft", created_at: "2026-06-15T00:00:00Z", leads_total: 0, leads_contacted: 0, replies: 0, opt_outs: 0, appointments_booked: 0, reply_rate: 0, opt_out_rate: 0 },
];

// ISO timestamps anchored around "today" = 2026-06-20.
export const sampleLeads: Lead[] = [
  { id: "L-4821", status: "converted", source: "cliniko_sync", total_calls: 3, created_at: "2026-06-09T22:00:00Z", updated_at: "2026-06-20T12:00:00Z", first_name: "Marcus", last_name: "Whitfield", phone: "+61 412 884 201", email: "m.whitfield@gmail.com", agent: "Emma · Recalls", activity: "Booked & attended", context: "Existing patient since 2019. 6-month recall overdue. Prefers early-morning slots; last seen for a scale & clean Aug 2025." },
  { id: "L-4820", status: "booked", source: "reactivation_campaign", total_calls: 2, created_at: "2026-06-08T10:00:00Z", updated_at: "2026-06-20T10:00:00Z", first_name: "Priya", last_name: "Nadkarni", phone: "+61 433 192 770", email: "priya.n@outlook.com", agent: "Emma · Reactivation", activity: "Appt 24 Jun, 10:30", context: "Lapsed since 2023, re-engaged via reactivation SMS. Asked about Invisalign — flag for an ortho consult." },
  { id: "L-4819", status: "qualified", source: "sms_unknown", total_calls: 1, created_at: "2026-06-18T09:00:00Z", updated_at: "2026-06-20T09:00:00Z", first_name: null, last_name: null, phone: null, email: null, agent: "Emma · Waitlist", activity: 'Replied "yes interested"', context: "Inbound SMS from an unknown number; replied “yes interested” to a recall prompt. Identity not yet matched to a record." },
  { id: "L-4818", status: "contacted", source: "csv_import", total_calls: 2, created_at: "2026-06-15T08:00:00Z", updated_at: "2026-06-20T08:00:00Z", first_name: "Dale", last_name: "Okafor", phone: "+61 401 556 028", email: "dale.ok@gmail.com", agent: "Emma · Recalls", activity: "Voicemail left", context: "Imported from the Q2 recall list. Two voicemails left, no callback yet. Best reached after 5pm." },
  { id: "L-4817", status: "new", source: "webhook", total_calls: 0, created_at: "2026-06-20T07:00:00Z", updated_at: "2026-06-20T07:00:00Z", first_name: "Sofia", last_name: "Marchetti", phone: "+61 422 770 119", email: "sofia.m@icloud.com", agent: "Emma · New Patient", activity: "Form submitted", context: "New-patient enquiry via the website form. Wants a check-up plus a whitening quote. No prior history on file." },
  { id: "L-4816", status: "converted", source: "hubspot_sync", total_calls: 4, created_at: "2026-06-05T05:00:00Z", updated_at: "2026-06-20T05:00:00Z", first_name: "Tom", last_name: "Beasley", phone: "+61 438 201 664", email: "tbeasley@gmail.com", agent: "Emma · Reactivation", activity: "Paid invoice", context: "Returning patient synced from HubSpot. Invoice paid for a crown fitting; due a follow-up in two weeks." },
  { id: "L-4815", status: "dnc", source: "sms_unknown", total_calls: 1, created_at: "2026-06-14T03:00:00Z", updated_at: "2026-06-20T03:00:00Z", first_name: null, last_name: null, phone: null, email: null, agent: "Emma · Recalls", activity: "Opted out", context: "Replied STOP to outreach. Added to Do-Not-Contact — suppress from all future campaigns." },
  { id: "L-4814", status: "qualified", source: "manual", total_calls: 2, created_at: "2026-06-12T02:00:00Z", updated_at: "2026-06-20T02:00:00Z", first_name: "Hana", last_name: "Suzuki", phone: "+61 410 998 232", email: "hana.s@gmail.com", agent: "Emma · New Patient", activity: "Callback requested", context: "Manually added after a front-desk enquiry. Wants a Thursday-evening callback; comparing two clinics." },
  { id: "L-4813", status: "lost", source: "crm_sync", total_calls: 3, created_at: "2026-06-10T00:00:00Z", updated_at: "2026-06-19T12:00:00Z", first_name: "Liam", last_name: "Doherty", phone: "+61 427 661 408", email: "liam.d@outlook.com", agent: "Emma · Waitlist", activity: "Not interested", context: "Moved interstate and now with another practice. Marked lost — keep on file in case they relocate." },
  { id: "L-4812", status: "booked", source: "direct_booking", total_calls: 1, created_at: "2026-06-11T00:00:00Z", updated_at: "2026-06-19T11:00:00Z", first_name: "Grace", last_name: "Mbeki", phone: "+61 419 003 551", email: "g.mbeki@gmail.com", agent: "Emma · New Patient", activity: "Appt 25 Jun, 14:00", context: "Booked online for a 25 Jun check-up. New to the practice — send the first-visit info pack." },
  { id: "L-4811", status: "new", source: "api", total_calls: 0, created_at: "2026-06-19T09:00:00Z", updated_at: "2026-06-19T09:00:00Z", first_name: null, last_name: null, phone: null, email: null, agent: "Emma · Recalls", activity: "Queued for outreach", context: "Pushed via the API integration, queued for first outreach. Source list: lapsed hygiene patients." },
  { id: "L-4810", status: "contacted", source: "reactivation_campaign", total_calls: 1, created_at: "2026-06-08T00:00:00Z", updated_at: "2026-06-18T12:00:00Z", first_name: "Ben", last_name: "Caruso", phone: "+61 402 778 190", email: "ben.caruso@gmail.com", agent: "Emma · Reactivation", activity: "Spoke 3:12", context: "Spoke for 3:12 — warm, wants to think it over. Strong reactivation candidate; follow up Friday." },
  { id: "L-4809", status: "converted", source: "cliniko_sync", total_calls: 2, created_at: "2026-06-06T00:00:00Z", updated_at: "2026-06-18T10:00:00Z", first_name: "Aisha", last_name: "Rahman", phone: "+61 433 887 210", email: "aisha.r@icloud.com", agent: "Emma · Recalls", activity: "Booked & attended", context: "Cliniko-synced recall. Booked and attended a clean. Happy to leave a review — send the link." },
  { id: "L-4808", status: "qualified", source: "manual", total_calls: 1, created_at: "2026-06-09T00:00:00Z", updated_at: "2026-06-18T08:00:00Z", first_name: "Noah", last_name: "Petersen", phone: "+61 418 220 945", email: "noah.p@gmail.com", agent: "Emma · Waitlist", activity: "Interested, comparing", context: "Comparing pricing with a competitor. Sent the first-visit info pack by email; sensitive to cost." },
  { id: "L-4807", status: "booked", source: "hubspot_sync", total_calls: 2, created_at: "2026-06-04T00:00:00Z", updated_at: "2026-06-17T09:15:00Z", first_name: "Elena", last_name: "Vasquez", phone: "+61 421 559 330", email: "elena.v@outlook.com", agent: "Emma · New Patient", activity: "Appt 26 Jun, 09:15", context: "Booked 26 Jun 09:15 via HubSpot sync. Existing patient, due for an annual review." },
];

export const sampleCalls: Call[] = [
  { id: "C-9912", lead_id: "L-4820", direction: "outbound", status: "completed", disposition: "booked", duration_seconds: 221, started_at: "2026-06-20T09:14:00Z", ended_at: "2026-06-20T09:17:41Z", created_at: "2026-06-20T09:14:00Z", lead: "Priya Nadkarni", agent: "Emma · Reactivation", transcript: "Confirmed lapsed since 2023. Booked hygiene appt for 24 Jun 10:30.", recording_url: "https://example.com/rec/C-9912.mp3", from_number: "+61 2 8000 1000", to_number: "+61 433 192 770", callback_notes: "Confirmed lapsed since 2023. Booked hygiene appt for 24 Jun 10:30. Sent SMS confirmation." },
  { id: "C-9911", lead_id: "L-4818", direction: "outbound", status: "no_answer", disposition: "voicemail_left", duration_seconds: 38, started_at: "2026-06-20T09:02:00Z", ended_at: "2026-06-20T09:02:38Z", created_at: "2026-06-20T09:02:00Z", lead: "Dale Okafor", agent: "Emma · Recalls", transcript: "No answer. Left voicemail with callback number and online booking link.", recording_url: "https://example.com/rec/C-9911.mp3", from_number: "+61 2 8000 1000", to_number: "+61 401 556 028", callback_notes: "No answer. Left voicemail with callback number and online booking link." },
  { id: "C-9910", lead_id: "L-4817", direction: "inbound", status: "completed", disposition: "interested", duration_seconds: 176, started_at: "2026-06-20T08:47:00Z", ended_at: "2026-06-20T08:49:56Z", created_at: "2026-06-20T08:47:00Z", lead: "Sofia Marchetti", agent: "Emma · New Patient", transcript: "New patient enquiry from website form. Discussed availability, qualified, callback scheduled.", recording_url: "https://example.com/rec/C-9910.mp3", from_number: "+61 422 770 119", to_number: "+61 2 8000 1000", callback_notes: "New patient enquiry from website form. Discussed availability, qualified, callback scheduled." },
  { id: "C-9909", lead_id: "L-4811", direction: "outbound", status: "busy", disposition: "no_disposition", duration_seconds: 6, started_at: "2026-06-20T08:31:00Z", ended_at: "2026-06-20T08:31:06Z", created_at: "2026-06-20T08:31:00Z", lead: "L-4811", agent: "Emma · Recalls", transcript: null, recording_url: null, callback_notes: "Line busy. Auto-retry queued for this afternoon." },
  { id: "C-9908", lead_id: "L-4813", direction: "outbound", status: "completed", disposition: "not_interested", duration_seconds: 82, started_at: "2026-06-20T08:12:00Z", ended_at: "2026-06-20T08:13:22Z", created_at: "2026-06-20T08:12:00Z", lead: "Liam Doherty", agent: "Emma · Waitlist", transcript: "Patient has moved practices. Marked lost, removed from waitlist.", recording_url: "https://example.com/rec/C-9908.mp3", from_number: "+61 2 8000 1000", to_number: "+61 427 661 408", callback_notes: "Patient has moved practices. Marked lost, removed from waitlist." },
  { id: "C-9907", lead_id: "L-4814", direction: "outbound", status: "completed", disposition: "callback_requested", duration_seconds: 108, started_at: "2026-06-19T17:40:00Z", ended_at: "2026-06-19T17:41:48Z", created_at: "2026-06-19T17:40:00Z", lead: "Hana Suzuki", agent: "Emma · New Patient", transcript: "Asked to be called back after 5pm Thursday. Callback task created.", recording_url: "https://example.com/rec/C-9907.mp3", from_number: "+61 2 8000 1000", to_number: "+61 410 998 232", callback_notes: "Asked to be called back after 5pm Thursday. Callback task created." },
  { id: "C-9906", lead_id: "L-4819", direction: "outbound", status: "failed", disposition: "no_disposition", duration_seconds: 0, started_at: "2026-06-19T17:22:00Z", ended_at: "2026-06-19T17:22:00Z", created_at: "2026-06-19T17:22:00Z", lead: "L-4819", agent: "Emma · Waitlist", transcript: null, recording_url: null, callback_notes: "Carrier rejected — invalid number format. Flagged for data cleanup." },
  { id: "C-9905", lead_id: "L-4812", direction: "inbound", status: "completed", disposition: "booked", duration_seconds: 250, started_at: "2026-06-19T16:05:00Z", ended_at: "2026-06-19T16:09:10Z", created_at: "2026-06-19T16:05:00Z", lead: "Grace Mbeki", agent: "Emma · New Patient", transcript: "Returning patient, booked check-up 25 Jun 14:00. Added to recall list.", recording_url: "https://example.com/rec/C-9905.mp3", from_number: "+61 419 003 551", to_number: "+61 2 8000 1000", callback_notes: "Returning patient, booked check-up 25 Jun 14:00. Added to recall list." },
  { id: "C-9904", lead_id: "L-4810", direction: "outbound", status: "no_answer", disposition: "no_disposition", duration_seconds: 42, started_at: "2026-06-19T15:31:00Z", ended_at: "2026-06-19T15:31:42Z", created_at: "2026-06-19T15:31:00Z", lead: "Ben Caruso", agent: "Emma · Reactivation", transcript: null, recording_url: null, callback_notes: "No answer, no voicemail box. Switched to SMS follow-up." },
  { id: "C-9903", lead_id: "L-4815", direction: "outbound", status: "completed", disposition: "dnc", duration_seconds: 31, started_at: "2026-06-19T14:58:00Z", ended_at: "2026-06-19T14:58:31Z", created_at: "2026-06-19T14:58:00Z", lead: "L-4815", agent: "Emma · Recalls", transcript: "Patient requested no further contact. Added to DNC list immediately.", recording_url: "https://example.com/rec/C-9903.mp3", from_number: "+61 2 8000 1000", to_number: "+61 400 000 000", callback_notes: "Patient requested no further contact. Added to DNC list immediately." },
  { id: "C-9902", lead_id: "L-4808", direction: "outbound", status: "completed", disposition: "interested", duration_seconds: 182, started_at: "2026-06-19T14:20:00Z", ended_at: "2026-06-19T14:23:02Z", created_at: "2026-06-19T14:20:00Z", lead: "Noah Petersen", agent: "Emma · Waitlist", transcript: "Comparing two clinics. Sent pricing + first-visit info pack by email.", recording_url: "https://example.com/rec/C-9902.mp3", from_number: "+61 2 8000 1000", to_number: "+61 418 220 945", callback_notes: "Comparing two clinics. Sent pricing + first-visit info pack by email." },
  { id: "C-9901", lead_id: "L-4807", direction: "outbound", status: "completed", disposition: "wrong_number", duration_seconds: 24, started_at: "2026-06-19T13:46:00Z", ended_at: "2026-06-19T13:46:24Z", created_at: "2026-06-19T13:46:00Z", lead: "Raj Pillai", agent: "Emma · Reactivation", transcript: "Reached unrelated party. Number marked invalid, lead set to lost.", recording_url: "https://example.com/rec/C-9901.mp3", from_number: "+61 2 8000 1000", to_number: "+61 410 662 884", callback_notes: "Reached unrelated party. Number marked invalid, lead set to lost." },
];

export const sampleConversations: Conversation[] = [
  { id: "M-7740", lead_id: "L-4820", channel: "sms", status: "completed", started_at: "2026-06-20T09:18:00Z", created_at: "2026-06-20T09:18:00Z", sentiment_score: 0.6, lead: "Priya Nadkarni", agent: "Emma · Reactivation", summary: "Perfect, see you the 24th 👍" },
  { id: "M-7739", lead_id: "L-4817", channel: "sms", status: "in_progress", started_at: "2026-06-20T08:52:00Z", created_at: "2026-06-20T08:52:00Z", sentiment_score: 0.4, lead: "Sofia Marchetti", agent: "Emma · New Patient", summary: "Do you have anything after 5pm?" },
  { id: "M-7738", lead_id: "L-4808", channel: "email", status: "completed", started_at: "2026-06-19T14:31:00Z", created_at: "2026-06-19T14:31:00Z", sentiment_score: 0.5, lead: "Noah Petersen", agent: "Emma · Waitlist", summary: "Thanks — info pack received." },
  { id: "M-7737", lead_id: "L-4814", channel: "chat", platform: "instagram", status: "in_progress", started_at: "2026-06-19T17:55:00Z", created_at: "2026-06-19T17:55:00Z", sentiment_score: 0.3, lead: "Hana Suzuki", agent: "Emma · New Patient", summary: "Can I move my callback to Friday?" },
  { id: "M-7736", lead_id: "L-4815", channel: "sms", status: "completed", started_at: "2026-06-19T14:58:00Z", created_at: "2026-06-19T14:58:00Z", opted_out_at: "2026-06-19T14:58:00Z", sentiment_score: -0.4, lead: "L-4815", agent: "Emma · Recalls", summary: "STOP" },
  { id: "M-7735", lead_id: "L-4812", channel: "sms", status: "completed", started_at: "2026-06-19T16:08:00Z", created_at: "2026-06-19T16:08:00Z", sentiment_score: 0.7, lead: "Grace Mbeki", agent: "Emma · New Patient", summary: "Confirmed for the 25th, thank you!" },
  { id: "M-7734", lead_id: "L-4816", channel: "email", status: "queued", started_at: "2026-06-19T11:02:00Z", created_at: "2026-06-19T11:02:00Z", sentiment_score: 0.5, lead: "Tom Beasley", agent: "Emma · Reactivation", summary: "Invoice receipt — scheduled to send" },
  { id: "M-7733", lead_id: "L-4807", channel: "chat", platform: "instagram", status: "completed", started_at: "2026-06-18T10:00:00Z", created_at: "2026-06-18T10:00:00Z", sentiment_score: 0.6, lead: "Elena Vasquez", agent: "Emma · New Patient", summary: "Got it, 9:15 works great." },
];
