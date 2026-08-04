/**
 * The whole guide, as data.
 *
 * One table, one source of truth. The Guide screen is the only thing that
 * renders it, and a new feature means a new row here rather than a new
 * explanation written somewhere else that quietly stops being true. Anything
 * that would have to be re-recorded or re-screenshotted when the UI changes
 * does not belong in a guide — words describing what the app does survive a
 * restyle, pictures of it do not.
 *
 * Each section is [term, explanation] pairs: the thing on the left, what it
 * does beneath. Half the words of a paragraph and twice as scannable, which is
 * what someone hunting one answer actually needs.
 */
export const GUIDE_SECTIONS = [
  {
    id: 'basics',
    title: 'The four screens',
    items: [
      ['Today', 'What is still to do today, and what is already done. Only exercises scheduled for today appear.'],
      ['Plan', 'Your exercises. Add, edit, reschedule, archive or delete them here.'],
      ['Progress', 'Every number the app keeps: streaks, best days, totals, times and your weight trend.'],
      ['Guide', 'This screen. Nothing here changes your data — read it as often as you like.'],
      ['The ? button', 'On every screen, a short guide to that screen alone.'],
    ],
  },
  {
    id: 'add',
    title: 'Adding an exercise',
    items: [
      ['Start', 'Plan → Add. Scheduled is something you repeat; One-time is a one-off.'],
      ['Name', 'Whatever you call it. Push-ups, Plank, Evening walk.'],
      ['Icon', 'Pick one from the row. Decoration only — it changes nothing.'],
      ['Unit', 'What you are counting: reps, minutes, km, laps. It is a label; the app counts whatever you tap.'],
      ['Equipment', 'Bodyweight, or Dumbbell with a weight in kg or lb. The weight never changes a total or a streak — it is recorded so Progress can show it going up.'],
      ['Save', 'It appears on Today on the days you scheduled it.'],
      ['Change your mind', 'Tap the exercise in Plan to edit anything, any time.'],
      ['Retire it', 'Archive keeps all its history and takes it off Today. Delete removes it and its history for good.'],
    ],
  },
  {
    id: 'schedule',
    title: 'Schedules',
    items: [
      ['Every day', 'It shows on Today, every day.'],
      ['Chosen days', 'Tap the day letters. It shows on those days only.'],
      ['A day off is not a miss', 'Days you never scheduled are never counted against you.'],
      ['Changing the days later', 'Takes effect from today. Past days keep the schedule they were done under, so a day you trained stays a day you trained.'],
      ['Groups', 'Plan and Progress group exercises that share the same days. Change an exercise’s days and it moves to the matching group.'],
    ],
  },
  {
    id: 'targets',
    title: 'Targets',
    items: [
      ['Optional', 'Leave it blank and the exercise still counts everything you log — it just will not count toward a streak.'],
      ['With a target', 'Today shows how many are left. Reaching it completes the day.'],
      ['Beating it', 'Go past your target and the app raises the target to what you actually did.'],
      ['Changing it', 'Takes effect from today. Past days keep the target they were done under.'],
    ],
  },
  {
    id: 'logging',
    title: 'Logging a set',
    items: [
      ['Open it', 'Tap the exercise on Today.'],
      ['Add', 'Tap any number. It is logged straight away — there is no confirm step.'],
      ['Take it back', 'Flip the lever to Subtract and tap a number, or tap Undo on the message that appears.'],
      ['Type an exact number', 'Tap the big total to type it in directly.'],
      ['Today’s sets', 'Listed under the keypad, each with an ✕ to remove just that one.'],
    ],
  },
  {
    id: 'clock',
    title: 'The clock',
    items: [
      ['It starts itself', 'On your first rep. There is no start button to forget.'],
      ['Pause', 'Stops the clock. Your reps still count and nothing is lost.'],
      ['Target reached', 'Take the win banks the time. Keep going carries on counting reps, sets and time.'],
      ['Give up', 'Ends the session early. Your reps still count; the time is left out of your best and average.'],
      ['Reset', 'Puts today’s clock back to 0:00 and leaves every rep alone.'],
    ],
  },
  {
    id: 'onetime',
    title: 'One-time workouts',
    items: [
      ['What it is', 'Something you just did, with no schedule and no target.'],
      ['Add one', 'Plan → Add → One-time. Give it a name and a unit.'],
      ['Use it', 'It sits on Today. Add to it as you go, then Complete when you are done.'],
      ['Afterwards', 'It moves to Progress, under One time.'],
    ],
  },
  {
    id: 'streaks',
    title: 'Rest days and streaks',
    items: [
      ['A streak per exercise', 'Each one keeps its own. A day counts once you hit that exercise’s target.'],
      ['Resting on purpose', 'Open the exercise and Take a break. The day is recorded as rest and the streak holds.'],
      ['A missed day', 'A scheduled day with nothing logged and no rest taken is what breaks a streak.'],
      ['History is never rewritten', 'A day you logged stays logged, whatever you change about the exercise afterwards.'],
    ],
  },
  {
    id: 'weight',
    title: 'Weigh-in, weight and BMI',
    items: [
      ['The card on Today', 'One weight a day. It disappears once today is logged.'],
      ['It is not an exercise', 'It has no target and it touches no streak, ever.'],
      ['The same number as yesterday', 'Still counts. It is one entry per day, not one per change.'],
      ['Correcting today', 'Log it again — the same day is replaced, not doubled.'],
      ['The chart', 'Progress plots each week’s average rather than each day, so normal daily wobble does not read as progress.'],
      ['BMI', 'Appears in Profile once both weight and height are set.'],
    ],
  },
  {
    id: 'progress',
    title: 'Reading Progress',
    items: [
      ['The strip', 'Filled = target hit. 🌙 = rest. Hollow = missed. Faint = a day the exercise was not scheduled.'],
      ['Open a card', 'Its totals, best day, times and recent days.'],
      ['Top set vs Max', 'Top set is your biggest single set. Max is your biggest whole day.'],
      ['Fixing a number', 'Tap a total or a target inside a card to correct it.'],
      ['Combo times', 'For a group of exercises sharing days: the total, average and best time across the group.'],
    ],
  },
  {
    id: 'profile',
    title: 'Your profile',
    items: [
      ['Where', 'The circle at the top right of any screen.'],
      ['Photo', 'Add photo, then pick one. It is shrunk to a small square before saving, so it never bloats a backup.'],
      ['Name', 'Only used for the greeting on Today.'],
      ['Height', 'Only used to work out BMI.'],
      ['Weight', 'Shared with the weigh-in — logging a weight here or there updates both.'],
      ['Saving', 'Tap Save profile. The sync buttons above it act immediately and need no saving.'],
    ],
  },
  {
    id: 'google',
    title: 'Signing in with Google',
    items: [
      ['Why bother', 'It copies your data to your own Google Drive, so a lost or replaced phone is not lost training history.'],
      ['It is optional', 'The app is completely functional without it, online or off. Nothing is held back.'],
      ['Where', 'Profile → Sign in with Google.'],
      ['What you will see', 'Google asks which account to use, then asks you to allow Sets to see only its own folder in Drive. Pick your account, then Continue. There is nothing else to choose.'],
      ['What it can actually see', 'Only the files it creates in that one hidden folder. Not your photos, not your documents, not anything else in your Drive.'],
      ['“Synced”', 'A tick and your email address. It syncs on its own from then on — there is nothing to press.'],
      ['“Sync waiting”', 'You are offline or Google is slow. Nothing to do. Everything you log is already safe on the phone and it will catch up by itself.'],
      ['“Sync paused”', 'Google wants you to confirm it is you again. Tap Reconnect. Your data is untouched either way.'],
      ['Sign out', 'Stops syncing on this device. The backup already in your Drive stays where it is.'],
    ],
  },
  {
    id: 'data',
    title: 'Where your data lives',
    items: [
      ['On this phone', 'In this browser’s own storage. That is the live copy — instant, and it works with no signal.'],
      ['Drive is the backup', 'A copy in a hidden folder only this app can read. A safety net, not the original.'],
      ['One account, one set of data', 'Sign in with a different Google account and you get a separate, empty app. Nobody’s data mixes with anybody else’s.'],
      ['Export', 'Progress → ⚙ → Export backup. A single file, and the only way to move data between phones without Google.'],
      ['Import', 'Same sheet. It merges with what is already here rather than wiping it.'],
      ['If you are on an iPhone', 'Safari can clear a site’s storage when you have not opened it for about a week. Signing in, or exporting now and then, is what protects you from that.'],
      ['Force update now', 'Same sheet. Throws away the cached app and loads the newest build. Your workouts are stored separately and are never touched by it.'],
    ],
  },
];
