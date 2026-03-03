# Major Tasks

## Security review
    - local storage "sc" = secure context?

## ID's should also be encrypted?
 - Comes down to if you want users to know if there is data there. visually I like the plaintext 
conversion of a bad password as gobbldygook. But this implies that you can check if a secret exists
for an id. if id "fuck-ice" has an element for example. 

 - if you are encrypting the id, then changing the password changes the storage location. i.e. new
db entry

 - really, then, you should just have a long password. password works as both the identifier and
the encryption key. 

server stores

SHA256(PBKDF2(password)) : AES(PBKDF2(password))

## Debug socket issue
Websockets quitely get removed from subscribers on backend after a few seconds. Client socket does
not disconnect but does not get subscribed messages. Cloudflare has websocket hibernation, related?
I also saw a demo chat app cloudlfare created for durable objects. worth reviewing.

## Special behaviour for certain id's
- system-stats : Fetches stats from server
- system-help : Displays help documentation in text area
- a terry pratchet reference : The password is swordfish
- cypherpunk / cypherpunk 

## Banner for status?
connection status updates routed through stdin?


## Resolve zoom issue
Cannot zoom on mobile at all, but, don't want automatic zooming to text inputs
