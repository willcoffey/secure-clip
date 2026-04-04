# Sat Apr  4 03:24:21 PM EDT 2026
Getting back into this repo after a while. I've been using the tool regularly 
effectively, but there are some changes to be made and bugs to fix. Also there
are aspects of the architecture I didn't learn since they are vibe coded, for 
example, the way cloudflare hibernates websockets. Need to read this so I 
understand the implications for billing etc.

- Vibe coded websocket wakeup is not relialbe. Need to look into lifecycle for
tabbed tabs as well as background progressive apps.

- I want to add an icon showing connectivity, but no great candidate for an 
icon on lucide.

- Need to read about the lifecycle of hibernation of websockets on cloudflare
workers.

## Issues Noticed

- event listeners added via connectedCallback aren't being cleaned up
- service worker is registered at same place as custom element is defined. I 
should add a `remote` or option to secure-clip for specifiy server, and allow it
to be embedded like any other custom element in a normal page.

## AI Bugs
- I had it write some retry error logic at some point, it did it in a really bad, blocking way, that
caused issues with waking up and reconnecting normally.
