"use client";

import { Button } from "@/components/ui/button";
import type { ChildOnFile, ParentOnFile } from "@/lib/identity";

/**
 * "Is this the same Mia?" — asked when someone being added has the name (or,
 * for a parent, the phone number) of someone already on file. Answering yes
 * uses the record on file, so a medical note reaches the child the coach sees
 * and nobody is billed twice; answering no adds a new one.
 */

export interface SameMatch {
  id: string;
  title: string;
  detail: string;
}

export function childMatches(children: ChildOnFile[]): SameMatch[] {
  return children.map((c) => ({
    id: c.id,
    title: `${c.first_name} ${c.last_name}`,
    detail: [
      c.grade ? `Grade ${c.grade}` : null,
      c.parents.length ? `Parent: ${c.parents.map((p) => `${p.first_name} ${p.last_name}`).join(", ")}` : "No parent linked",
      c.status === "inactive" ? "archived" : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}

export function parentMatches(parents: ParentOnFile[]): SameMatch[] {
  return parents.map((p) => ({ id: p.id, title: `${p.first_name} ${p.last_name}`, detail: p.phone }));
}

interface SamePersonPromptProps {
  question: string;
  matches: SameMatch[];
  sameLabel: string;
  newLabel: string;
  onSame: (id: string) => void;
  onNew: () => void;
  onBack?: () => void;
  disabled?: boolean;
}

export function SamePersonPrompt({
  question,
  matches,
  sameLabel,
  newLabel,
  onSame,
  onNew,
  onBack,
  disabled,
}: SamePersonPromptProps) {
  return (
    <div role="group" aria-label={question} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-medium">{question}</p>
      <p className="text-xs text-muted-foreground">
        {matches.length === 1 ? "Someone like this is already on file:" : "People like this are already on file:"}
      </p>
      <ul className="space-y-2">
        {matches.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 rounded-md bg-white p-2">
            <div className="min-w-0">
              <div className="text-sm font-medium">{m.title}</div>
              <div className="truncate text-xs text-muted-foreground">{m.detail}</div>
            </div>
            <Button type="button" size="sm" disabled={disabled} onClick={() => onSame(m.id)}>
              {sameLabel}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        {onBack && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onBack}>
            Back
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onNew}>
          {newLabel}
        </Button>
      </div>
    </div>
  );
}
