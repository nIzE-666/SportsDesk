/** Joins the class names of a kit element, skipping empty values. */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
