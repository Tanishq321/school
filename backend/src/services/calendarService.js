import env from '../config/env.js';

const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const text = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 line folding: lines longer than 75 octets continue on the next line after a space. */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** An iCalendar event for one class, for "Add to calendar" and email invitations. */
export function buildIcs(meeting, { url, hostName, method = 'PUBLISH' }) {
  const host = new URL(env.APP_URL).hostname;
  const cancelled = meeting.status === 'cancelled';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${text(env.APP_NAME)}//Classes//EN`,
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : method}`,
    'BEGIN:VEVENT',
    `UID:${meeting._id}@${host}`,
    `DTSTAMP:${stamp(new Date())}`,
    `SEQUENCE:${Math.floor(new Date(meeting.updatedAt || Date.now()).getTime() / 60000) % 2147483647}`,
    `DTSTART:${stamp(meeting.scheduledStart)}`,
    `DTEND:${stamp(meeting.scheduledEnd || new Date(new Date(meeting.scheduledStart).getTime() + (meeting.durationMinutes || 60) * 60000))}`,
    `SUMMARY:${text(meeting.title)}`,
    `DESCRIPTION:${text(`${hostName ? `With ${hostName}. ` : ''}Join: ${url}${meeting.description ? `\n\n${meeting.description}` : ''}`)}`,
    `URL:${url}`,
    `LOCATION:${text(url)}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${text(meeting.title)}`,
    'TRIGGER:-PT10M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
