// Dates in the data files are "YYYY-MM-DD" strings. Parsed as UTC and
// formatted in UTC, so a date can never shift by a day with the visitor's
// timezone. Anything unparseable is returned as-is.
const inUtc = { timeZone: "UTC" };
const longDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", ...inUtc });
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", ...inUtc });

function format(formatter, value) {
  if (!value) return "";
  const date = new Date(String(value).trim());
  return Number.isNaN(date.getTime()) ? String(value) : formatter.format(date);
}

/** "21 August 2025" */
export const formatLongDate = (value) => format(longDate, value);

/** "21/08/2025" */
export const formatShortDate = (value) => format(shortDate, value);

// Serializes build-time data for a <script type="application/json"> island.
export const toJsonIsland = (data) => JSON.stringify(data).replace(/</g, "\u003c");
