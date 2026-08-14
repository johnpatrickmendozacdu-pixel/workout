/**
 * Feature notices, as data — and deliberately shipped inside the build rather
 * than fetched from the Worker.
 *
 * The release IS the delivery mechanism. That means no endpoint, no table and
 * no network dependency in the topbar (Social stays the only screen that needs
 * a connection), and it is honest by construction: a notice about a feature can
 * never arrive before the feature it describes.
 *
 * Adding an entry here is what sends it, so the entry is the approval gate.
 * Nothing goes in without Johnny saying yes, every time — a feature that ships,
 * gets reworked and ships again should not fire three notices at everyone.
 *
 * Newest first. `id` must never be reused: it is what "already read" is keyed
 * on, so a recycled id would silently mark a new notice as read.
 */
export const NOTICES = [
  {
    id: '2026-08-14-updates-and-bell.2',
    date: '2026-08-14',
    title: 'Sets updates itself now',
    body: [
      'No more “force update”. When you come back to the app, it quietly takes the newest version — never while a clock is running or a sheet is open, so nothing you are in the middle of gets thrown away.',
      'The button next to this bell shows a tick when you are on the newest build, and an arrow when one is waiting. Tap it any time to pull the newest build down yourself.',
      'This bell is where new things get explained. The number tells you how many you have not read.',
    ],
  },
  {
    id: '2026-08-14-health-habits.2',
    date: '2026-08-14',
    title: 'Health habits',
    body: [
      'Plan → Add → Health habit. No target and no reps: a day is clean unless something breaks it.',
      'Keto, No alcohol and Brush teeth can be tracked by day or by every meal — breakfast, lunch, dinner and the snacks between them. Skipping a meal costs nothing, because not eating is not a carb. Everything else is one tap a day.',
      'Once you tap a slot it is final, and that is the point: a streak you can edit is not a streak. A day you never logged is simply neutral, and you can take a day off plan whenever you need one.',
      'A habit day runs 5 AM to 5 AM, so a late-night snack lands on the night you are still up rather than the morning you have not started.',
    ],
  },
];
