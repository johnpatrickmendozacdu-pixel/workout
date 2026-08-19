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

const supported = () => !still() && !!document.startViewTransition;

let inside = false;

/**
 * True only while a transition is actually mid-swap.
 *
 * renderView asks before adding its staggered entrance, because with the
 * screen already moving the cards would rise inside it — two animations over
 * the same pixels, which reads as a stutter rather than as more polish.
 *
 * It answers "is one running now", NOT "could one run": the stagger is still
 * wanted on the first paint of the app, where nothing is transitioning and the
 * screen would otherwise simply appear.
 */
export const running = () => inside;

let animating = false;

/**
 * One transition at a time, and an interrupted tap simply does not get one.
 *
 * The first attempt at this called skipTransition() on the running transition
 * so the newest tap could start its own. That is where the failures came from:
 * aborting a transition rejects promises nobody is awaiting, and ten of those
 * InvalidStateErrors landed in the console from a walk through the tabs. It was
 * also the wrong behaviour to buy — a fast walk through five tabs animated five
 * times, each one cutting off the last, which is exactly the stutter that got
 * filmed.
 *
 * So there is no refereeing. A tap that arrives mid-animation changes the
 * screen instantly and asks for nothing, which is both what a hurried tap wants
 * and the only version that cannot fail: no abort, no rejection, no queue.
 */
export function withTransition(apply) {
  if (!supported() || animating) { apply(); return; }

  animating = true;
  const t = document.startViewTransition(() => {
    inside = true;
    try { apply(); } finally { inside = false; }
  });

  // The gate reopens when the animation is genuinely over. `finished` settles
  // either way; the catch is here because a transition can still be dropped by
  // the browser itself — a hidden tab, a navigation — and that is not an error
  // worth raising when the screen it carried has already changed.
  const done = () => { animating = false; };
  if (t.finished && t.finished.then) t.finished.then(done, done);
  else done();
}
