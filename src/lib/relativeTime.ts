/**
 * relativeTime.ts — localized relative timestamps ("2 hours ago" / "il y a 2 heures")
 * using the native Intl.RelativeTimeFormat. No dependencies.
 */

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
   { amount: 60,                       unit: 'second' },
   { amount: 60,                       unit: 'minute' },
   { amount: 24,                       unit: 'hour' },
   { amount: 7,                        unit: 'day' },
   { amount: 4.34524,                  unit: 'week' },
   { amount: 12,                       unit: 'month' },
   { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

/** Format an ISO-8601 timestamp relative to now, in the given BCP-47 locale. */
export function formatRelativeTime(isoString: string, locale: string): string {
   const timestamp = new Date(isoString).getTime()
   if (Number.isNaN(timestamp)) return ''

   const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
   let duration = (timestamp - Date.now()) / 1000   // seconds; negative = in the past
   for (const division of DIVISIONS) {
      if (Math.abs(duration) < division.amount) {
         return formatter.format(Math.round(duration), division.unit)
      }
      duration /= division.amount
   }
   return ''
}
