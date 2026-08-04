/**
 * The whole guide, as data.
 *
 * One table, one source of truth. The Guide screen is the only thing that
 * renders it, and a new feature means a new row here rather than a new
 * explanation written somewhere else that quietly stops being true. Anything
 * needing a re-record or a re-screenshot when the UI changes does not belong
 * in a guide — words describing what the app does survive a restyle.
 *
 * The order is the order you do things in, not a tidy filing of topics.
 *
 * Every step is a `lead` and at most four `notes`. The lead alone has to be
 * enough: someone who reads that one line and nothing else must still be able
 * to do the step. The notes are for the person who wants them, and anything
 * that cannot earn its place inside four short lines is not a note, it is a
 * paragraph — and a paragraph in a guide is a paragraph nobody reads.
 *
 * The rule that shortened this the most: never label a sentence with a phrase
 * that restates it. "Open it — Tap the exercise on Today" is two ways of
 * saying one thing, and doubling the words is what made a complete guide feel
 * like an exhausting one.
 */
export const GUIDE_INTRO = 'In the order you’ll do it. The first line of each step is enough — the rest is there if you want it.';

export const GUIDE_SECTIONS = [
  {
    id: 'add',
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
    title: 'Set a target, or don’t',
    lead: 'It’s the number Today counts down from. Optional.',
    notes: [
      'No target: still counted, just no streak.',
      'Beat it and the app raises it for you.',
      'Changes start today. Past days keep what they had.',
    ],
  },
  {
    id: 'logging',
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
    title: 'Rest without losing your streak',
    lead: 'Open the exercise → Take a break.',
    notes: [
      'Every exercise keeps its own streak.',
      'A scheduled day with nothing logged is what breaks one.',
      'Nothing you change later rewrites a day you logged.',
    ],
  },
  {
    id: 'progress',
    title: 'Watch it add up',
    lead: 'Progress → tap any group.',
    notes: [
      'Filled = hit. 🌙 = rest. Hollow = missed.',
      'Top set is one set. Max is a whole day.',
      'Tap a number inside a card to correct it.',
    ],
  },
  {
    id: 'weight',
    title: 'Weigh in',
    lead: 'One weight a day, on the Today card.',
    notes: [
      'It never touches a streak.',
      'The chart plots weekly averages, not daily noise.',
      'Same number as yesterday still counts.',
    ],
  },
  {
    id: 'onetime',
    title: 'Log a one-off',
    lead: 'Plan → Add → One-time. For a hike, a swim, a game.',
    notes: [
      'No schedule and no target. Add as you go, then Complete.',
      'Finished ones live in Progress, under One time.',
    ],
  },
  {
    id: 'profile',
    title: 'Set up your profile',
    lead: 'Tap your circle, top right.',
    notes: [
      'Photo, name, height, weight — then Save profile.',
      'Height is only used for BMI.',
    ],
  },
  {
    id: 'google',
    title: 'Back it up with Google',
    lead: 'Profile → Sign in with Google. Optional, and free.',
    notes: [
      'Google asks which account, then you tap Continue.',
      'It only ever sees its own hidden folder — nothing else in your Drive.',
      '“Sync paused” just means tap Reconnect. Nothing is lost.',
      'Without it the app still works completely, online or off.',
    ],
  },
  {
    id: 'data',
    title: 'Where your data lives',
    lead: 'On this phone. Drive is only the spare copy.',
    notes: [
      'Each Google account gets its own separate data.',
      'Progress → ⚙ → Export to move to another phone.',
      'On iPhone, Safari can clear it after about a week unused — signing in protects you.',
    ],
  },
];
