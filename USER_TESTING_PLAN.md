# User Testing Plan: Missing-Information Reply Demo

## Purpose

Validate the primary TrialFlow demo path using Wei Jun. The walkthrough should make the product’s usefulness clear: it identifies the customer’s intent, explains what information is missing, prepares a focused reply, and lets an operator send that reply from one workflow.

The flow ends when the approved reply appears as an outbound message in the conversation.

## Setup

- Run the local console with the seeded fixtures loaded.
- Open the Inbox at the local Vite URL.
- Use the default operator workspace; no manual field editing is required.
- Start with Wei Jun’s conversation selected, or select Wei Jun from the Inbox before beginning.

## Primary happy path

| Step | Operator action | What to point out | Pass condition |
| --- | --- | --- | --- |
| 1. Select the conversation | Select **Wei Jun** in the Inbox. | The console keeps the customer message, workflow state, and AI task summary together. | Wei Jun’s inbound message is visible in the chat. |
| 2. Review intent | Look at the **AI task summary**. | TrialFlow identifies the request as a **Trial inquiry** and shows its confidence and decision explanation. | The intent and confidence are visible without opening another screen. |
| 3. Review missing fields | Inspect **Extracted information**. | The system marks the child’s age, location, and preferred timing as **Not provided** and explains that these fields are required before matching slots. | Missing fields are clearly distinguishable from extracted fields. |
| 4. Review the draft | Read the **Draft reply** section. | The draft asks specifically for the missing information instead of inventing availability. | The draft is targeted to the missing fields and no fabricated slots are shown. |
| 5. Approve the draft | Click **Approve draft**. | The operator remains in control before anything is sent. | The draft status changes to **Approved**. |
| 6. Send the reply | Click **Send reply** in the messaging composer. | The approved response can be sent directly from the conversation view. | The send action is enabled only after approval and completes without an error. |
| 7. Verify the result | Look at the chat and activity log. | The customer-facing result is visible, and the system records what happened. | The approved draft appears as an outbound message bubble, with matching text, and the activity log records **Reply sent to customer**. |

## Suggested narration

“Wei Jun has asked about a trial class, but the message does not contain enough information to safely recommend a slot. TrialFlow identifies the intent, shows exactly which fields are missing, and drafts the follow-up for the operator. I can review and approve it before sending. Once sent, the same reply appears in the conversation and the activity log records the action.”

## Acceptance criteria

- The operator completes the flow without manually editing extracted fields.
- The intent is visibly identified as a trial inquiry.
- The missing child age, location, and timing fields are visible.
- The draft directly asks for the missing information.
- No availability or slot is fabricated while required fields are missing.
- Sending is blocked before the draft is approved.
- The sent message text exactly matches the approved draft.
- The outbound message is visible in the chat as a sent message.
- The activity log records the reply-sent event.
- A viewer can understand the value of the workflow without additional explanation.

## Evidence checklist

- [ ] Wei Jun is selected and the inbound message is visible.
- [ ] The intent, confidence, and decision explanation are visible.
- [ ] Missing fields are visibly marked.
- [ ] The targeted draft is visible before approval.
- [ ] The draft shows **Approved** after approval.
- [ ] The sent outbound message is visible in the chat.
- [ ] The activity log shows **Reply sent to customer**.
- [ ] No unrelated fixture or failure path interrupts the recording.

## Optional extended scenario

After completing the primary demo, select Maya Tan to show the booking path: offer matching slots, select a slot, approve the draft, confirm the booking, and send the confirmation reply.

## Implementation note

The local demo currently uses deterministic workflow logic and seeded fixtures to reproduce the AI-assisted behavior. Describe the result as AI-assisted in the local recording unless a live LLM-backed environment has been separately verified.
