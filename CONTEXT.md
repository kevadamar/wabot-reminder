# WhatsApp To-Do Reminder Bot

A lightweight WhatsApp bot using Baileys and Bun to capture tasks, schedule timely reminders, and celebrate completions with positive affirmations.

## Language

**Task**:
A discrete action item to be completed by the user, extracted from direct chat messages or forwarded text.
_Avoid_: Todo, job, ticket, item

**Deadline**:
The target date and time by which a task must be completed.
_Avoid_: Due date, target time, expiry

**Reminder Time**:
The exact timestamp (`remind_at`) when the bot triggers a proactive alert for a task.
_Avoid_: Alarm time, trigger time

**Task Status**:
The lifecycle state of a task in the database.
- `pending_deadline`: Task recorded but awaiting deadline specification from user.
- `pending`: Active task with an established deadline awaiting completion.
- `pending_confirmation`: New task whose deadline falls in the same minute as another active task of the user; held (never reminded) until the user confirms, picks another time, or cancels.
- `pending_risk_confirmation`: New task (text or media) that looks like online gambling (judol), a scam, a phishing link, or a malicious APK; held (never reminded) until the user confirms it is safe or cancels it. See **Risk Alert**.

**Risk Alert**:
A casual warning sent when task input looks harmful to the user. Detection is a local rule layer plus an LLM verdict; the LLM can only add a flag, never clear one. It asks for confirmation instead of blocking.
_Avoid_: Spam filter, content moderation

**Link Check**:
Optional background review of links in a message, sent as a follow-up after the normal reply. The **Link Inspector** service opens each link in an isolated browser; local page rules, Google Safe Browsing, and the LLM judge the result. A dangerous link raises a **Risk Alert** and moves the task to `pending_risk_confirmation`.
_Avoid_: URL scan, link preview
- `resolved`: Completed task marked by the user via checkmark emoji or command.
- `cancelled`: Task terminated by user before completion.
_Avoid_: State, stage

**Affirmation**:
A positive, encouraging message generated to praise the user immediately upon resolving a task.
_Avoid_: Reward, congratulation, quote

**Allowed User**:
A designated WhatsApp phone number/JID permitted to interact with the bot.
_Avoid_: Member, subscriber, client

**User Settings**:
Per-user preferences stored in the database determining timezone, notification lead time, and permissions.
_Avoid_: Config, flags, profile

**Command**:
An explicit text instruction sent by the user (e.g., `/list`, `/help`, `/selesai <id>`, `/batal <id>`).
_Avoid_: Action, trigger
