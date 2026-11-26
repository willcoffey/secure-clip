
- The server is responsible for distributing the salt? why not bake into client
at build time?
    - salt is a public value, every client needs it. I want anonymous clients.
    - salt is doubling as a document id, it should be as safe as a google doc
      shared via link at minimum.
    - salt as url fragment?

---

I need to add
 - Server knows salt, rejects any client that doesn't know it.
 - Salt is shared via in person qrcode with url, using url fragment, optionally
   includes passphrase.
 - Salt still parsed from URL for CLI, following fragement pattern. deploy 
   subdomain becomes just a random value, or chosen name. 

The server doesn't need to know the salt

The client does

Since the server hosts the client, it knows it. But the model should support
other ways the client gets the salt.

So, server can't filter good and bad clients, 

Not sure how much I like this, overloading the salt with secrecy. maybe a better
name?

- subdomains are worse than url paths do to additional dns interaction

---

maybe a split

uri is
`example.com/server_secret`
share is 
`example.com/server_secret#salt`

where server secret is like a share by id google doc, where the id represents
the entire clipboard service. It gets shared by a URL fragment. 

 1. It doesn't really add security, it just makes it less likely a rando can
    DOS you.
 2. It makes sharing clumsier, but can still be done in a single step. I.e. 
    longer url.
 3. Still need to distribute the salt, and server doesn't need to know it. Not
    knowing doesn't add much security either.

These are more abuse prevention than security.
