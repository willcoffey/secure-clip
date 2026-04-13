# Notes on security model and limitations

- Functions as an encryption oracle, IV collision = bad bad bad, web crypto doesn't support 
AES-GCM-SIV / RFC 8452 which mitigates nonce collison. Need to do the math.

- passphrase stored in local storage, no fix, necessary tradeof when supporting easy sharing of 
passphrase via QR codes.

- Server could always push a malicious client. Self hosting addresses to some extent, but if the 
security model is untrusted server code then some means of ensuring client version is needed.

- cryptoCache keeps derived key cached until memory is reloaded. should update
