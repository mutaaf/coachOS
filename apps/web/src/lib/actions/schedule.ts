"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ---------- Schedule Template Actions ----------

export async function createScheduleTemplate(formData: FormData) {
  const supabase = createServerSupabase();

  const program_id = formData.get("program_id") as string;
  const day_of_week = parseInt(formData.get("day_of_week") as string, 10);
  const start_time = formData.get("start_time") as string;
  const end_time = formData.get("end_time") as string;
  const location = formData.get("location") as string | null;

  if (!program_id || isNaN(day_of_week) || !start_time || !end_time) {
    return { error: "Program, day of week, start time, and end time are required." };
  }

  if (day_of_week < 0 || day_of_week > 6) {
    return { error: "Day of week must be between 0 (Sunday) and 6 (Saturday)." };
  }

  const { data, error } = await supabase
    .from("schedule_templates")
    .insert({
      program_id,
      day_of_week,
      start_time,
      end_time,
      location: location?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating schedule template:", error);
    return { error: "Failed to create schedule template. Please try again." };
  }

  revalidatePath("/schedule");
  return { data };
}

export async function updateScheduleTemplate(id: string, formData: FormData) {
  const supabase = createServerSupabase();

  const program_id = formData.get("program_id") as string;
  const day_of_week = parseInt(formData.get("day_of_week") as string, 10);
  const start_time = formData.get("start_time") as string;
  const end_time = formData.get("end_time") as string;
  const location = formData.get("location") as string | null;

  if (!program_id || isNaN(day_of_week) || !start_time || !end_time) {
    return { error: "Program, day of week, start time, and end time are required." };
  }

  const { data, error } = await supabase
    .from("schedule_templates")
    .update({
      program_id,
      day_of_week,
      start_time,
      end_time,
      location: location?.trim() || null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating schedule template:", error);
    return { error: "Failed to update schedule template. Please try again." };
  }

  revalidatePath("/schedule");
  return { data };
}

export async function deleteScheduleTemplate(id: string) {
  const supabase = createServerSupabase();

  const { error } = await supabase
    .from("schedule_templates")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting schedule template:", error);
    return { error: "Failed to delete schedule template. Please try again." };
  }

  revalidatePath("/schedule");
  return { success: true };
}

// ---------- Session Generation ----------

export async function generateSessions(programId: string | null, weeksAhead: number) {
  const supabase = createServerSupabase();

  // Fetch schedule templates
  let templateQuery = supabase.from("schedule_templates").select("*");
  if (programId) {
    templateQuery = templateQuery.eq("program_id", programId);
  }

  const { data: templates, error: templateError } = await templateQuery;

  if (templateError) {
    console.error("Error fetching templates:", templateError);
    return { error: "Failed to fetch schedule templates." };
  }

  if (!templates || templates.length === 0) {
    return { error: "No schedule templates found. Create templates first." };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let sessionsCreated = 0;

  for (const template of templates) {
    // For each template, calculate the next N occurrences of that day_of_week
    const targetDay = template.day_of_week; // 0=Sunday, 6=Saturday

    for (let week = 0; week < weeksAhead; week++) {
      // Calculate the date for this day_of_week in the target week
      const currentDay = today.getDay(); // 0=Sunday
      let daysUntilTarget = targetDay - currentDay;

      // If the target day has already passed this week (and we're on week 0),
      // we still include it if it's today
      if (daysUntilTarget < 0 && week === 0) {
        // Skip past days in current week unless it's today
        daysUntilTarget += 7;
      }

      const sessionDate = new Date(today);
      sessionDate.setDate(today.getDate() + daysUntilTarget + week * 7);

      // Don't create sessions in the past
      if (sessionDate < today) continue;

      const dateStr = sessionDate.toISOString().split("T")[0];

      // Check if session already exists for this program + date + start_time
      const { data: existing } = await supabase
        .from("sessions")
        .select("id")
        .eq("program_id", template.program_id)
        .eq("date", dateStr)
        .eq("start_time", template.start_time)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Create the session
      const { error: insertError } = await supabase.from("sessions").insert({
        schedule_template_id: template.id,
        program_id: template.program_id,
        date: dateStr,
        start_time: template.start_time,
        end_time: template.end_time,
        status: "scheduled",
        is_makeup: false,
      });

      if (insertError) {
        console.error("Error creating session:", insertError);
        continue;
      }

      sessionsCreated++;
    }
  }

  revalidatePath("/schedule");
  return { data: { sessionsCreated } };
}

// ---------- Session Status Actions ----------

export async function cancelSession(id: string, reason: string) {
  const supabase = createServerSupabase();

  if (!reason || reason.trim().length === 0) {
    return { error: "Cancellation reason is required." };
  }

  const { data, error } = await supabase
    .from("sessions")
    .update({
      status: "cancelled",
      cancel_reason: reason.trim(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error cancelling session:", error);
    return { error: "Failed to cancel session. Please try again." };
  }

  revalidatePath("/schedule");
  return { data };
}

export async function completeSession(id: string) {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("sessions")
    .update({
      status: "completed",
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error completing session:", error);
    return { error: "Failed to mark session as complete. Please try again." };
  }

  revalidatePath("/schedule");
  return { data };
}

// ---------- Makeup Session ----------

export async function createMakeupSession(formData: FormData) {
  const supabase = createServerSupabase();

  const program_id = formData.get("program_id") as string;
  const date = formData.get("date") as string;
  const start_time = formData.get("start_time") as string;
  const end_time = formData.get("end_time") as string;
  const notes = formData.get("notes") as string | null;

  if (!program_id || !date || !start_time || !end_time) {
    return { error: "Program, date, start time, and end time are required." };
  }

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      program_id,
      date,
      start_time,
      end_time,
      status: "scheduled",
      is_makeup: true,
      notes: notes?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating makeup session:", error);
    return { error: "Failed to create makeup session. Please try again." };
  }

  revalidatePath("/schedule");
  return { data };
}

// ---------- Attendance ----------

export async function recordAttendance(
  sessionId: string,
  records: { studentId: string; status: "present" | "absent" | "late" | "excused" }[]
) {
  const supabase = createServerSupabase();

  if (!sessionId || !records || records.length === 0) {
    return { error: "Session ID and attendance records are required." };
  }

  const errors: string[] = [];

  for (const record of records) {
    const checkedInAt =
      record.status === "present" || record.status === "late"
        ? new Date().toISOString()
        : null;

    const { error } = await supabase
      .from("attendance")
      .upsert(
        {
          session_id: sessionId,
          student_id: record.studentId,
          status: record.status,
          checked_in_at: checkedInAt,
        },
        {
          onConflict: "session_id,student_id",
        }
      );

    if (error) {
      console.error("Error recording attendance:", error);
      errors.push(`Failed for student ${record.studentId}`);
    }
  }

  if (errors.length > 0) {
    revalidatePath("/schedule");
    return { error: `Some attendance records failed: ${errors.join(", ")}` };
  }

  revalidatePath("/schedule");
  return { success: true };
}
