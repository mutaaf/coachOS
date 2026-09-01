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
  status: "pending" | "paid" | "overdue" | "waived";
  stripe_invoice_id: string | null;
  stripe_hosted_invoice_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Payment = {
  id: string;
  invoice_id: string;
  amount: number;
  method: "cash" | "zelle" | "venmo" | "stripe";
  reference: string | null;
  received_at: string;
  notes: string | null;
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
  field_type: "toggle" | "number" | "text" | "time" | "select" | "textarea";
  options: string[] | null;
  sort_order: number;
};

export type WhatsAppState = {
  id: string;
  status: "disconnected" | "connecting" | "qr_ready" | "connected";
  qr_code: string | null;
  phone_number: string | null;
  last_connected_at: string | null;
  updated_at: string;
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
