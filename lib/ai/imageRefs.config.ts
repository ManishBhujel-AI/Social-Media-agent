/**
 * Max reference images gemini-3.1-flash-image accepts in one request.
 * Updated by `npm run test:image` part (c). Default: 4 (product + extras + logo headroom).
 */
export const MAX_IMAGE_REFS = 4;

/** Max reference images a user can attach to graphic feedback. */
export const MAX_FEEDBACK_REFERENCE_IMAGES = 3;

/** Max product photos on the per-post image request card (one ref slot reserved for logo). */
export const MAX_POST_SOURCE_IMAGES = MAX_IMAGE_REFS - 1;
