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
      { text: "Tap [[Who paid this?]]. The families most like the sender's name are at the top — tap theirs, check the summary, and tap [[Record]]. CoachOS remembers that name, so next time it's automatic." },
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
      { text: "Pick the school — or **+ A new school** and type its name. Then the program — or **+ A new program**, with its name and monthly fee (it starts at the amount paid)." },
      { text: "Read the summary: everything it will add, and whether this pays the month in full. Tap [[Record]].", tip: "Nothing is saved until that last tap, and it all saves together — if anything's missing, nothing is half-made." },
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
      { text: "It turns {paid} when fully paid, and a receipt is emailed if they have an email.", tip: "CoachOS won't take $0, a negative amount or more than they owe — that keeps your books right." },
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
      { text: "On their page they choose **Bank account** (free) or **Card** (the fee is shown first). After that it's automatic on the 1st.", tip: "They can turn it off or switch card ↔ bank on the same page." },
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
      { text: "Add each confirmed child to the roster with one tap. They get a welcome email with the first practice and their payment page." },
    ],
  },
  {
    id: "whatsapp-group",
    title: "Give a program its WhatsApp group",
    when: "So new families land in the right group chat",
    keywords: "whatsapp group chat invite link program session welcome email",
    href: "/schools",
    hrefLabel: "Open Schools",
    tourStep: "schools",
    steps: [
      { text: "In WhatsApp, open the program's group, tap its name, then **Invite via link** → **Copy link**." },
      { text: "In CoachOS, open the school, then **Edit** on the program, and paste it into **WhatsApp group invite link**. Save." },
      { text: "From then on, families who get a place see a [[💬 Join the team group chat]] button when they sign up, and in their welcome email.", tip: "No link? Nobody is sent to WhatsApp — they get email and texts instead. The waitlist never gets the link." },
    ],
  },
  {
    id: "attendance",
    title: "Take attendance, or let a coach do it",
    when: "At each session",
    keywords: "attendance register coach link passcode session present absent",
    href: "/schedule",
    hrefLabel: "Open Schedule",
    tourStep: "schedule",
    steps: [
      { text: "On **Schedule**, tap the session." },
      { text: "Tap each child to mark them present, absent, late or excused, then tap [[Save Attendance]]." },
      { text: "For a coach instead: tap [[Coach link]], then [[Copy link and passcode]], and send it to them. It stops working after 12 hours." },
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
      { text: "On **Schedule**, tap the session, then [[Cancel Session]]." },
      { text: "Type a reason (“gym closed”) and confirm. No practice reminder goes out for it." },
      { text: "Let families know in the group — CoachOS doesn't announce cancellations by itself.", careful: true },
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
    id: "settings",
    title: "Change your details",
    when: "Zelle number, emails, fee, business name",
    keywords: "settings change zelle number email reply business name card fee",
    href: "/settings",
    hrefLabel: "Open Settings",
    tourStep: "settings",
    steps: [
      { text: "In **Settings**, Payments has your Zelle details, the card fee and where Zelle alerts go; Messaging has where email replies go; General has the business name." },
      { text: "Change what you need and tap [[Save]] — it takes effect everywhere at once. Each address has a Copy button.", tip: "Leave the Stripe card to Mutaaf — it switches between test and live payments.", careful: true },
    ],
  },
];

/** Things CoachOS does by itself, so she knows what not to do. */
export const AUTOMATIC: { when: string; what: string; detail: string }[] = [
  { when: "On the 1st", what: "Every family is invoiced for the month.", detail: "One invoice per child, for the session's monthly fee." },
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
  { term: "**Outbox**", meaning: "Messages ready to send from your phone. CoachOS writes them; you press send." },
  { term: "**Payment page**", meaning: "Each family's private page: what they owe, Zelle details, autopay. Only people with the link see it." },
  { term: "**Autopay**", meaning: "A family saves a bank account (free) or card (small fee) once and pays on the 1st by itself." },
  { term: "**Test mode**", meaning: "Practice mode: card and bank payments aren't real. Shown by an amber badge. Mutaaf switches it to live." },
];

/** Ways to try everything safely while Stripe is in test mode. */
export const PRACTICE: { id: string; title: string; why: string; steps: HelpStep[] }[] = [
  {
    id: "p-family",
    title: "Make a practice family",
    why: "Everything else uses it. Use your own phone and email so you see exactly what parents see.",
    steps: [
      { text: "Go to **Schools** → [[Import a roster]]. Make a new school called **PRACTICE – delete me** and a session called **Practice**, fee **$1**." },
      { text: "Paste this, with your own phone number: **Child Name, Parent Name, Phone** on the first line, then **Test Kid, Your Name, your-number**. Tap [[Read roster]], then Import." },
      { text: "On **Students**, open your practice parent and add your email so you get receipts.", tip: "When you're done practising, ask Mutaaf to remove the practice school. Every active child is invoiced on the 1st." , careful: true },
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
    title: "Practise autopay with a test card",
    why: "Stripe's test cards behave like real ones but no money moves.",
    steps: [
      { text: "On your practice payment page, tap **Card**." },
      { text: "Enter card **4242 4242 4242 4242**, any future date, any 3-digit code, any ZIP. Save." },
      { text: "You'll see **Autopay is on — Visa ••••4242**. The next daily run charges it (or ask Mutaaf to run it now), the invoice turns {paid} and a receipt arrives.", tip: "Other test cards: **4000 0000 0000 0341** saves but is declined when charged (to practise a failed payment). **5555 5555 5555 4444** is a second card for “Use a different card”." },
    ],
  },
  {
    id: "p-bank",
    title: "Practise autopay by bank",
    why: "Bank payments are free for families and take a few days.",
    steps: [
      { text: "On the payment page tap **Bank account**, then in Stripe's bank list choose **Test Institution** and finish." },
      { text: "After the daily run the invoice shows {processing}, then {paid} once the test bank payment lands." },
    ],
  },
  {
    id: "p-zelle",
    title: "Practise a Zelle payment",
    why: "Zelle is real money, so keep it to $1.",
    steps: [
      { text: "Have someone Zelle you **$1**, or record a pretend one: on **Payments**, tap **Record Payment** on your practice invoice and choose Zelle." },
      { text: "For the real $1: forward the bank's email to the Zelle Alerts Gmail and watch the practice invoice turn {paid} within 15 minutes." },
    ],
  },
  {
    id: "p-fail",
    title: "Practise a failed payment",
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
