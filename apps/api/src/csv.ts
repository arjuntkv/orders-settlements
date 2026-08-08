export function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(fields: (string | number)[]): string {
  return fields.map(csvField).join(',');
}
