/**
 * ParkEase hours are Indian local time (UTC+05:30, no daylight saving).
 * The Data Science models were trained on local hours, so date and hour
 * parameters are always interpreted in this zone, wherever the server runs.
 */
const OFFSET = "+05:30";
const OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function localNow(): { date: string; hour: number } {
  const shifted = new Date(Date.now() + OFFSET_MS);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

/** Start and end (one hour later) of a local date + hour, as real instants. */
export function hourWindow(date: string, hour: number): { start: Date; end: Date } {
  const start = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00${OFFSET}`);
  return { start, end: new Date(start.getTime() + 60 * 60 * 1000) };
}

export function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00${OFFSET}`).getTime());
}
