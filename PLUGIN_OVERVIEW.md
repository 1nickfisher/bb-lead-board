The factory lead keeps a board of what it needs from you. This panel shows that
board beside the lead thread, so you stop scrolling for decisions.

## What you get

- A home page with links to each project, today's numbers (merged,
  released, reviews, workers running, waiting on you) and a progress gauge
  for each launch.
- **Needs you now:** each decision with its context, its age, its links, one
  button per option, the lead's recommendation starred with a one-line
  reason, and an Explain button.
- **Recent** activity with sort options and a project filter, and a
  done-today strip.
- **Reply** on every card and activity row: type or dictate, edit, then send
  it as your own message, with a reference to the card.
- A view per project: its decisions, launch gates, work in flight, coming-up
  items and activity.
- "checked N min ago · last change M min ago", and a warning only when the
  feed has not checked the board for over 10 minutes.

## How it works

The panel reads `board.json` from the factory control host through bb's file
API every 20 seconds. Tapping an option posts its exact phrase to the lead
thread as your own message, the same as typing it. Production, security and
money decisions ask you to confirm first. The panel never approves anything by
itself: the lead still reads production approvals back to you in the thread.

Optional voice controls (off by default) read the board or one card aloud,
in bb-voice's voice when the board host has it, and let you dictate a note or
a reply. You always see and confirm a voice note before it is sent.
