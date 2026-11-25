export function formatIDR(amount: number) {
  const absoluteCents = Math.round((Math.abs(amount) + Number.EPSILON) * 100);
  const whole = Math.floor(absoluteCents / 100);
  const fraction = String(absoluteCents % 100).padStart(2, "0");
  const groupedWhole = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = amount < 0 ? "-" : "";

  return `Rp${sign}${groupedWhole}${fraction === "00" ? "" : `,${fraction}`}`;
}
