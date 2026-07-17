# Customer Simulator Backend Review

Review status: complete for the current implementation; authenticated Preview verification remains an external release gate.

## Scope

Reviewed the simulator migration, authenticated service routes, persistence adapter, customer and workflow LLM wiring, inbound processor, outbound runtime, and automated tests after the prompt-anchoring fix.

## Findings

- Workspace isolation is enforced at the service boundary before simulator reads and writes. Simulator rows also carry a composite workspace/conversation foreign key.
- Simulator conversations use the distinct `simulator` provider/channel. The outbound worker skips simulator jobs before the WhatsApp client dispatch path, and the isolation is covered by a runtime test.
- Start and next-turn routes require an authenticated manager/operator workspace member. The simulator itself enforces running status, maximum turns, stop/completed states, and pauses safely when the customer provider is unavailable.
- Inbound simulator events use deterministic event/message identifiers, so retries are idempotent. Existing simulator tasks are reprocessed with stored conversation history and the real workflow LLM adapter.
- Concurrent next-turn requests are serialized per simulation within a server process. Multi-instance correctness still depends on the deployment topology and should remain an operational follow-up if simulations become high-volume.
- Both the customer simulator and the operations workflow use server-side structured Responses API calls with `store: false`. API keys are read only by server configuration and are not included in browser configuration.
- The Preview UI now passes the selected conversation’s latest customer message into the simulator scenario and the customer prompt explicitly forbids unrelated intent drift. This preserves dynamic LLM behavior while keeping the demo tied to the selected request.

## Automated evidence

- `npm test`: 41 tests passed.
- `npm run build`: passed.
- `npm run test:e2e`: 5 tests passed, including mobile navigation.
- `git diff --check`: passed.
- Simulator-specific tests cover structured generation, prompt anchoring, bounds, provider failure, concurrency, reprocessing, simulator-only sends, and workspace-authorized lifecycle routes.

## Release blockers still open

- Authenticated Preview verification confirmed a real customer LLM turn, workflow reprocessing, and the slot-selection approval guard. The latest run still needs a clean operator approval/send and subsequent customer-turn pass.
- Verify the resulting outbound row is tagged `simulator` and has terminal `sent` status; the existing staging row remains `queued`, so this gate is not yet closed.
- Run `npm run verify:staging` with the staging service-role key supplied directly; Vercel cannot export that write-only secret through `vercel env pull`.
- Record the authenticated staging evidence in `SIMULATOR_ACCEPTANCE.md` before release approval.
