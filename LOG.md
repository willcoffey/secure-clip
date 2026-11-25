# Wed Nov 25 2026
Notes on rate limiting

Simple request rate limiting won't work, since sockets can be abused. At first
pass it doesn't look like something I can do purely from cloudflare config. It
will require some code in the backend. Want to evaluate existing solutions 
before proceeding.

Going to work on getting the node package setup and swap my deno install. make
sure it works.
