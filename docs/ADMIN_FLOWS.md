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

### After (feat/admin-ux)

Same job, same counting rules, walked through in
`tests/e2e/new-program.spec.ts` on a 390px phone.

| # | Where | What | Taps | Fields |
|---|---|---|---|---|
| 1 | Website → Photos | Open Website, **Photos** tab, **Choose photos** + file picker, describe it, **Save** (it publishes on the first save once described) | 6 | 1 |
| 2 | Programs → **New program**, step 1 | Name, description, fee, an age chip, **Next** | 4 | 3 |
| 3 | Step 2 | **New school**, name + address, **Add school** — twice. Season: none exist yet, so "+ A new season" is preselected and named for the term (Fall 2026) — type its start and end. **Add a weekly practice** (Tue 3:30–4:30 to start; change the day: 2), **Next** | 8 | 6 |
| 4 | Step 3 | Sign-ups and Show on the website are already on. Tap the photo, **Save — 2 schools** | 2 | 0 |
| | | **Total** | **20** | **10** |

**3 screens across 2 pages** (the New program page — three steps of one
form — and Website → Photos with its photo dialog), down from 10 across 3.
The 10 fields now include alt text, which the old path never asked for.

| Benchmark | Before | After |
|---|---|---|
| 1 practice a week, no coach | 40 taps · 10 fields · 10 screens | **20 taps · 10 fields · 3 screens** |
| 2 practices a week + a coach at each school | 60 taps · 14 fields · 13 screens | **25 taps · 10 fields · 3 screens** (+1 "Another practice" — same time two days later; +2 per school for the coach dropdown) |
| Photo already in the library | — | **14 taps · 9 fields** |
| Half-made states possible | yes, at every step | **no** — one transaction (`ops.create_program_sessions`) |

What else got shorter:

| Job | Before | After |
|---|---|---|
| Put an existing program on at one more existing school (current season) | Put it on at a school → school dropdown → day dropdown → Add session → Website → Add a listing → program dropdown → age → picture → Add: ~14 taps | **Add to another school** → type 2–3 letters → tap the school → **Next** → **Save**: **4 taps, 1 field** (the program's weekly times and its cards' photo carry over) |
| Next season, same schools | the whole "Before" table again, per school | **Duplicate … for next season** → **Next** → **Save**: **3 taps** when the next season exists; +3 fields to name and date a new one. Schools, fees, places, coaches and times are copied |
| Close sign-ups on 10 sessions | each school page → edit the session → untick → Save: ~40 taps | tick 10 → **Close sign-ups**: **11 taps** |
| Change a picture on the website | edit every listing that uses it; the hero/about/section pictures needed a code deploy | Photos → **Choose** beside the place → tap the photo: **2 taps**, live within a minute |

Sensible defaults doing the work: the last season a session went into (if it's
still open), else the current one; a new season named for the term; the first
school's usual weekly time (its latest session's) becomes the schedule, and a
second school with a different usual time keeps its own; the program's usual
fee and places for every school; sign-ups open and the website card on; the
card's title and description from the program.
