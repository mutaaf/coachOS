export type TemplateVariables = Record<string, string | number>;

// "{{parent_name}}", "{{ parent_name }}" and "{{Parent_Name}}" are all the same
// variable. Only the first was matched once, so the others reached parents as
// raw braces.
const VARIABLE = /\{\{\s*(\w+)\s*\}\}/g;

export function renderTemplate(
  template: string,
  variables: TemplateVariables
): string {
  return template.replace(VARIABLE, (match, key: string) => {
    const value = variables[key.toLowerCase()];
    return value !== undefined ? String(value) : match;
  });
}

/** The variables a template uses, lowercased and each once. */
export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VARIABLE)].map((m) => m[1].toLowerCase()))];
}

/** True when a message still holds "{{" or "}}" — a variable left unfilled or half-typed. */
export function hasLeftoverBraces(text: string): boolean {
  return /\{\{|\}\}/.test(text);
}
