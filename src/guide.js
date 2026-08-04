/**
 * The whole guide, as data.
 *
 * One table, one source of truth. The Guide screen is the only thing that
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
    lead: 'Plan → Add. Name it, then Save.',
    notes: [
      'Unit is whatever you count — reps, minutes, km.',
      'Using a dumbbell? Add the weight. It’s a label, not a score.',
      'Tap it in Plan any time to change anything.',
      'Archive keeps its history. Delete doesn’t.',
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
      'No schedule and no target. Add as you go, then Complete.',
      'Finished ones live in Progress, under One time.',
    ],
  },
  {
    id: 'logging',
    phase: 'Every day',
    title: 'Log your reps',
    lead: 'Tap the exercise. Tap a number. That’s it.',
    notes: [
      'Wrong number? Flip to Subtract, or tap Undo.',
      'Tap the big total to type an exact one.',
      'The clock starts on your first rep. Pause any time.',
    ],
  },
  {
    id: 'finish',
    phase: 'Every day',
    title: 'Finish the session',
    lead: 'Hit your target and choose: Take the win, or Keep going.',
    notes: [
      'Give up ends it early. Your reps still count.',
      'Reset clears the clock, never the reps.',
      'Finished exercises drop to a quiet line at the bottom.',
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
    id: 'progress',
    phase: 'Every day',
    title: 'Watch it add up',
    lead: 'Progress → tap any group.',
    notes: [
      'Filled = hit. 🌙 = rest. Hollow = missed.',
      'Top set is one set. Max is a whole day.',
      'Tap a number inside a card to correct it.',
    ],
  },
];
