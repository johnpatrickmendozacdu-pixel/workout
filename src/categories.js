/**
 * The exercise categories, and the only place their artwork is named.
 *
 * A category carries the icon rather than the exercise storing one: picking
 * "Chest" is one decision that answers both "what is this" and "what does it
 * look like", instead of two decisions that can disagree. It also means the
 * icons can be redrawn — see tools/slice-icons.py — without touching a single
 * saved exercise, because what is stored is the word, never the picture.
 *
 * Files live in public/ and are referenced through BASE_URL, since the app is
 * served from a subpath on Pages and an absolute /icons/... would 404 there.
 */
export const CATEGORIES = [
  { key: 'chest', label: 'Chest' },
  { key: 'back', label: 'Back' },
  { key: 'arms', label: 'Arms' },
  { key: 'legs', label: 'Legs' },
  { key: 'abs', label: 'Abs' },
  { key: 'dip-bar', label: 'Dip bar' },
  { key: 'pull-up-bar', label: 'Pull-up bar' },
  { key: 'cardio', label: 'Cardio' },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

/** The category record, or null for an exercise saved before categories existed. */
export function categoryOf(exercise) {
  return (exercise && BY_KEY.get(exercise.category)) || null;
}

export function categoryLabel(exercise) {
  const c = categoryOf(exercise);
  return c ? c.label : '';
}

export function categoryIconUrl(key) {
  return BY_KEY.has(key) ? `${import.meta.env.BASE_URL}icons/ex/${key}.png` : '';
}
