# TODO Before Publish
 - readme rewrite
 - .vimrc and skill docs
 - docker deploy w/ workerd
 - rate / size limits
 - example domain, heavily limited
 - CI
 - error paths
 - SECURITY.md (vuln report)


---

# Summary
`seclip` is a simple, self-hostable, end-to-end encrypted clipboard utility
designed to make it easy to sync text between contexts without any accounts. It
arose from the annoyance of clipboard management across SSH hosts but has many
more use cases. Copying text to phone from terminal, having claude send reports
for viewing on phone or browser. Sharing text over sandbox boundaries. etc etc.

Features
 - End-to-End encrypted
 - Socket subscription for changes
 - Markdown Rendering
 - Phone / Web Browser and terminal interface
 - `.vimrc` functions and `SKILL.md`
 - QR Code sharing of secret keys

# Deploying on Cloudflare Workers
Assumes you have a Cloudflare account. Deploy to a random subdomain on your
worker account. Make sure to replace `<account>` with your `workers.dev` 
subdomain.

```sh
git clone https://github.com/willcoffey/secure-clip.git && cd secure-clip
npm install
npx wrangler login

id=$(openssl rand 20 | base32 | tr A-Z a-z)
path=$(openssl rand 20 | base32 | tr A-Z a-z)
echo "SECLIP_SERVER_ID=$id"     >  .env
echo "SECLIP_SERVER_PATH=$path" >> .env
npm run deploy

salt=$(openssl rand 20 | base32 | tr A-Z a-z)
echo "export SECLIP_HOST=https://$id.<account>.workers.dev/$path#s=$salt" > client.env
```

Test it
```sh
npm install -g seclip
source client.env
export SECLIP_PASSPHRASE=$(seclip dice)
echo "Hello" | seclip set
seclip get
# print the url with passphrase encoded into the terminal
seclip url --with-passphrase

# Output a qr code to scan with your phone
seclip qr --with-passphrase
```

# Self-Hosting with Docker
A simple docker setup to get this up and running on your own machine.

Clone the repo and setup the `env` vars.
```sh

git clone https://github.com/willcoffey/secure-clip.git && cd secure-clip

# Initialize the .env files to random values. Or do manually by looking at the
# .env.example and client.env.example files
path=$(openssl rand 20 | base32 | tr A-Z a-z)
echo "SECLIP_SERVER_ID="          >  .env
echo "SECLIP_SERVER_PATH=$path"   >> .env

salt=$(openssl rand 20 | base32 | tr A-Z a-z)
echo "export SECLIP_HOST=http://localhost:3000/$path#s=$salt" > client.env
```

Build the Docker image and start it running in the background
```sh
docker compose up -d 
```

Install the command line utility
```sh
source client.env
npm install -g seclip
```

Test the CLI and get the URL with passphrase encoded. `localhost` will only work
from this device.
```sh
export SECLIP_PASSPHRASE=$(seclip dice)
echo "Hello" | seclip set
seclip get
seclip url --with-passphrase
```

SSL setup and domain management left as an exercise to the reader. I would
suggest adding Caddy + Cloudlfare DNS or Cloudflare tunnels.

# Additional Setup
## SKILL.md
## .vimrc

# Usage
For additional help, see `seclip -h` and the `?` button in the web app. This is
simply a list of common use cases. None of these are novel, but due to it's 
simplicity seclip tends to be faster than other options.

 - During an ongoing Claude work, ask it to `send a report to seclip in md 
    format`, then walk away and check phone.
 - When using a sandboxed agent, ask it to send details to seclip, the `vv` in
    vim where you want them.
 - Past something in web app, tell claude to read it, reformat it, and send it 
    back
 - pipe error messages or logs to seclip, with `ls /missing 2>&1 | seclip set`
 - Use it to share data between Claude code and the Claude web app
 - SSH into a server and share a clipboard with phone via qr code


# Development
## Setup
```
git clone https://github.com/willcoffey/secure-clip.git && cd secure-clip
npm install
```
Then, there are 3 scripts I will have running during development:
 - `npm run check` To watch for changes while typechecking front/backend.
 - `npm run build` Watch for changes and rebuild assets
 - `npm run worker` Run the cloudflare worker locally, which hosts the static assets and API.
