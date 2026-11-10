/**
 * The house name lives here only. Scholé (Greek σχολή): "leisure devoted to learning",
 * the word every European language took "school" from.
 */
export const BRAND = Object.freeze({
  name: import.meta.env.VITE_APP_NAME || 'Scholé',
  letter: (import.meta.env.VITE_APP_MONOGRAM || 'S').slice(0, 1),
  tagline: 'The private academy, live.',
  etymology: 'σχολή — leisure devoted to learning; the root of “school”.',
});
