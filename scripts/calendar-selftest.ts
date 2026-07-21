import assert from "node:assert/strict";
import {
  addMonths,
  buildMonthGrid,
  daysInMonth,
  eventTitle,
  groupEventsByDay,
  mondayIndex,
  monthLabel,
  todayYmdInTz,
} from "../lib/calendar";
import type { CalendarEvent } from "../lib/types";

function ev(p: Partial<CalendarEvent>): CalendarEvent {
  return { id: "e", title: "Consult", date: "2026-07-06", time: "10:00", status: "confirmed", ...p };
}

(() => {
  // daysInMonth — incl. leap handling
  assert.equal(daysInMonth("2026-07"), 31);
  assert.equal(daysInMonth("2026-02"), 28);
  assert.equal(daysInMonth("2028-02"), 29);
  assert.equal(daysInMonth("2026-04"), 30);

  // addMonths — rollover in both directions
  assert.equal(addMonths("2026-07", 1), "2026-08");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-07", -19), "2024-12");
  assert.equal(addMonths("2026-07", 0), "2026-07");

  // monthLabel
  assert.equal(monthLabel("2026-07"), "July 2026");
  assert.equal(monthLabel("2025-01"), "January 2025");

  // mondayIndex: 2026-07-06 is a Monday, 2026-07-05 a Sunday
  assert.equal(mondayIndex("2026-07-06"), 0);
  assert.equal(mondayIndex("2026-07-05"), 6);

  // buildMonthGrid — July 2026 starts Wednesday → 2 leading days, 42 cells total
  const july = buildMonthGrid("2026-07");
  assert.equal(july.length % 7, 0);
  assert.equal(july[0]!.ymd, "2026-06-29"); // Monday before Jul 1
  assert.equal(july[0]!.inMonth, false);
  assert.equal(july[2]!.ymd, "2026-07-01");
  assert.equal(july[2]!.inMonth, true);
  assert.equal(july.filter((c) => c.inMonth).length, 31);
  assert.equal(july[july.length - 1]!.inMonth, false);

  // A month that starts on Monday has no leading cells (June 2026)
  const june = buildMonthGrid("2026-06");
  assert.equal(june[0]!.ymd, "2026-06-01");
  assert.equal(june[0]!.inMonth, true);
  assert.equal(june.length, 35);

  // February of a non-leap year starting on Sunday (2026-02-01) → 6 leading days
  const feb = buildMonthGrid("2026-02");
  assert.equal(feb.filter((c) => !c.inMonth && c.ymd < "2026-02-01").length, 6);
  assert.equal(feb.filter((c) => c.inMonth).length, 28);

  // todayYmdInTz — a fixed instant lands on different calendar days per tz
  const instant = new Date("2026-07-05T23:30:00Z");
  assert.equal(todayYmdInTz("UTC", instant), "2026-07-05");
  assert.equal(todayYmdInTz("Australia/Sydney", instant), "2026-07-06");
  assert.equal(todayYmdInTz("America/New_York", instant), "2026-07-05");

  // groupEventsByDay — grouped by the literal date string, sorted by time
  const grouped = groupEventsByDay([
    ev({ id: "b", time: "14:00" }),
    ev({ id: "a", time: "09:30" }),
    ev({ id: "c", date: "2026-07-07", time: "08:00" }),
  ]);
  assert.deepEqual(grouped.get("2026-07-06")!.map((e) => e.id), ["a", "b"]);
  assert.equal(grouped.get("2026-07-07")!.length, 1);

  // eventTitle — locked events (no title) fall back to the service label
  assert.equal(eventTitle({ title: "Implant consult" }), "Implant consult");
  assert.equal(eventTitle({ title: null }), "Booking");
  assert.equal(eventTitle({ title: "  " }), "Booking");
  assert.equal(eventTitle({}), "Booking");

  // eventTitle — upstream sends "Name — Service - Name"; drop the duplicated trailing name
  assert.equal(
    eventTitle({ title: "Ralph Louie Santos — Guidance Call - Ralph Louie Santos" }),
    "Ralph Louie Santos — Guidance Call",
  );
  assert.equal(
    eventTitle({
      title:
        "Oshadhee Narmada Madhubhashani Menike Senanayake Senanayakelage — Guidance Call - Oshadhee Narmada Madhubhashani Menike Senanayake Senanayakelage",
    }),
    "Oshadhee Narmada Madhubhashani Menike Senanayake Senanayakelage — Guidance Call",
  );
  // en-dash before the duplicated name still counts as a separator
  assert.equal(
    eventTitle({ title: "Tania Mlangeni — Guidance Call – Tania Mlangeni" }),
    "Tania Mlangeni — Guidance Call",
  );
  // duplicate name match is case-insensitive; the leading form wins
  assert.equal(
    eventTitle({ title: "Wallis Stabler — Guidance Call - WALLIS STABLER" }),
    "Wallis Stabler — Guidance Call",
  );
  // degenerate "Name — Name" collapses to just the name
  assert.equal(eventTitle({ title: "Ralph Louie Santos — Ralph Louie Santos" }), "Ralph Louie Santos");
  // no duplication → untouched
  assert.equal(
    eventTitle({ title: "Guidance Call - Ralph Louie Santos" }),
    "Guidance Call - Ralph Louie Santos",
  );
  assert.equal(eventTitle({ title: "Follow-up — Whitening consult" }), "Follow-up — Whitening consult");
  // name reappears WITHOUT a separator → not the dupe pattern, leave alone
  assert.equal(
    eventTitle({ title: "Ralph Louie Santos — Call with Ralph Louie Santos" }),
    "Ralph Louie Santos — Call with Ralph Louie Santos",
  );

  console.log("calendar-selftest: all assertions passed");
})();
