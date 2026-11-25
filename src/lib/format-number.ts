const shortMonths = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];
const longMonths = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export function formatCount(value: number) {
  const integer = Math.trunc(value);
  const sign = integer < 0 ? "-" : "";
  const digits = String(Math.abs(integer));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatDateId(value: string | null, monthStyle: "short" | "long" = "short") {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return "—";

  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  const monthName = (monthStyle === "long" ? longMonths : shortMonths)[monthIndex];
  if (!monthName) return "—";

  return `${day} ${monthName} ${year}`;
}

export function getCurrentISODate() {
  return new Date().toISOString().slice(0, 10);
}
