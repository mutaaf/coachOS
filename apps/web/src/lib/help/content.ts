/**
 * What Help says. Plain words for the owner, who is not technical.
 *
 * A small markup keeps it readable here and lets the page draw the app's own
 * controls inline: **bold**, [[Button]] for a button as it appears, and
 * {paid} (or pending, processing, overdue, waived) for a status badge.
 *
 * Each task names the page it happens on and, where the tour covers it, the
 * tour step that points at it, so "Show me" can walk her there.
 */

export interface HelpStep {
  text: string;
  tip?: string;
  /** A caution rather than a tip. */
  careful?: boolean;
}

export interface HelpTask {
  id: string;
  title: string;
  when: string;
  keywords: string;
  href: string;
  hrefLabel: string;
  tourStep?: string;
  steps: HelpStep[];
}

export const TASKS: HelpTask[] = [
  {
    id: "start",
    title: "Get started (first time)",
    when: "Once — about 10 minutes",
    keywords: "start begin first login tour sign in home screen",
    href: "/dashboard",
    hrefLabel: "Open the Dashboard",
    tourStep: "welcome",
    steps: [
      { text: "Add CoachOS to your phone's home screen so it opens like an app.", tip: "In Safari tap Share, then **Add to Home Screen**." },
      { text: "Take the tour: tap [[Show me]] above, or **Take the tour** in the menu any time." },
      { text: "On the Dashboard, **Getting started** lists what's left to set up. It ticks things off by itself as they really happen." },
    ],
  },
  {
    id: "programs",
    title: "Make a program and put it on at your schools",
    when: "Once per program, then each season",
    keywords: "program session season new offer school schools put on add create fee places ages practice weekly time coach duplicate next season open close sign-ups registration website",
    href: "/programs",
    hrefLabel: "Open Programs",
    tourStep: "programs",
    steps: [
      { text: "Go to **Programs** and tap [[New program]]. Pick one of your programs, or make a new one: its name, sport, ages, a description for parents, its usual monthly fee and places. Tap [[Next]].", tip: "You make each program once. Every school it runs at uses it." },
      { text: "Pick the **schools** — type to find one, or tap [[New school]] for its name and address. Pick the **season** (or make one like **Fall 2026**) and add the **weekly practices**: tap [[Another practice]] for a second day.", tip: "A school's usual practice time fills in by itself." },
      { text: "Under **Per school**, change the fee or places for one school, pick its coach, or give it different times. Leave a box empty to use the program's usual." },
      { text: "Last step: **Open for sign-ups now** and **Show on the website** are on. Pick a photo and check the card on the right (below on a phone), then tap [[Save — 2 schools]].", tip: "Everything saves together — if anything is wrong, nothing is half-made." },
      { text: "Next season, tap [[Duplicate Fall 2026 for next season]] on the program: same schools, fees, coaches and times. To add a school, tap [[Add to another school]]." },
      { text: "To open or close sign-ups on several sessions at once, tick them on Programs and tap [[Open sign-ups]] or [[Close sign-ups]]." },
    ],
  },
  {
    id: "import",
    title: "Add a session's families",
    when: "When a new session starts",
    keywords: "import roster families kids new session school screenshot csv add whatsapp group",
    href: "/schools",
    hrefLabel: "Open Schools",
    tourStep: "schools-import",
    steps: [
      { text: "Go to **Schools** and tap [[Import a roster]]." },
      { text: "Pick the school and session — or type new ones and the monthly fee — then tap [[Next]]." },
      { text: "Add a **screenshot** of the list: the WhatsApp group's member list, your spreadsheet or a sign-up sheet. A CSV or pasted text works too. Tap [[Read roster]].", tip: "Screenshots take about 30 seconds to read." },
      { text: "Check every child. Orange boxes are ones CoachOS wasn't sure about — check those carefully. A WhatsApp member list only has parents, so type each child's name.", tip: "Nothing is saved until you tap Import, and importing the same list twice never makes duplicates." },
      { text: "A child you **withdrew** from the session is marked, and left off so their family isn't invoiced again. Tick **Put them back on this session** only if they're really coming back." },
      { text: "Tap [[Import 12 children]]. Next, send their payment links." },
    ],
  },
  {
    id: "links",
    title: "Send families their payment links",
    when: "Once per family, after importing",
    keywords: "payment link send autopay invite families pay card bank",
    href: "/payments",
    hrefLabel: "Open Payments",
    tourStep: "payments-autopay",
    steps: [
      { text: "Go to **Payments**. In the **Autopay** box, tap [[Send 12 payment links]] and confirm." },
      { text: "You're taken to the **Outbox** with one message per family, each with their own link. Send them from there." },
      { text: "Families open their link to see what they owe, set up autopay or get the Zelle details. The page explains itself." },
    ],
  },
  {
    id: "outbox",
    title: "Send messages from the Outbox",
    when: "Once a day or so — your one daily habit",
    keywords: "outbox whatsapp text message send reminder daily",
    href: "/messaging?tab=outbox",
    hrefLabel: "Open the Outbox",
    tourStep: "outbox",
    steps: [
      { text: "Go to **Messaging** — the **Outbox** tab shows how many are waiting." },
      { text: "Tap the green [[WhatsApp]] button on the first card. WhatsApp opens with the message already written to that parent.", tip: "Use [[Text]] instead for a family who prefers a text message." },
      { text: "Press send in WhatsApp, then come back. The card has moved to **Sent or skipped today**. Tap the next one." },
      { text: "Opened one by mistake? Tap **Undo** next to it. Use [[Skip]] for anything you don't want to send." },
    ],
  },
  {
    id: "compose",
    title: "Message a whole school or session",
    when: "For news like a moved practice or a cancelled day",
    keywords: "compose message group school program session all parents announcement",
    href: "/messaging?tab=compose",
    hrefLabel: "Open Compose",
    tourStep: "messaging-tabs",
    steps: [
      { text: "Go to **Messaging** → **Compose**. Tap [[All Parents]], [[By School]] or [[By Session]]." },
      { text: "For a school or session, pick it from the list. The parents it will go to appear underneath — check the names.", tip: "Switching between All Parents, By School and By Session clears the list, so pick again after switching. Send stays grey until you do." },
      { text: "Write the message, or pick one from **Use a template...**. Tap [[Send to 12 recipient(s)]] and send them from the **Outbox**." },
    ],
  },
  {
    id: "zelle",
    title: "A parent paid by Zelle",
    when: "Whenever a Zelle alert arrives",
    keywords: "zelle paid payment yahoo forward gmail alert record",
    href: "/payments",
    hrefLabel: "Open Payments",
    tourStep: "payments-zelle",
    steps: [
      { text: "When your bank's “you received money” email arrives, **forward it unchanged** to the Gmail shown under Settings → Payments → Zelle Alerts Gmail. From your phone is fine." },
      { text: "That's it. Within 15 minutes it's matched to the family, marked {paid}, and they get a receipt.", tip: "No need to answer “I sent it via Zelle” messages — just check it shows paid." },
      { text: "If CoachOS isn't sure who sent it, it asks you on the Payments page — see “A Zelle payment needs you”." },
    ],
  },
  {
    id: "zelle-check",
    title: "A Zelle payment needs you",
    when: "When Payments shows “to check”",
    keywords: "zelle check inbox who sent this record not a family undo spouse repeat",
    href: "/payments",
    hrefLabel: "Open Payments",
    tourStep: "payments-zelle",
    steps: [
      { text: "On **Payments**, the **Zelle** box shows how many are waiting." },
      { text: "Read the orange note — it says why CoachOS asked: a name it doesn't know (often a spouse), an amount that doesn't match, or what looks like a repeat." },
      { text: "Tap [[Who paid this?]]. The families most like the sender's name are at the top — tap theirs, check the summary, and tap [[Record]]. CoachOS remembers that name, so next time it's automatic.", tip: "If the bank only gave a surname, it isn't remembered — it could be anyone in that family, so those payments always ask." },
      { text: "Not on the list? Tap [[Someone new]] — see “Money from someone who isn't set up yet”." },
      { text: "Not a family at all (a friend paying you back)? Tap [[Not a family]]." },
    ],
  },
  {
    id: "someone-new",
    title: "Money from someone who isn't set up yet",
    when: "A new family pays before you've added them",
    keywords: "new family unknown parent child school program add create zelle cash who paid someone new",
    href: "/payments",
    hrefLabel: "Open Payments",
    tourStep: "record-payment",
    steps: [
      { text: "For a Zelle, tap [[Who paid this?]] on it. For cash or Venmo, tap [[Record Payment]] at the top right of Payments and enter the amount." },
      { text: "Tap [[Someone new]]. The parent's name is filled in from the Zelle — check it, and add their phone (that's how WhatsApp reaches them).", tip: "If the phone is already on file, CoachOS says whose it is and offers that family instead, so you never make a family twice." },
      { text: "Enter the child's first name." },
      { text: "Pick the school — or **+ A new school** and type its name. Then the session — or **+ A new session**, with its name and monthly fee (it starts at the amount paid)." },
      { text: "Read the summary: everything it will add, and whether this pays the month in full. Tap [[Record]].", tip: "Nothing is saved until that last tap, and it all saves together — if anything's missing, nothing is half-made." },
    ],
  },
  {
    id: "paid-ahead",
    title: "A family paid ahead, or paid too much",
    when: "Money comes in that nothing is owed for yet",
    keywords: "credit ahead advance early extra overpaid overpayment too much paid up next month balance",
    href: "/payments",
    hrefLabel: "Open Payments",
    tourStep: "record-payment",
    steps: [
      { text: "Record it as usual: [[Who paid this?]] on a Zelle, or [[Record Payment]] at the top right of Payments for cash or Venmo. Tap the family." },
      { text: "The summary says how much goes on what they owe, and that the rest is **kept as credit**. Tap [[Record]]." },
      { text: "**Credit on file** on Payments lists every family with credit. Their payment page shows it too, and doesn't ask them to send anything while they owe nothing." },
      { text: "When next month's invoices are made, the credit pays them first, by itself. Nothing for you to do.", tip: "Total Revenue counts the money once, when it came in — not again when the credit is used." },
    ],
  },
  {
    id: "cash",
    title: "A parent paid cash (or another way)",
    when: "Whenever it happens",
    keywords: "cash venmo check record payment manual paid partial",
    href: "/payments",
    hrefLabel: "Open Payments",
    tourStep: "payments-invoices",
    steps: [
      { text: "On **Payments**, find the family's invoice and tap **Record Payment** on its row." },
      { text: "The amount still owed is filled in — change it if they paid part. Pick the method and tap [[Record Payment]]." },
      { text: "It turns {paid} when fully paid, and a receipt is emailed if they have an email.", tip: "CoachOS won't take $0, a negative amount or more than this invoice is for. If they paid extra, record it with Record Payment at the top right instead — the rest is kept as their credit." },
      { text: "Typed it wrong? Open **Payment History** and tap the pencil on that payment. The same rule applies: more than $0, and no more than the invoice is for once its other payments are counted." },
    ],
  },
  {
    id: "card",
    title: "A parent wants to pay by card or set up autopay",
    when: "When someone asks",
    keywords: "card credit autopay invoice stripe bank automatic link",
    href: "/payments",
    hrefLabel: "Open Payments",
    tourStep: "payments-invoices",
    steps: [
      { text: "On **Payments**, find the family's row and tap the 🔗 link icon — their payment page link is copied." },
      { text: "Paste it into a WhatsApp message to them." },
      { text: "On their page they choose **Bank account** (free) or **Card** (the fee is shown first). After that it's automatic on the day each invoice is due.", tip: "They can turn it off or switch card ↔ bank on the same page." },
    ],
  },
  {
    id: "failed",
    title: "An automatic payment failed",
    when: "If a card is declined",
    keywords: "failed declined card autopay fix error",
    href: "/messaging?tab=outbox",
    hrefLabel: "Open the Outbox",
    tourStep: "outbox",
    steps: [
      { text: "Nothing to do straight away — a message is already waiting in your **Outbox**, and an email has gone to the family if they have one." },
      { text: "Send that Outbox message on WhatsApp." },
      { text: "Their payment page shows what went wrong, with buttons to use another card, switch to bank, or pay by Zelle. CoachOS tries again within a day of them updating it." },
    ],
  },
  {
    id: "family-owes",
    title: "“What do we owe?” — one family",
    when: "When a parent asks on WhatsApp",
    keywords: "family owe owes balance how much garcia parent asks children siblings messages link left to pay",
    href: "/students",
    hrefLabel: "Open Students & Parents",
    tourStep: "families",
    steps: [
      { text: "Go to **Students & Parents** and open **Parents**. **Balance** shows what each family still owes, for all their children together. Type the name or phone in the search box to find them fast." },
      { text: "Tap the parent's name — or a child's name on **Students** — to open their family." },
      { text: "**They owe** is the answer, with each unpaid invoice and what's left on it underneath.", tip: "A bank payment still on its way isn't counted as owed; it's shown on its own line. Credit they have on file is shown too." },
      { text: "Tap [[Copy link]] and paste their payment page into your WhatsApp reply. The family page also shows both parents, each child's sessions, every invoice and the messages you've sent them." },
    ],
  },
  {
    id: "behind",
    title: "See who's behind on payments",
    when: "Any time",
    keywords: "overdue late behind owe owed unpaid chase dashboard see all",
    href: "/payments?status=overdue",
    hrefLabel: "Open overdue payments",
    tourStep: "dashboard-stats",
    steps: [
      { text: "On the Dashboard, **Overdue Payments** shows how many invoices are past due and how much they add up to." },
      { text: "**Recent Alerts** lists the five oldest. Tap **See all** to open Payments with every {overdue} invoice showing." },
      { text: "A reminder has already gone out once by itself. Record a payment from its row, or send them their payment link from the Outbox." },
    ],
  },
  {
    id: "join",
    title: "Let new families sign up",
    when: "To fill a session",
    keywords: "registration sign up join link waitlist new family share group",
    href: "/registrations",
    hrefLabel: "Open Registrations",
    tourStep: "registrations",
    steps: [
      { text: "On **Registrations**, copy the session's sign-up link." },
      { text: "Share it however you like — WhatsApp, Instagram, a flyer. Parents register themselves and get a celebration and a \"you're in\" email; when full, they join a waitlist automatically." },
      { text: "Add each confirmed child to the roster with one tap. They get a welcome email with the first practice and their payment page, and this month's bill is made — due a week later. It shows **Paid** once the money is recorded on Payments." },
      { text: "When a place opens, tap **Give a seat to next in line** on the session. The waitlist reads #1 first; giving a seat to anyone else asks before skipping the family ahead of them." },
      { text: "The ✕ cancels a registration after asking. For a child on the roster, leave “Also take them off the roster” ticked so they aren't billed again. Changed your mind? Tap **Restore**.", tip: "Restore gives back the seat if one is free; if the session has filled, the child goes to the back of the waitlist." },
    ],
  },
  {
    id: "whatsapp-group",
    title: "Give a session its WhatsApp group",
    when: "So new families land in the right group chat",
    keywords: "whatsapp group chat invite link program session welcome email",
    href: "/schools",
    hrefLabel: "Open Schools",
    tourStep: "schools",
    steps: [
      { text: "In WhatsApp, open the session's group, tap its name, then **Invite via link** → **Copy link**." },
      { text: "In CoachOS, open the school, then **Edit** on the session, and paste it into **WhatsApp group invite link**. Save." },
      { text: "From then on, families who get a place see a [[💬 Join the team group chat]] button when they sign up, and in their welcome email.", tip: "No link? Nobody is sent to WhatsApp — they get email and texts instead. The waitlist never gets the link." },
    ],
  },
  {
    id: "attendance",
    title: "Take attendance, or let a coach do it",
    when: "At each practice",
    keywords: "attendance register coach link passcode session present absent complete completed correct fix",
    href: "/schedule",
    hrefLabel: "Open Schedule",
    tourStep: "schedule",
    steps: [
      { text: "On **Schedule**, tap the practice." },
      { text: "Tap each child to mark them present, absent, late or excused, then tap [[Save & complete]]. That saves the register and marks the practice done in one go.", tip: "A practice can only be completed on the day or after it." },
      { text: "Got someone wrong? Tap the completed practice: the register is still there. Change the child and tap [[Save changes]]." },
      { text: "For a coach instead: tap [[Coach link]], then [[Copy link and passcode]], and send it to them. The message says which day's practice it is. It works until a few hours after the practice ends — the box tells you exactly when — so you can send it the night before.", tip: "Cancelling the practice turns the link off, so a coach can't take a register for a practice that isn't happening." },
    ],
  },
  {
    id: "cancel",
    title: "Cancel a practice",
    when: "Gym closed, weather, holiday",
    keywords: "cancel practice session closed weather",
    href: "/schedule",
    hrefLabel: "Open Schedule",
    tourStep: "schedule",
    steps: [
      { text: "On **Schedule**, tap the practice, then [[Cancel practice]]." },
      { text: "Type a reason (“gym closed”) and confirm. No practice reminder goes out for it." },
      { text: "Let families know in the group — CoachOS doesn't announce cancellations by itself.", careful: true },
    ],
  },
  {
    id: "weekly-time",
    title: "Change a weekly practice time or coach",
    when: "A practice moves to 9:15, or a new coach takes over",
    keywords: "change time day weekly template schedule coach covering substitute move practice duplicate",
    href: "/schedule",
    hrefLabel: "Open Schedule",
    tourStep: "schedule",
    steps: [
      { text: "On **Schedule**, tap [[Manage Templates]], then the pencil next to the weekly practice." },
      { text: "Change the day, time or coach. Leave **Also change the practices already on the calendar** ticked and tap [[Save Changes]].", tip: "Past and cancelled practices stay as they were. Adding practices again never makes a second one on the same day." },
      { text: "Just one practice covered by someone else? Tap that practice and pick them under **Coach**. That's who it counts towards on Coaches." },
    ],
  },
  {
    id: "waive",
    title: "Let a family off a fee",
    when: "Scholarship, sibling discount, goodwill",
    keywords: "waive fee free discount forgive edit amount",
    href: "/payments",
    hrefLabel: "Open Payments",
    tourStep: "payments-invoices",
    steps: [
      { text: "On **Payments**, find the invoice and tap **Waive**, then confirm." },
      { text: "It shows {waived}: nothing is owed and no reminder goes out.", tip: "To change a fee instead, tap the ✎ pencil on the invoice and edit the amount." },
    ],
  },
  {
    id: "session-ends",
    title: "A session is free, ends, or a school stops",
    when: "Scholarships, end of season, losing a school",
    keywords: "free scholarship zero end season finished completed cancelled stop billing archive school dates",
    href: "/schools",
    hrefLabel: "Open Schools",
    tourStep: "schools",
    steps: [
      { text: "Free session: open the school, tap ✎ on the session and set the monthly fee to **0**. It shows “Free – no invoices”." },
      { text: "Session over: set its status to **Completed** or **Cancelled**, or give it an end date. No month after it is invoiced.", tip: "A session's end date can't be before its start date." },
      { text: "School stopping: open it and tap [[Archive]]. Its families get no more invoices, and you can end the children's places there at the same time.", careful: true },
    ],
  },
  {
    id: "archive",
    title: "A child has left",
    when: "To tidy the Students list",
    keywords: "archive remove delete left quit withdraw tidy hide student child parent restore",
    href: "/students",
    hrefLabel: "Open Students",
    tourStep: "students",
    steps: [
      { text: "Withdraw them from their session first, so they're not invoiced on the 1st." },
      { text: "On **Students**, tap the archive box on their row. They leave the list, and every invoice and payment stays.", tip: "Tap **Show archived** to see them again, and the arrow on their row to bring them back." },
      { text: "Delete only works for someone with no payment history. For anyone else it offers to archive instead, so your books never lose a payment.", careful: true },
    ],
  },
  {
    id: "same-child",
    title: "“Is this the same child?”",
    when: "When you add someone already on file",
    keywords: "duplicate twice same child parent school copy again already on file merge medical note allergy",
    href: "/students",
    hrefLabel: "Open Students",
    tourStep: "students",
    steps: [
      { text: "Adding a child with the name of one already on file asks **Is this the same Mia?** and shows who her parents are." },
      { text: "Tap [[Yes, same child]] and what you typed — a medical note too — goes onto the child you already have, so the coach sees it.", tip: "Tap [[No, add a new child]] only for a different child who shares the name." },
      { text: "Add Parent asks the same when the phone number is already on file, however it was typed." },
      { text: "Phone numbers are saved as one number — (214) 555-0150, 214.555.0150 and +1 214 555 0150 are the same — so WhatsApp always opens the right chat. One that isn't a phone number, like “12”, is refused so you can fix it.", tip: "For a number outside the US, start it with + and the country code." },
      { text: "Add to roster, roster imports and Bulk Import find families already on file by themselves, and never add a school with the same name twice." },
      { text: "In **Bulk Students**, a parent name and phone on a row saves that parent and links them to the child. A phone already on file links the child to that parent instead of making a copy.", tip: "A parent name with no phone, or a new phone with no name, is held back with a note so you can finish the row." },
    ],
  },
  {
    id: "reset",
    title: "A family's link was shared too widely",
    when: "If someone forwards it around",
    keywords: "reset link shared forwarded security new link private",
    href: "/payments",
    hrefLabel: "Open Payments",
    tourStep: "payments-invoices",
    steps: [
      { text: "On **Payments**, find the family's row and tap the ↻ arrow next to their 🔗 icon. Confirm." },
      { text: "Their old link stops working at once. The new one is copied — send it to them." },
    ],
  },
  {
    id: "access",
    title: "Give someone a login, or take it away",
    when: "A new helper, or someone who's left",
    keywords: "access login invite account password forgot remove admin user sign in",
    href: "/settings",
    hrefLabel: "Open Settings",
    tourStep: "access",
    steps: [
      { text: "On **Settings**, open the **Access** tab." },
      { text: "Type their email and tap [[Invite]]. They get an email with a link to choose a password; the link works once, for 24 hours.", tip: "Email slow? Copy the link shown and send it by WhatsApp instead." },
      { text: "To take someone's access away, tap [[Remove]] next to them. It works at once, even if they're signed in.", tip: "You can't remove yourself, or the last person with access." },
      { text: "Forgot your password? On the sign-in page tap **Forgot your password?** and you'll get a link to choose a new one." },
    ],
  },
  {
    id: "website",
    title: "Put a program on the website, or change its photos",
    when: "A new season, one that's ended, or new photos",
    keywords: "website risingstars.training listing program upcoming current picture photo photos image slideshow hero alt description testimonial partnership",
    href: "/website",
    hrefLabel: "Open Website",
    tourStep: "website",
    steps: [
      { text: "New programs go on the website from **Programs** → [[New program]]. To change a listing, open **Website**: anything ended, or not linked to a CoachOS program, is under **Needs a look**." },
      { text: "Tap [[Add a listing]] and pick the CoachOS program. Title, dates, place and price fill in — add a description and ages, then [[Add to website]].", tip: "Linked listings show live open places on the site, and families who register land in CoachOS with a \"you're in\" email." },
      { text: "**Photos**: on the **Photos** tab, drop photos in (or tap [[Choose photos]]). For each one write what's in it, tap the most important part, and switch on **On the website**.", tip: "Location data is removed and phone-sized copies are made for you." },
      { text: "If children can be recognized, tick that box — the photo can't go on the website until you also confirm a signed photo release is on file for every one of them.", careful: true },
      { text: "Under **Where photos show**, tap [[Choose]] beside a place — the slideshow, About, a program's card — and pick a photo. Drag slideshow photos (or use the arrows) to change their order. It's live on the website within a minute; no deploy." },
      { text: "Testimonials and partnerships are on their own tabs, the same way." },
    ],
  },
  {
    id: "settings",
    title: "Change your details",
    when: "Zelle number, emails, fees, due day, business name",
    keywords: "settings change zelle number email reply sender business name card fee monthly fee due day",
    href: "/settings",
    hrefLabel: "Open Settings",
    tourStep: "settings",
    steps: [
      { text: "In **Settings**, Payments has the day invoices are due (1 to 28), the fee a new session starts with, your Zelle details, the card fee and where Zelle alerts go; Messaging has who emails come from and where replies go; General has the business name." },
      { text: "Change what you need and tap [[Save]] — it takes effect everywhere at once. Each address has a Copy button.", tip: "Leave the Stripe card to Mutaaf — it switches between test and live payments.", careful: true },
    ],
  },
  {
    id: "privacy-request",
    title: "A parent asks to see or delete their data",
    when: "Within 45 days of the request — the law's deadline",
    keywords: "privacy request delete data erase export see copy personal information law deadline 45 days appeal",
    href: "/compliance",
    hrefLabel: "Open Compliance",
    steps: [
      { text: "Requests from the website's privacy form appear on **Compliance → Privacy requests**, with the days left. Requests by phone or email count too — ask them to use the form, or note it yourself." },
      { text: "Check it's really them first: call the number on file. Tap [[Start checking it's them]] and say how you checked.", careful: true },
      { text: "To send their data, tap [[Download their data]] and email the file to them. To delete, withdraw the children from their sessions, then tap [[Erase family]] and type ERASE.", tip: "Amounts and dates of what they paid stay, for your tax records. Names, phone, email, birthdays, medical notes and messages go." },
      { text: "If you can't do it, tap [[Decline…]] and say why. If they appeal you have 60 days to decide.", careful: true },
    ],
  },
  {
    id: "incident",
    title: "A child gets hurt, or you're worried about a child",
    when: "The same day",
    keywords: "incident injury hurt accident concussion head knock report abuse neglect worried dfps hotline",
    href: "/compliance?tab=incidents",
    hrefLabel: "Open Incidents",
    steps: [
      { text: "If you suspect abuse or neglect, call the Texas Abuse Hotline **1-800-252-5400** (or 911 in an emergency) yourself, right away. The law doesn't let you pass it to someone else.", careful: true },
      { text: "On **Compliance → Incidents**, tap [[Report an incident]]: when, who, what happened, what was done, and when you told the parent." },
      { text: "A knock to the head: tick **Possible concussion**. The child can't be marked at practice until a doctor's written OK is in — tap [[Record doctor's clearance]] when it is." },
    ],
  },
  {
    id: "coach-checks",
    title: "Make sure a coach is cleared to work with children",
    when: "Before their first practice, then yearly",
    keywords: "coach background check sex offender registry training cpr first aid code of conduct cleared safeguarding",
    href: "/coaches",
    hrefLabel: "Open Coaches",
    steps: [
      { text: "On **Coaches**, tap the shield on a coach. Fill in the background check (it must include the sex-offender registry), abuse-prevention training, CPR / First Aid and the code of conduct." },
      { text: "A coach shows **Not cleared** until all four are in date. Their name says “not cleared” wherever you assign a coach.", careful: true },
      { text: "**Compliance → Coach checks** lists who needs renewing in the next 30 days." },
    ],
  },
  {
    id: "stop-texts",
    title: "A parent says STOP, or doesn't want photos posted",
    when: "As soon as they tell you",
    keywords: "stop texts unsubscribe opt out photos pictures social media consent newsletter promotional promotion quiet hours",
    href: "/students",
    hrefLabel: "Open Students & Parents",
    steps: [
      { text: "Open the family and find **Consents**. Tap [[They said STOP]] — nothing else will be texted to them (promotions included), and anything waiting in the Outbox is cleared." },
      { text: "Children marked **Don't post photos** must not appear in anything you publish. Tap [[Parent signed a photo release]] only when you have it in writing." },
      { text: "In **Compose**, tick **This is a promotion** for news, offers and new programs: only parents who agreed to **promotional** texts get it — agreeing to program texts isn't enough. Promotions can only be sent Monday–Saturday 9 a.m.–9 p.m. and Sunday noon–9 p.m." },
    ],
  },
];

