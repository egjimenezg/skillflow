const ranges: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000], ["month", 2_592_000], ["week", 604_800],
  ["day", 86_400], ["hour", 3_600], ["minute", 60],
];

export function relativeDate(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, amount] of ranges) {
    if (Math.abs(seconds) >= amount) return formatter.format(Math.round(seconds / amount), unit);
  }
  return "just now";
}
