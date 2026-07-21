/**
 * Opaque/branded primitive types — give domain strings (and numbers) a NOMINAL type so a value can only
 * be passed where that exact kind is expected. A plain `string` runId and a `string` flowName are
 * interchangeable to the compiler and get swapped by accident (both feed path helpers!); a branded
 * `RunId` vs `FlowName` cannot. This complements the "no free strings" rule (named constants for the
 * allowed *set*) with type safety for the *values* that travel.
 *
 * Pattern:
 * export type RunId = Brand<string, 'RunId'>;
 * export const asRunId = (s: string): RunId => s as RunId; // mint at a trusted/validated boundary
 * The brand is a phantom (erased at runtime) — `RunId` is just a string at runtime, free to serialize.
 * Mint ONLY after validation (e.g. behind a `(s): s is RunId` guard) so a branded value is also a valid
 * one. Zod-validated fields use `z.string.brand<'X'>` instead, so the schema is the single source.
 */

declare const brand: unique symbol;

/** A nominal wrapper: `T` tagged with brand `B`, assignable FROM nowhere except an explicit mint/cast. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * A flow name that has passed the path-segment guard.
 *
 * The doc above names this exact hazard — "a plain `string` runId and a `string` flowName are
 * interchangeable to the compiler and get swapped by accident (both feed path helpers!)" — and for a
 * long time only RunId was branded, so the pair the warning describes was half-fixed. `flowPath` and
 * `runPath` sit beside each other and take the same shape; the compiler could not tell them apart.
 */
export type FlowName = Brand<string, 'FlowName'>;

/**
 * A session id that has passed the path-segment guard. Joined straight into journal paths, so the same
 * argument applies. Mint ONLY through the validating guard, never with a bare cast.
 */
export type SessionId = Brand<string, 'SessionId'>;

/** Mint a FlowName — call ONLY behind isValidFlowName, or on a literal in a test. */
export const asFlowName = (value: string): FlowName => value as FlowName;
/** Mint a SessionId — call ONLY behind isValidSessionId, or on a literal in a test. */
export const asSessionId = (value: string): SessionId => value as SessionId;