/** Things CoachOS does by itself, so she knows what not to do. */
export const AUTOMATIC: { when: string; what: string; detail: string }[] = [
  { when: "On the 1st", what: "Every family is invoiced for the month.", detail: "One invoice per child, for the session's monthly fee, due on the Payment Due Day in Settings (the 1st unless you change it). Free sessions, finished or cancelled ones, months outside a session's dates and archived schools are skipped. A child who joins mid-month has a week to pay." },
  { when: "About 1 pm", what: "Autopay families are charged.", detail: "Once a day; siblings are one charge. Bank payments show {processing} for a few days." },
  { when: "Within 15 min", what: "Forwarded Zelle payments are recorded.", detail: "Matched to the family and marked paid. If CoachOS isn't sure, it asks you." },
  { when: "Each payment", what: "A receipt is emailed", detail: "to families who've given an email. Their replies come to your inbox." },
  { when: "3 days late", what: "One reminder is prepared.", detail: "It waits in your Outbox to send, and is emailed if they have an email. Once — never daily." },
  { when: "Card declined", what: "The family is told how to fix it.", detail: "A message waits in your Outbox, an email goes out, and their page shows what went wrong." },
];

export const GLOSSARY: { term: string; meaning: string }[] = [
  { term: "{pending}", meaning: "Invoiced, not due yet. Nothing to do." },
  { term: "{processing}", meaning: "A bank payment is on its way. Takes a few days; no reminder is sent." },
  { term: "{overdue}", meaning: "Past due and unpaid. One reminder goes out automatically." },
  { term: "{paid}", meaning: "Fully paid. A receipt was emailed if the family has an email." },
  { term: "{waived}", meaning: "You let this one go. Nothing is owed." },
  { term: "**Program**", meaning: "Something you offer, made once on Programs — like Lil Dribblers (K–1). It has a name, ages, a usual fee and usual places." },
  { term: "**Session**", meaning: "A program put on at one school for a season, with its own dates, fee, places and roster. Families sign up for a session." },
  { term: "**Practice**", meaning: "One date of a session, on Schedule. Take attendance on it, cancel it, or send its coach a link." },
  { term: "**Season**", meaning: "The term sessions run in, like Fall 2026. It groups everything running at the same time." },
  { term: "**Outbox**", meaning: "Messages ready to send from your phone. CoachOS writes them; you press send." },
  { term: "**Payment page**", meaning: "Each family's private page: what they owe, Zelle details, autopay. Only people with the link see it." },
  { term: "**Autopay**", meaning: "A family saves a bank account (free) or card (small fee) once and pays on the due day by itself." },
  { term: "**Test mode**", meaning: "Pretend payments: card and bank payments aren't real. Shown by an amber badge. Mutaaf switches it to live." },
];

