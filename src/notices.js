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
];
