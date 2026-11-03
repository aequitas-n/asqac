import { formatDistanceToNowStrict, format } from 'date-fns';
export const humanize = (s: string) =>
  s.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export function ago(s: string | null) {
  return s ? formatDistanceToNowStrict(new Date(s), { addSuffix: true }) : 'No packets yet';
}
export const dateTime = (s: string | null) =>
  s ? format(new Date(s), 'dd MMM yyyy, HH:mm:ss') : '—';
export const number = (n: number | null | undefined, digits = 1) =>
  n == null ? '—' : n.toFixed(digits);
export function duration(start: string | null, end: string | null) {
  return start && end ? Math.max(0, (Date.parse(end) - Date.parse(start)) / 60000) : null;
}
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const quote = (value: unknown) => {
    let str =
      value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
    return `"${str.replaceAll('"', '""')}"`;
  };
  const blob = new Blob(
    [
      '\uFEFF' +
        [
          keys.map(quote).join(','),
          ...rows.map((row) => keys.map((k) => quote(row[k])).join(',')),
        ].join('\r\n'),
    ],
    { type: 'text/csv;charset=utf-8;' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const sources = [
  {
    label: 'WHO · Infectious substance transport',
    url: 'https://www.who.int/publications/i/item/9789240089525',
  },
  { label: 'CLSI PRE04 · Blood specimen handling', url: 'https://clsi.org/shop/standards/pre04/' },
  {
    label: 'Oxford · Specimen transport protocol',
    url: 'https://www.ouh.nhs.uk/media/a0gmzj5t/directorate-protocol.pdf',
  },
];
export function auditDescription(detail: Record<string, unknown>): string {
  if (detail.synthetic) return 'Synthetic historical demonstration.';
  return [
    detail.capsule_code,
    detail.specimen_code,
    detail.profile_code ? `Handling preset ${String(detail.profile_code)}` : null,
    detail.type ? humanize(String(detail.type)) : null,
    detail.severity ? `${humanize(String(detail.severity))} severity` : null,
    detail.verdict ? `Disposition: ${humanize(String(detail.verdict))}` : null,
    detail.message,
    detail.notes,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' · ');
}
