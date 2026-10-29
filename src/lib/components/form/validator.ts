import type { RemoteForm } from '$app/server';

/** Revalidation policy for `Form.Root`: client-only (preflight) checks, except for exactly one
 * server check after each real submit.
 *
 * Why the one server check: a server-issued issue can only ever be cleared by asking the server
 * again, a client-only recheck keeps it. (`validate_only` requests run just the schema, never
 * the handler, so this can clear an `invalid()` from the handler but can't re-raise it; only
 * the next real submit can.)
 *
 * Why the in-flight gate: `remoteFunction.validate()` drops the response of any call superseded
 * by a newer one, so a client-only check from the next keystroke would silently discard the
 * server check's result and leave the stale issue on screen. While it's in flight, further
 * calls wait on it and a single client check runs once it lands. */
// oxlint-disable-next-line typescript/no-explicit-any
export function createValidator(remoteFunction: () => RemoteForm<any, any>) {
	let recheckPending = false;
	let inflight: Promise<void> | undefined;
	let rerun = false;

	const validateClient = () => remoteFunction().validate({ all: true, preflightOnly: true });

	function validate(): Promise<void> {
		if (inflight) {
			rerun = true;
			return inflight;
		}
		if (!recheckPending) return validateClient();

		recheckPending = false;
		inflight = remoteFunction()
			.validate({ all: true, preflightOnly: false })
			.finally(() => {
				inflight = undefined;
			})
			.then(() => {
				if (!rerun) return;
				rerun = false;
				return validate();
			});
		return inflight;
	}

	return {
		validate,
		/** Call from the `enhance` callback: it only runs once preflight passes, i.e. when a
		 * submit actually reaches the server (unlike `remoteFunction.submitted`, which also
		 * flips on Submit clicks that preflight blocks). */
		markServerSubmitted() {
			recheckPending = true;
		}
	};
}