/** Ways to try everything safely while Stripe is in test mode. */
export const PRACTICE: { id: string; title: string; why: string; steps: HelpStep[] }[] = [
  {
    id: "p-family",
    title: "Make a test family",
    why: "Everything else uses it. Use your own phone and email so you see exactly what parents see.",
    steps: [
      { text: "Go to **Schools** → [[Import a roster]]. Make a new school called **PRACTICE – delete me** and a session called **Test session**, fee **$1**." },
      { text: "Paste this, with your own phone number: **Child Name, Parent Name, Phone** on the first line, then **Test Kid, Your Name, your-number**. Tap [[Read roster]], then Import." },
      { text: "On **Students**, open your test parent and add your email so you get receipts.", tip: "When you're done trying things, ask Mutaaf to remove the practice school. Every active child is invoiced on the 1st." , careful: true },
    ],
  },
  {
    id: "p-outbox",
    title: "Send yourself a payment link",
    why: "See the message and the payment page exactly as a parent does.",
    steps: [
      { text: "On **Payments** → **Autopay**, tap [[Send payment links]] (only families without autopay get one)." },
      { text: "In the **Outbox**, tap [[WhatsApp]] on your practice card. It opens a chat with yourself — send it." },
      { text: "Open the link from WhatsApp. Check the amber **Test mode** banner is there: nothing real will be charged." },
    ],
  },
  {
    id: "p-card",
    title: "Try autopay with a test card",
    why: "Stripe's test cards behave like real ones but no money moves.",
    steps: [
      { text: "On your practice payment page, tap **Card**." },
      { text: "Enter card **4242 4242 4242 4242**, any future date, any 3-digit code, any ZIP. Save." },
      { text: "You'll see **Autopay is on — Visa ••••4242**. The next daily run charges it (or ask Mutaaf to run it now), the invoice turns {paid} and a receipt arrives.", tip: "Other test cards: **4000 0000 0000 0341** saves but is declined when charged (to practise a failed payment). **5555 5555 5555 4444** is a second card for “Use a different card”." },
    ],
  },
  {
    id: "p-bank",
    title: "Try autopay by bank",
    why: "Bank payments are free for families and take a few days.",
    steps: [
      { text: "On the payment page tap **Bank account**, then in Stripe's bank list choose **Test Institution** and finish." },
      { text: "After the daily run the invoice shows {processing}, then {paid} once the test bank payment lands." },
    ],
  },
  {
    id: "p-zelle",
    title: "Try a Zelle payment",
    why: "Zelle is real money, so keep it to $1.",
    steps: [
      { text: "Have someone Zelle you **$1**, or record a pretend one: on **Payments**, tap **Record Payment** on your practice invoice and choose Zelle." },
      { text: "For the real $1: forward the bank's email to the Zelle Alerts Gmail and watch the practice invoice turn {paid} within 15 minutes." },
    ],
  },
  {
    id: "p-fail",
    title: "Try a failed payment",
    why: "So you know what a family sees when a card is declined.",
    steps: [
      { text: "On the payment page, tap **Use a different card** and enter **4000 0000 0000 0341**." },
      { text: "After the next daily run: a message is in your **Outbox**, an email arrives, and the payment page shows a red “didn't go through” note." },
      { text: "Fix it by switching back to **4242 4242 4242 4242** — it's charged within a day." },
    ],
  },
  {
    id: "p-plan",
    title: "Go through the full test plan",
    why: "Every check, written for an auditor — every payment, message and record.",
    steps: [
      { text: "Open the **Test plan** tab here. Each test says what could go wrong, exactly what to do and what you should see." },
      { text: "Tap ✓ Pass, ✗ Fail, ⊘ Blocked or — N/A, tick each expected result you saw, and write notes. Everything you record is saved and Mutaaf can see the failures to fix them." },
    ],
  },
];

export const TEST_CARDS: { number: string; copy: string; what: string }[] = [
  { number: "4242 4242 4242 4242", copy: "4242424242424242", what: "Works — the payment succeeds" },
  { number: "4000 0000 0000 0341", copy: "4000000000000341", what: "Saves, then is declined when charged" },
  { number: "4000 0025 0000 3155", copy: "4000002500003155", what: "Asks for confirmation once, when saved" },
  { number: "5555 5555 5555 4444", copy: "5555555555554444", what: "A second card, for switching cards" },
  { number: "Test Institution", copy: "Test Institution", what: "The bank to pick for a test bank account" },
];
