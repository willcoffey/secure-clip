# Lower Edit Latency

Blocked — per-keystroke sends require key caching to be
viable. PBKDF2 at 650k iterations per send is too expensive
to run on every keystroke. Revisit after crypto pipeline
is refactored.
