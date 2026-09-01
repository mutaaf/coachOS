# Stripe Setup Guide for CoachOS

This guide walks you through setting up Stripe so parents can pay invoices online via payment links sent through WhatsApp.

---

## What You'll Get

Once set up, CoachOS will:
1. Automatically create Stripe invoices when you generate monthly invoices
2. Add a "Send Link" button next to each invoice so you can send parents a payment link via WhatsApp
3. Automatically mark invoices as "paid" when a parent pays through Stripe
4. Show "Stripe" as a payment method option alongside Cash, Zelle, and Venmo

---

## Step 1: Create a Stripe Account

1. Go to **https://stripe.com** and click **Start now**
2. Enter your email, full name, and create a password
3. Verify your email address
4. Complete the onboarding (business info, bank account for payouts)

> **Tip:** You can start in **Test Mode** (no real charges) to try everything first. When ready, switch to Live Mode.

---

## Step 2: Get Your Stripe Secret Key

1. Log in to **https://dashboard.stripe.com**
2. Make sure you see **"Test mode"** toggle in the top-right (orange means test mode is ON — good for testing)
3. Click the **Developers** tab in the left sidebar
4. Click **API keys**
5. You'll see two keys:
   - **Publishable key** — starts with `pk_test_` (you do NOT need this one)
   - **Secret key** — click **Reveal test key** — it starts with `sk_test_`
6. **Copy the Secret key** (the one starting with `sk_test_`)

> **Important:** Keep this key secret. Never share it or post it publicly.

---

## Step 3: Set Up the Webhook

The webhook tells CoachOS when a parent has paid. Without it, payments won't automatically update.

1. In the Stripe Dashboard, go to **Developers** > **Webhooks**
2. Click **Add endpoint**
3. In the **Endpoint URL** field, enter:
   ```
   https://YOUR-DOMAIN.vercel.app/api/webhooks/stripe
   ```
   Replace `YOUR-DOMAIN` with your actual Vercel domain (e.g., `coachos.vercel.app`).

4. Under **Select events to listen to**, click **+ Select events**
5. Search for and check these two events:
   - `invoice.paid`
   - `invoice.payment_failed`
6. Click **Add endpoint**
7. On the endpoint detail page, click **Reveal** under **Signing secret**
8. **Copy the signing secret** — it starts with `whsec_`

---

## Step 4: Enter Keys in CoachOS

1. Open CoachOS in your browser
2. Go to **Settings** (gear icon in the sidebar)
3. Scroll down to the **Payments** section
4. Fill in these fields:
   - **Enable Stripe** → Toggle ON
   - **Stripe Secret Key** → Paste the key starting with `sk_test_` (from Step 2)
   - **Webhook Secret** → Paste the secret starting with `whsec_` (from Step 3)
5. Click **Save**

---

## Step 5: Test It

### Generate Test Invoices
1. Go to **Payments** in the sidebar
2. Click **Generate Invoices**
3. Pick a month and click Generate
4. You should see invoices appear in the table — each one will also be created in Stripe

### Send a Payment Link
1. Find an invoice in the table (status should be "Pending")
2. You'll see a blue link icon in the **Link** column — that's the Stripe payment page
3. Click **Send Link** next to the invoice
4. This sends a WhatsApp message to the parent with the payment link
5. The parent clicks the link, enters their card info, and pays

### Verify Payment Auto-Updates
1. If using **Test Mode**, go to the Stripe Dashboard > Invoices
2. Find the test invoice and click **Pay** (Stripe lets you simulate payments in test mode)
3. Go back to CoachOS Payments page — the invoice should now show **Paid** status

---

## Going Live (Real Payments)

When you're ready to accept real payments:

1. Complete Stripe account verification (Stripe will prompt you for business details and bank info)
2. In the Stripe Dashboard, toggle **Test mode OFF** (top-right)
3. Go to **Developers** > **API keys** and copy the **Live Secret key** (starts with `sk_live_`)
4. Create a new **Live webhook** endpoint:
   - Same URL: `https://YOUR-DOMAIN.vercel.app/api/webhooks/stripe`
   - Same events: `invoice.paid` and `invoice.payment_failed`
   - Copy the new live webhook signing secret
5. In CoachOS **Settings** > **Payments**, update:
   - **Stripe Secret Key** → paste the `sk_live_` key
   - **Webhook Secret** → paste the new `whsec_` secret
6. Click **Save**

> **Note:** Test keys only work with test mode, live keys only work with live mode. Make sure both the key and webhook match (both test or both live).

---

## How It Works Day-to-Day

### Monthly Workflow
1. At the start of each month, go to **Payments** > **Generate Invoices**
2. CoachOS creates invoices for all active students AND creates matching Stripe invoices
3. For each invoice, click **Send Link** to WhatsApp the parent the payment link
4. When parents pay, the invoice automatically updates to "Paid"
5. Money arrives in your Stripe account and gets deposited to your bank (usually 2 business days)

### Manual Payments
If a parent pays via Cash, Zelle, or Venmo instead of Stripe:
- Click **Record Payment** on the invoice and select the appropriate method
- The invoice will be marked as paid regardless of whether Stripe was involved

### Parent Preferences
When adding or editing a parent, you can set their **Preferred Payment** to "Stripe". This is just a label for your reference — all parents can use the Stripe payment link regardless of their preference setting.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Stripe is not enabled" error | Go to Settings > Payments and make sure the Stripe toggle is ON and both keys are filled in |
| Invoices don't show "Send Link" button | The Stripe invoice wasn't created. Check that Stripe was enabled BEFORE you generated invoices. Regenerate if needed. |
| Payment not auto-updating to "Paid" | Check that the webhook is set up correctly in Stripe Dashboard > Developers > Webhooks. Make sure the URL is correct and the signing secret matches. |
| Webhook shows errors in Stripe | Click the failed event in Stripe to see the error. Common issues: wrong URL, wrong signing secret, or server is down. |
| "No Stripe payment link available" | The invoice needs a Stripe invoice first. This happens automatically when generating invoices with Stripe enabled. For older invoices, you may need to regenerate. |

---

## Stripe Fees

Stripe charges **2.9% + $0.30** per successful card payment. For example:
- $120 invoice → Stripe fee: $3.78 → You receive: $116.22
- $150 invoice → Stripe fee: $4.65 → You receive: $145.35

Fees are automatically deducted. There are no monthly fees or setup fees.

---

## Need Help?

- **Stripe Support:** https://support.stripe.com
- **Stripe Test Card Numbers:** Use `4242 4242 4242 4242` with any future date and any CVC to simulate payments in test mode
