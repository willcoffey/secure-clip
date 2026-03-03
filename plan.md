# backend/index.ts

The websocket message sent to a subscriber or as the result of a load message
shout be the same. the message should be a 'set-ciphertext' with a body of an
encrypted data

# database schema update
the database schema needs to be updated to include
last_accessed as a time, indexed so that it can be loaded in order

# update system-stats
should return toal size in kb
should include last accessed time as unix timestamp
should be ordered with most recent at the top

index.ts should attach stats
number of websocket connections
number of id handlers

ensure that list of boards is last thing written
