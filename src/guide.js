/**
 * The whole guide, as data.
 *
 * One table, one source of truth. The guide sheet is the only thing that
 * renders it, and a new feature means a new row here rather than a new
 * explanation written somewhere else that quietly stops being true. Anything
 * needing a re-record or a re-screenshot when the UI changes does not belong
 * in a guide — words describing what the app does survive a restyle.
 *
 * Three orderings were tried. By subject read as a filing cabinet. By "what
 * you do first" put training first and left a new phone unprotected for a
 * week. This one puts the once-only setup first — sign in, profile, where the
 * data lives — because the cost of doing that late is the only cost here that
 * cannot be undone.
 *
 * `phase` chunks the steps for the eye. Twelve equal items is past what anyone
 * scans; three groups of three to five is not. It lives on each section rather
 * than in a nested structure so the numbering stays one flat sequence and
 * reordering a step cannot leave it stranded in the wrong group.
 *
 * Every step is a `lead` and at most four `notes`. The lead alone has to be
 * enough: someone who reads that one line and nothing else must still be able
 * to do the step. The rule that shortened this most: never label a sentence
 * with a phrase that restates it. "Open it — Tap the exercise on Today" is one
 * fact written twice, and that doubling is what made a complete guide feel
 * like an exhausting one.
 */
export const GUIDE_INTRO = 'The first line of each step is enough. The rest is there if you want it.';

export const GUIDE_SECTIONS = [
  {
    id: 'google',
    phase: 'Set up once',
    title: 'Sign in with Google',
    lead: 'Profile → Sign in with Google. Optional, but do it now and nothing can ever be lost.',
    notes: [
      'Use the Gmail you already have on this phone.',
      'Google asks which account, then you tap Continue. That’s the whole thing.',
      'It only ever sees its own hidden folder, never the rest of your Drive.',
      '“Sync paused” just means tap Reconnect. Nothing is lost either way.',
    ],
  },
  {
    id: 'profile',
    phase: 'Set up once',
    title: 'Set up your profile',
    lead: 'Tap your circle, top right. Add a photo, your name, your height and your weight.',
    notes: [
      'Height and weight together give you BMI.',
      'The photo is shrunk to a small square first, so it never slows a backup.',
      'Your name is just the greeting on Today.',
      'Tap Save profile when you’re done.',
    ],
  },
  {
    id: 'data',
    phase: 'Set up once',
    title: 'Where your data lives',
    lead: 'On this phone. Drive is only the spare copy.',
    notes: [
      'Each Google account gets its own separate data. Nobody’s mixes.',
      'Progress → ⚙ → Export to move everything to another phone.',
      'On iPhone, Safari can clear it after about a week unused — signing in protects you.',
    ],
  },
  {
    id: 'add',
    phase: 'Build your plan',
    title: 'Add your first exercise',
    lead: 'Plan → Add. Name it, pick a category, then Save.',
    notes: [
      'The category picks the icon and shows on the card. Nothing else to choose.',
      'Count or Time. Count is reps, km, laps. Time gives it a clock instead of a keypad.',
      'Using a dumbbell? Add the weight. It’s a label, not a score.',
      'Edit it any time in Plan. Archive keeps its history, Delete doesn’t.',
    ],
  },
  {
    id: 'schedule',
    phase: 'Build your plan',
    title: 'Choose your days',
    lead: 'Every day, or tap just the days you train.',
    notes: [
      'A day you didn’t pick is never a missed day.',
      'Change the days later — past days keep theirs.',
      'Exercises on the same days get grouped together.',
    ],
  },
  {
    id: 'target',
    phase: 'Build your plan',
    title: 'Set a target, or don’t',
    lead: 'It’s the number Today counts down from. Optional.',
    notes: [
      'No target: still counted, just no streak.',
      'Beat it and the app raises it for you.',
      'Changes start today. Past days keep what they had.',
    ],
  },
  {
    id: 'onetime',
    phase: 'Build your plan',
    title: 'Log a one-off',
    lead: 'Plan → Add → One-time. For a hike, a swim, a game.',
    notes: [
      'It works exactly like any other exercise — same clock, same keypad, same target.',
      'It only appears today. Tomorrow it’s gone.',
      'It never counts against a streak, and never breaks one.',
    ],
  },
  {
    id: 'logging',
    phase: 'Every day',
    title: 'Log your reps',
    lead: 'Tap the exercise. Tap a number. That’s it.',
    notes: [
      'Wrong number? Flip to Subtract, or tap Undo.',
      'Did a number the pad hasn’t got? Exact set, under the total. It goes in as one set.',
      'The clock starts on your first rep. Pause any time.',
      'A Time exercise has no pad — tap Start, and it counts your minutes.',
    ],
  },
  {
    id: 'finish',
    phase: 'Every day',
    title: 'Finish the session',
    lead: 'Hit your target and choose: Take the win, or Keep going.',
    notes: [
      'No target? Tap Complete when you’re done — it banks the time the same way.',
      'Give up ends it early. Your reps still count, the time doesn’t.',
      'Reset clears the clock, never the reps.',
      'Finished? Share image opens your phone’s share sheet — Instagram, Messages, or save to Photos.',
      'Today and Progress show the time you finished, for today only.',
    ],
  },
  {
    id: 'streaks',
    phase: 'Every day',
    title: 'Rest without losing your streak',
    lead: 'Open the exercise → Take a break.',
    notes: [
      'Every exercise keeps its own streak.',
      'A scheduled day with nothing logged is what breaks one.',
      'Nothing you change later rewrites a day you logged.',
    ],
  },
  {
    id: 'weight',
    phase: 'Every day',
    title: 'Weigh in',
    lead: 'One weight a day, on the Today card.',
    notes: [
      'It never touches a streak.',
      'The chart plots weekly averages, not daily noise.',
      'Same number as yesterday still counts.',
    ],
  },
  {
    id: 'crew',
    phase: 'Every day',
    title: 'Train with a crew',
    lead: 'Social → Create a crew, then send the link to whoever you train with.',
    notes: [
      'They tap the link, sign in with their own Gmail, and they are in.',
      'Everyone sees names, streaks and totals — never your individual sets, weight or notes.',
      'Anyone with the link can join, so send it to people, not places.',
      'Tap someone to see their day: what they have lined up, and what they have done.',
      'Nudge someone who has not trained, or send Respect to someone who has. The crew sees it.',
      'Tap a crew photo to see their stories — pictures and a line, gone after 24 hours.',
      'The number on someone’s photo is how many you have not watched. It counts down as you go.',
      'The leader gives everyone a role and a class. Both show on your profile.',
      'Taking a rest day shows in your crew as a rest, not a miss — and nobody can nudge you for it.',
      'The crew name, its motto, your role and your class go on every image you share.',
      'Leave any time. Your card goes with you.',
    ],
  },
  {
    id: 'progress',
    phase: 'Every day',
    title: 'Watch it add up',
    lead: 'Progress → tap any group.',
    notes: [
      'Filled = hit. 🌙 = rest. Hollow = missed.',
      'Top set is one set. Max is a whole day.',
      'A Time exercise shows its longest and average session instead.',
      'Tap a number inside a card to correct it.',
    ],
  },
];
