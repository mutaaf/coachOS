# Admin flows — how many taps things take

The owner runs Rising Stars from her phone. This file counts what the common
jobs cost on screen, so a change that makes one slower is visible in review.

**Counting rules.** A *tap* is a button, chip, switch, checkbox or link press,
or one choice in a dropdown (open + choose = 2). A *field* is something typed
or picked from a date/time picker. Prefilled fields that are usually right are
not counted. A *screen* is a page or dialog that has to be opened.

## The benchmark job

> From nothing: a program running at **2 schools** (one weekly practice each),
> **visible on the website with a photo**, **open for registration**.

Both schools are new and should show their address on the website card
(`site_offerings.venue_address`).

### Before (feat/website-contract, 2026-10-05)

| # | Where | What | Taps | Fields |
|---|---|---|---|---|
| 1 | Schools | Open Schools, **Add School**, name + address, **Save** — twice (the inline "new school" in the session dialog has no address) | 5 | 4 |
| 2 | Programs | Open Programs, **New program**, name, description, fee, an age chip, **Make program** | 4 | 3 |
| 3 | Programs → "Put it on at a school" (school 1) | School dropdown, Season → "+ A new season", season name, start, end, Day dropdown, **Add session** | 8 | 3 |
| 4 | Programs → "Put it on at a school" (school 2) | School dropdown, Day dropdown, **Add session** (season and dates now default) | 6 | 0 |
| 5 | Website | Open Website; per session: **Add a listing**, CoachOS program dropdown, an age chip, **Upload a picture** + file picker, **Add to website** — twice | 17 | 0 |
| | | **Total** | **40** | **10** |

**10 screens/dialogs across 3 pages** (Schools + 2 dialogs, Programs + 3
dialogs, Website + 2 dialogs).

Not covered by that path, and each costs extra:

- **A second weekly practice** (e.g. Tue *and* Thu): the session dialog takes
  one. Each extra one is Schedule → Add weekly time → session, day, times,
  Save: **+7 taps, +2 fields per school**.
- **A coach** per school: Schedule/Coaches page, find the weekly slot, pick
  the coach: **+3 taps per school**.
- **A different fee or size at one school**: typed in that school's session
  dialog (no extra taps, but easy to miss).
- **The photo** is uploaded once *per listing* (the same file twice), with no
  alt text, no resizing (a 6 MB phone photo goes to parents as-is), into the
  old `ai-generated-images` bucket. Changing a picture means editing every
  listing that uses it. The site's other pictures (hero, about, sections) can
  only be changed with a code deploy of the website — which is why the AI
  cartoons are still up.
- **Half-made states**: each step saves on its own. A failure at step 4 or 5
  leaves a program on at one school, or on at both but not on the website.

With 2 practices a week and a coach at each school the benchmark is
**60 taps, 14 fields, 13 screens/dialogs across 5 pages**.

### After

Filled in below once the new flow is built and measured (see the end of this
file).
