const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const relativeFormatter = new Intl.RelativeTimeFormat('en-US', {
  numeric: 'auto',
});

/**
 * Normalize a server date string to a proper UTC Date.
 * SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" (no T, no Z).
 * Without the Z suffix, `new Date()` parses space-separated formats as local time.
 * This function detects that format and appends 'Z' so it's correctly treated as UTC.
 */
function parseServerDate(date: Date | string): Date {
  if (date instanceof Date) return date;
  // Match SQLite format: "YYYY-MM-DD HH:MM:SS" (no T, no Z/timezone)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) {
    return new Date(date.replace(' ', 'T') + 'Z');
  }
  return new Date(date);
}

export function formatDate(date: Date | string): string {
  return dateFormatter.format(parseServerDate(date));
}

export function formatTime(date: Date | string): string {
  return timeFormatter.format(parseServerDate(date));
}

export function formatDateTime(date: Date | string): string {
  return dateTimeFormatter.format(parseServerDate(date));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return '< 1m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatRelativeTime(date: Date | string): string {
  const d = parseServerDate(date);
  const now = new Date();
  const diffInSeconds = Math.floor((d.getTime() - now.getTime()) / 1000);
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);

  if (Math.abs(diffInSeconds) < 60) {
    return relativeFormatter.format(diffInSeconds, 'second');
  } else if (Math.abs(diffInMinutes) < 60) {
    return relativeFormatter.format(diffInMinutes, 'minute');
  } else if (Math.abs(diffInHours) < 24) {
    return relativeFormatter.format(diffInHours, 'hour');
  } else {
    return relativeFormatter.format(diffInDays, 'day');
  }
}
