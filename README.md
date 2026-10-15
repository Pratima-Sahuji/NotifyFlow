NotifyFlow: 
Here is the straightforward breakdown of what NotifyFlow is, how it works under the hood, and the actual production code that was built for you.

1. What is NotifyFlow and Why Did We Build It?
In your original Kheto app, notifications were handled by direct Supabase database triggers and edge functions. While that worked for a basic prototype, it had severe real-world problems:

If an Edge function timed out or hit a rate limit, the notification was permanently lost.
There was no retry queue or exponential backoff.
If a rider clicked "Send SOS" three times on a spotty network, three duplicate alerts were created.
There was no real WebSocket backend server (Kheto only had frontend client code that tried to connect to an external mock).
NotifyFlow solves all of this. It is a standalone, enterprise-grade notification backend that guarantees:

Zero Lost Notifications: Even if Redis or your worker crashes, every event is safely locked in PostgreSQL first (Transactional Outbox Pattern).
Instant Realtime Delivery: Connected phones and web browsers get immediate delivery via persistent WebSockets.
Reliable Push Notifications: Mobile devices get high-priority push alerts via FCM HTTP v1 with automatic pruning of uninstalled/dead tokens.
No Duplicate Alerts: An Idempotency layer hashes incoming requests and prevents double-sends.
Respects User Preferences: Silences non-urgent notifications during quiet hours (e.g. 10 PM – 7 AM), but lets urgent SOS alerts punch through.
2. The Complete Pipeline (How a Message Travels)
Here is what happens when someone creates an event (like an SOS alert or ride announcement):

Client sends HTTP POST /api/v1/events with a JWT token and an optional Idempotency-Key.
Validation & Idempotency Check:
NotifyFlow checks if this exact request was already processed. If yes, it immediately returns the cached result without doing double work.
Atomic PostgreSQL Transaction:
The event is saved in the events table.
Individual inbox notifications are created for each recipient in the notifications table.
The job payload is written to the outbox table.
Everything commits together. If the database goes down, nothing is half-written.
Dispatch to BullMQ Queue:
If Redis is healthy, the job is pushed directly into the BullMQ queue with its priority (urgent = 1, important = 2, normal = 3, low = 4).
If Redis is temporarily down, the event safely waits in the PostgreSQL outbox table. As soon as Redis comes back, the Outbox Relayer picks it up using FOR UPDATE SKIP LOCKED.
Worker Processing:
The BullMQ worker checks the recipient's notification preferences and quiet hours.
It fires the message to WebSockets (for any live connected screens/phones).
It fires the message to FCM (for background mobile push).
Self-Healing & Status Recording:
If FCM says a device token is expired/uninstalled (UNREGISTERED), NotifyFlow automatically disables that token in the database so you never waste API calls on dead tokens again.
If FCM returns a 429 rate limit or 503 error, BullMQ automatically retries with exponential backoff (2s -> 4s -> 8s -> 16s -> 32s).

