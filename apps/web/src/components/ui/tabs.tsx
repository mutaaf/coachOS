"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tabs with the ARIA roles a screen reader expects (tablist / tab / tabpanel),
 * arrow-key movement between tabs, and a tab list that scrolls sideways inside
 * itself on a phone rather than pushing the page wider.
 */

interface TabsContextType {
  value: string;
  onValueChange: (value: string) => void;
  baseId: string;
}

const TabsContext = React.createContext<TabsContextType>({
  value: "",
  onValueChange: () => {},
  baseId: "",
});

const idFor = (base: string, kind: "tab" | "panel", value: string) =>
  `${base}-${kind}-${value.replace(/[^A-Za-z0-9_-]/g, "_")}`;

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
}

function Tabs({
  defaultValue,
  value: controlledValue,
  onValueChange,
  children,
  ...props
}: TabsProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const value = controlledValue ?? internalValue;
  const baseId = React.useId().replace(/:/g, "");

  return (
    <TabsContext.Provider
      value={{
        value,
        onValueChange: onValueChange ?? setInternalValue,
        baseId,
      }}
    >
      <div {...props}>{children}</div>
    </TabsContext.Provider>
  );
}

function TabsList({
  className,
  onKeyDown,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  function handleKey(e: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  }

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn(
        // Shrinks to its tabs, up to the width it has; past that it scrolls
        // sideways inside itself. Taller on a phone so each tab is a real target.
        "no-scrollbar inline-flex h-12 max-w-full items-center justify-start overflow-x-auto overscroll-x-contain rounded-lg bg-muted p-1 text-muted-foreground sm:h-10",
        className
      )}
      onKeyDown={handleKey}
      {...props}
    />
  );
}

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

function TabsTrigger({ className, value, id, ...props }: TabsTriggerProps) {
  const context = React.useContext(TabsContext);
  const selected = context.value === value;
  const ref = React.useRef<HTMLButtonElement>(null);

  // Keep the chosen tab in view when the list is scrolled sideways (a tab
  // opened from a link, or the last one on a narrow phone).
  React.useEffect(() => {
    const el = ref.current;
    const list = el?.parentElement;
    if (!selected || !el || !list || list.scrollWidth <= list.clientWidth) return;
    const left = el.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + el.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: Math.max(0, left - 16), behavior: "smooth" });
    }
  }, [selected]);

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={id ?? idFor(context.baseId, "tab", value)}
      aria-selected={selected}
      aria-controls={idFor(context.baseId, "panel", value)}
      tabIndex={selected ? 0 : -1}
      data-state={selected ? "active" : "inactive"}
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:h-8 sm:py-1.5",
        selected && "bg-background text-foreground shadow-sm",
        className
      )}
      onClick={() => context.onValueChange(value)}
      {...props}
    />
  );
}

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

function TabsContent({ className, value, id, ...props }: TabsContentProps) {
  const context = React.useContext(TabsContext);

  if (context.value !== value) return null;

  return (
    <div
      role="tabpanel"
      id={id ?? idFor(context.baseId, "panel", value)}
      aria-labelledby={idFor(context.baseId, "tab", value)}
      tabIndex={0}
      className={cn(
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
