export type School = {
  id: string;
  name: string;
  address: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  whatsapp_group_id: string | null;
  status: "active" | "inactive" | "archived";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Program = {
  id: string;
  school_id: string;
  name: string;
  season: string | null;
  start_date: string | null;
  end_date: string | null;
  monthly_fee: number;
  status: "active" | "upcoming" | "completed" | "cancelled";
  notes: string | null;
  capacity: number;
  registration_open: boolean;
  public_slug: string | null;
  public_description: string | null;
  whatsapp_group_url: string | null;
  location: string | null;
  created_at: string;
  updated_at: string;
};

export type Student = {
  id: string;
  first_name: string;
  last_name: string;
  grade: string | null;
  date_of_birth: string | null;
  medical_notes: string | null;
  notes: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};

export type Parent = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string;
  preferred_payment: "cash" | "zelle" | "venmo" | "stripe";
  venmo_handle: string | null;
  zelle_identifier: string | null;
  stripe_customer_id: string | null;
  /** Secret part of the parent's payment page URL, /pay/{pay_token}. */
  pay_token: string;
  autopay_status: "off" | "pending" | "active";
  autopay_method: "us_bank_account" | "card" | null;
  autopay_payment_method_id: string | null;
  autopay_label: string | null;
  autopay_verify_url: string | null;
  autopay_enabled_at: string | null;
  /** The Stripe mode the saved payment method belongs to; it can't be charged in the other. */
  autopay_mode: "test" | "live" | null;
  stripe_customer_mode: "test" | "live" | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type StudentParent = {
  student_id: string;
  parent_id: string;
  relationship: string;
};

export type Enrollment = {
  id: string;
  student_id: string;
  program_id: string;
  enrolled_at: string;
  status: "active" | "withdrawn" | "completed";
  notes: string | null;
  created_at: string;
};

export type ScheduleTemplate = {
  id: string;
  program_id: string;
  day_of_week: number; // 0=Sunday, 6=Saturday
  start_time: string;
  end_time: string;
  location: string | null;
  coach_id?: string | null;
  created_at: string;
};

export type Session = {
  id: string;
  schedule_template_id: string | null;
  program_id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: "scheduled" | "completed" | "cancelled";
  cancel_reason: string | null;
  is_makeup: boolean;
  notes: string | null;
  coach_id?: string | null;
  created_at: string;
};

export type Attendance = {
  id: string;
  session_id: string;
  student_id: string;
  status: "present" | "absent" | "late" | "excused";
  checked_in_at: string | null;
  notes: string | null;
};

export type Invoice = {
  id: string;
  parent_id: string;
  student_id: string;
  program_id: string;
  amount: number;
  month: string; // YYYY-MM
  due_date: string;
  /** 'processing' is a bank debit started and not yet settled. */
  status: "pending" | "processing" | "paid" | "overdue" | "waived";
  stripe_invoice_id: string | null;
  stripe_hosted_invoice_url: string | null;
  autopay_payment_intent_id: string | null;
  autopay_status: "processing" | "succeeded" | "failed" | null;
  autopay_error: string | null;
  autopay_attempted_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Payment = {
  id: string;
  invoice_id: string;
  amount: number;
  /** "credit": paid from the family's credit on file. */
  method: "cash" | "zelle" | "venmo" | "stripe" | "credit";
  reference: string | null;
  received_at: string;
  notes: string | null;
  /** Stripe's id for the charge; unique, so a redelivered webhook records nothing. */
  external_id: string | null;
  zelle_receipt_id: string | null;
  /** Card fee collected on top of `amount`. */
  fee: number;
  /** Sent by the form that recorded it; unique, so a double tap records nothing more. */
  client_key: string | null;
  created_at: string;
};

/**
 * A family's credit ledger. Positive: money in that nothing was owed for.
 * Negative: credit spent, with the payment it made. The sum is their credit.
 */
export type FamilyCredit = {
  id: string;
  parent_id: string;
  amount: number;
  method: "cash" | "zelle" | "venmo" | null;
  zelle_receipt_id: string | null;
  payment_id: string | null;
  client_key: string | null;
  note: string | null;
  created_at: string;
};

/** A bank's "you received money with Zelle" email, and what became of it. */
export type ZelleReceipt = {
  id: string;
  message_id: string;
  sender_name: string | null;
  amount: number | null;
  memo: string | null;
  received_at: string;
  status: "matched" | "unmatched" | "unreadable" | "ignored";
  parent_id: string | null;
  note: string | null;
  subject: string | null;
  body: string | null;
  created_at: string;
};

/** A Zelle sender name the owner has tied to a family. */
export type ZelleSender = {
  sender_key: string;
  parent_id: string;
  created_at: string;
};

export type MessageTemplate = {
  id: string;
  name: string;
  category: "reminder" | "payment" | "welcome" | "cancellation" | "general";
  body: string;
  variables: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type MessageQueue = {
  id: string;
  recipient_phone: string;
  recipient_name: string | null;
  message: string;
  template_id: string | null;
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageLog = {
  id: string;
  queue_id: string | null;
  recipient_phone: string;
  recipient_name: string | null;
  message: string;
  status: "sent" | "failed" | "delivered" | "read";
  sent_at: string;
  whatsapp_message_id: string | null;
  error: string | null;
};

export type Lead = {
  id: string;
  school_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  stage: "identified" | "contacted" | "meeting" | "proposal" | "signed" | "lost";
  estimated_students: number | null;
  notes: string | null;
  next_follow_up: string | null;
  /** 'website' when it came from the site's partnership form. */
  source?: string | null;
  attribution?: Attribution | null;
  created_at: string;
  updated_at: string;
};

/** Where a family came from, as the website captured it (see lib/attribution.ts). */
export type AttributionTouch = Partial<
  Record<
    | "utm_source" | "utm_medium" | "utm_campaign" | "utm_term" | "utm_content"
    | "gclid" | "fbclid" | "referrer" | "landing_path" | "ts",
    string
  >
>;
export type Attribution = {
  first_touch?: AttributionTouch;
  last_touch?: AttributionTouch;
  ga_client_id?: string;
  ga_session_id?: string;
};

export const INQUIRY_STATUSES = ["new", "contacted", "trial_booked", "registered", "lost"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export type InquiryKind = "general" | "trial" | "waitlist_interest" | "program_question" | "birthday_party";

/** A family's question from the website (public.submit_inquiry). */
export type Inquiry = {
  id: string;
  kind: InquiryKind;
  status: InquiryStatus;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  child_ages: string | null;
  offering_id: string | null;
  sport: string | null;
  inquiry_types: string[];
  preferred_date: string | null;
  organization: string | null;
  registration_id: string | null;
  attribution: Attribution | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadActivity = {
  id: string;
  lead_id: string;
  type: "note" | "call" | "email" | "meeting" | "stage_change";
  description: string;
  created_at: string;
};

export type Config = {
  id: string;
  category: string;
  key: string;
  value: string;
  label: string;
  description: string | null;
  field_type: "toggle" | "number" | "text" | "time" | "select" | "textarea" | "secret" | "email" | "url" | "phone";
  options: string[] | null;
  sort_order: number;
};

// Joined types for queries
export type StudentWithParents = Student & {
  parents: (Parent & { relationship: string })[];
};

export type EnrollmentWithDetails = Enrollment & {
  student: Student;
  program: Program & { school: School };
};

export type InvoiceWithDetails = Invoice & {
  parent: Parent;
  student: Student;
  program: Program;
  payments: Payment[];
};

export type SessionWithAttendance = Session & {
  program: Program & { school: School };
  attendance: (Attendance & { student: Student })[];
};

export type Coach = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  status: "active" | "inactive" | "prospective";
  pay_rate: number | null;
  pay_type: "per_session" | "hourly";
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type RegistrationStatus =
  | "pending"
  | "confirmed"
  | "waitlisted"
  | "cancelled"
  | "declined";

export type Registration = {
  id: string;
  program_id: string;
  status: RegistrationStatus;
  child_first_name: string;
  child_last_name: string;
  child_grade: string | null;
  child_date_of_birth: string | null;
  parent_first_name: string;
  parent_last_name: string;
  parent_phone: string;
  parent_email: string | null;
  medical_notes: string | null;
  how_heard: string | null;
  student_id: string | null;
  parent_id: string | null;
  enrollment_id: string | null;
  waitlist_position: number | null;
  amount: number | null;
  payment_status: "unpaid" | "paid" | "refunded" | "waived";
  stripe_checkout_session_id: string | null;
  notes: string | null;
  /** Where the family came from, when they registered on the website. */
  attribution?: Attribution | null;
  /** What the parent agreed to on the website's form (submit_registration_v2). */
  consents?: { terms: boolean; medical: boolean; photo: boolean; policy_version: string | null; accepted_at: string } | null;
  created_at: string;
  updated_at: string;
};

/** Aggregate seat counts only — the `program_availability` view carries no PII. */
export type ProgramAvailability = {
  program_id: string;
  public_slug: string | null;
  name: string;
  location: string | null;
  public_description: string | null;
  season: string | null;
  start_date: string | null;
  end_date: string | null;
  monthly_fee: number;
  capacity: number;
  registration_open: boolean;
  school_name: string;
  seats_taken: number;
  seats_remaining: number;
  waitlist_count: number;
};
