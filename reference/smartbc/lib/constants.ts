/**
 * Decorative gradient used as a placeholder for property/visit photos
 * until real images come from the backend (Supabase Storage).
 */
export const PLACEHOLDER_GRADIENT =
  "linear-gradient(135deg,#d9c8a3 0%,#b89e6e 50%,#8a724a 100%)";

/**
 * Variants of the placeholder gradient — useful in galleries where each
 * tile should look slightly different so it doesn't look obvious that
 * we're missing real photos.
 */
export const PLACEHOLDER_GRADIENTS = [
  PLACEHOLDER_GRADIENT,
  "linear-gradient(135deg,#e8dcc0 0%,#c2a572 50%,#9a7d4d 100%)",
  "linear-gradient(135deg,#cdb88a 0%,#a88a52 50%,#7d6037 100%)",
  "linear-gradient(135deg,#dbc9a6 0%,#b09167 50%,#7d5e36 100%)",
];

/**
 * Tailwind class used by the "luxury card" surface throughout the app.
 * Use via the <Card /> primitive or, for one-off needs, via cn(LUXURY_CARD_CLASS, ...).
 */
export const LUXURY_CARD_CLASS =
  "rounded-2xl border border-gold/15 bg-cream-50/85 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm";
