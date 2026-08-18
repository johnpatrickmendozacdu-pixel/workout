/**
 * The screen change, and nothing else.
 *
 * `document.startViewTransition` hands the browser the old and new screens as
 * snapshots and lets it animate between them on the compositor. There is no
 * library here and no per-frame JavaScript: the choreography is two rules in
 * style.css and this file only decides whether the browser is asked at all.
 *
 * It is optional by construction. On a browser without the API the callback
 * still runs, exactly once, so the screen changes the way it always did — a
 * browser that cannot animate the swap is not a browser that cannot swap.
 *
 * Reduced motion is refused HERE rather than in CSS, and that is the whole
 * reason this file exists: a view transition animates snapshot pseudo-elements
 * that no `prefers-reduced-motion` rule can select, so the only place to
 * decline is before asking.
 */

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function withTransition(apply) {
  if (still() || !document.startViewTransition) { apply(); return; }
  document.startViewTransition(apply);
}
