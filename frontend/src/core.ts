// Debug logging
const DEBUG = false;
const SALT = "CDVY91c4f1n+j5M8CeJjDg==";

// Uint8Array indexed by char code — direct array lookup, no hashing
//deno-fmt-ignore
const B64_REVERSE = new Uint8Array(128);
"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  .split("").forEach((c, i) => { B64_REVERSE[c.charCodeAt(0)] = i; });

/**
 * API is transport agnostic, but sockets are needed for the server to send updates to client
 */
type Transport = "post" | "socket";

/**
 * API surface for SecureClip, which abstracts out the network and crypto logic
 *
 * sending these triggers network actions e.g. set-passphrase -> query for that id
 */
export type Message =
  | { command: "set-passphrase"; body: string }
  | { command: "set-plaintext"; body: string }
  | { command: "set-ciphertext"; body: Encrypted | null }
  | { command: "connect" }
  | { command: "disconnect" };

// Encrypted value stored on server, id is SHA256(PBKDF2(passphrase, salt))
export interface Encrypted {
  iv: string;
  ciphertext: string;
}

export interface State {
  passphrase: string;
  plaintext: string;
  encrypted: Encrypted | false;
  connected: boolean;
}

export interface SecureClipOptions {
  host: string;
  ssl?: boolean;
  transport?: "socket" | "post";
}

/**
 * Client for backend, manages internal state, connection etc needed to
 * communicate with server.
 */
export class SecureClip {
  state: State;
  /** Render hook used for web component, called when state changes, including connection status  */
  render: (command: string) => void = console.log;

  private options: Required<SecureClipOptions>;
  private socket: Promise<WebSocket> | false = false;
  /** Cache the PBKDF2 operations since they are expensive */
  private cryptoCache: Record<string, { id: string; key: string }> = {};

  constructor(options: SecureClipOptions, passphrase: string) {
    this.options = {
      host: options.host,
      ssl: options.ssl ?? true,
      transport: options.transport ?? "post",
    };

    this.state = {
      passphrase: passphrase,
      plaintext: "",
      encrypted: false,
      connected: false,
    };
  }

  /**
   * stdin serves as the public interface for this class. Anything using this
   * class should only submit commands through stdin, no direct method calling.
   * messages from the server are also processed here.
   *
   * messages trigger different behaviours.
   *
   * set-plaintext = encrypt plaintext, send update to server
   * set-passphrase = derive key & id, send load request
   * set-ciphertext = decrypt ciphertext, set plaintext for user to see
   *
   * set-ciphertext is generally only going to be called via message handling
   * a response / socket message. could in theory be used via readfile
   */
  async stdin(message: Message) {
    debugLog("STDIN", message);
    const { transport } = this.options;

    switch (message.command) {
      case "set-passphrase": {
        const current = await this.deriveKeyAndId(this.state.passphrase);
        const { id } = await this.deriveKeyAndId(message.body);
        if (transport === "socket") {
          this.send("unsubscribe", { id: current.id });
          this.send("subscribe", { id });
        }
        this.state.passphrase = message.body;
        this.state.plaintext = "";
        this.state.encrypted = false;
        this.send("load", { id });
        break;
      }
      case "set-plaintext": {
        const { id, key } = await this.deriveKeyAndId(this.state.passphrase);
        /**
         * Called when the user updates the plaintext input. encrypts the text
         * and submits it to the server
         */
        this.state.plaintext = message.body;
        const encrypted = await Crypt.encryptGCM(message.body, key);
        this.state.encrypted = encrypted;
        this.send("update", { id, ciphertext: encrypted });
        break;
      }
      case "set-ciphertext": {
        /** Server will send message via post response or websocket triggering this */
        const { key } = await this.deriveKeyAndId(this.state.passphrase);
        if (message.body?.ciphertext) {
          this.state.encrypted = message.body;
          const plaintext = await Crypt.decryptGCM(message.body, key);
          this.state.plaintext = plaintext;
        } else {
          this.state.plaintext = "";
        }
        break;
      }
      case "connect":
        /** Establish the websocket connection */
        this.connect();
        break;
      case "disconnect":
        /** Close the websocket connection */
        this.disconnect();
        break;
    }

    /** render based on what command triggered state change */
    this.render(message.command);
  }

  /**
   * Runs PBKDF2 for key expansion on the passphrase and creates an id for it
   * by running SHA256 on it.
   */
  private async deriveKeyAndId(passphrase: string): Promise<{ id: string; key: string }> {
    if (this.cryptoCache[passphrase]) return this.cryptoCache[passphrase];
    const expanded = await Crypt.deriveKeyAndId(passphrase);
    this.cryptoCache[passphrase] = expanded;
    return expanded;
  }

  private async connect(): Promise<any> {
    /** If a socket promise already exists, return it */
    if (this.socket) return this.socket;
    const { res, rej, done } = hoistPromise<WebSocket>();
    this.socket = done;
    const proto = this.options.ssl ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${this.options.host}/api/ws`);

    /**
     * once socket is open, load & subscribe to the board and resolve the
     * ready promise.
     */
    ws.onopen = async () => {
      const { id } = await this.deriveKeyAndId(this.state.passphrase);
      res(ws);
      this.state.connected = true;
      this.send("load", { id });
      this.send("subscribe", { id });
      this.render("socket-open");
    };

    /** Add message handling */
    ws.onmessage = (e: any) => this.handleMessage(JSON.parse(e.data) as Message);
    ws.onclose = () => {
      this.socket = false;
      this.state.connected = false;
      this.render("socket-close");
    };
    ws.onerror = console.log;
    return done;
  }

  private async disconnect() {
    if (this.options.transport !== "socket" || !this.socket) return;
    const socket = await this.socket;
    socket.close();
    this.state.connected = false; // should also get set by close event
    this.socket = false;
  }

  /**
   * Wrapper around transport layer.
   * Either sends a socket message or makes a POST request depending on how
   * transport is setup
   */
  private async send(command: string, body?: object) {
    debugLog("SEND", this.options.transport, command, body);
    const { transport, host, ssl } = this.options;
    if (transport === "socket") {
      if (!this.socket) await this.connect();
      if (this.socket && this.state.connected) {
        (await this.socket).send(JSON.stringify({ command, body, meta: { date: Date.now() } }));
      }
    } else {
      /**
       * Make a post request, and handle the response message the same as if
       * it was a socket message
       */
      try {
        const proto = ssl ? "https" : "http";
        const url = `${proto}://${host}/api/`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, body, meta: { date: Date.now() } }),
        });
        if (response.status === 204) return;
        const msg = await response.json();
        if (msg.command) this.handleMessage(msg);
      } catch (e) {
        console.log(e);
      }
    }
  }

  private handleMessage(msg: Message) {
    if (msg.command === "set-plaintext") {
      this.state.encrypted = false;
      this.state.plaintext = msg.body;
      this.render("set-plaintext");
      return;
    }
    if (msg.command === "set-ciphertext") {
      this.stdin({ command: "set-ciphertext", body: msg.body });
    }
  }
}

export class Crypt {
  /**
   * Derives an encryption key and server ID from a passphrase.
   * PBKDF2 handles the slow password-hardening step; HKDF then
   * splits the output into two independent keys so the server ID
   * never leaks information about the encryption key.
   */
  static async deriveKeyAndId(passphrase: string): Promise<{ key: string; id: string }> {
    Crypt.assertSubtleCrypto();
    const salt = Crypt.base64toUint8Array(SALT);

    /**
     * get seed into pbkdf2 and set crypto settings
     */
    const pbkdf2 = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveBits"],
    );

    /** Run the keygen to derive 256 bits */
    const material = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 650000, hash: "SHA-256" },
      pbkdf2,
      256,
    );

    /** Import expanded passphrase into hkdf */
    const hkdf = await crypto.subtle.importKey(
      "raw",
      material,
      "HKDF",
      false,
      ["deriveBits"],
    );

    /**
     * See various refs. skipping deriveKey since we just need bits
     * https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveBits
     * https://developer.mozilla.org/en-US/docs/Web/API/HkdfParams
     * https://datatracker.ietf.org/doc/html/rfc5869#section-3.3
     *
     * an empty salt is used because api does not give an option to skip key
     * expansion, which PBKDF2 already solved.
     */
    const key = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(32),
        info: new TextEncoder().encode("key"),
      },
      hkdf,
      256,
    );
    const id = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(32),
        info: new TextEncoder().encode("id"),
      },
      hkdf,
      256,
    );

    return {
      key: Crypt.uint8ArrayToBase64(new Uint8Array(key)),
      id: Crypt.uint8ArrayToBase64(new Uint8Array(id)),
    };
  }

  /**
   * Encrypt supplied plaintext with AES-GCM, negating the need for additional
   * HMAC signing
   */
  static async encryptGCM(plaintext: string, keyString: string): Promise<Encrypted> {
    Crypt.assertSubtleCrypto();
    const iv = Crypt.randomBytes(12);
    /** Convert the string based key to bytes */
    const key = await crypto.subtle.importKey(
      "raw",
      Crypt.base64toUint8Array(keyString),
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    );

    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    );

    return {
      ciphertext: Crypt.uint8ArrayToBase64(new Uint8Array(ciphertext)),
      iv: Crypt.uint8ArrayToBase64(iv),
    };
  }
  static async decryptGCM(encrypted: Encrypted, keyString: string): Promise<string> {
    Crypt.assertSubtleCrypto();
    const key = await crypto.subtle.importKey(
      "raw",
      Crypt.base64toUint8Array(keyString),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Crypt.base64toUint8Array(encrypted.iv) },
      key,
      Crypt.base64toUint8Array(encrypted.ciphertext),
    );

    return new TextDecoder().decode(plaintext);
  }

  static randomBytes(bytes = 16): Uint8Array<ArrayBuffer> {
    const values = new Uint8Array(bytes);
    crypto.getRandomValues(values);
    return values;
  }

  static base64toUint8Array(str?: string): Uint8Array<ArrayBuffer> {
    if (!str) return new Uint8Array(0);
    while (str.length % 4 !== 0) str += "=";
    const outputSize = (str.length / 4) * 3 -
      (str[str.length - 1] === "=" ? 1 : 0) -
      (str[str.length - 2] === "=" ? 1 : 0);

    const arr = new Uint8Array(outputSize);

    for (let i = 0; i < str.length; i += 4) {
      const arrIndex = (i / 4) * 3;
      arr[arrIndex] = (B64_REVERSE[str.charCodeAt(i)] << 2) | (B64_REVERSE[str.charCodeAt(i + 1)] >> 4);
      if (arr.length > arrIndex + 1) {
        arr[arrIndex + 1] = ((B64_REVERSE[str.charCodeAt(i + 1)] & 0b00001111) << 4) |
          (B64_REVERSE[str.charCodeAt(i + 2)] >> 2);
      }
      if (arr.length > arrIndex + 2) {
        arr[arrIndex + 2] = ((B64_REVERSE[str.charCodeAt(i + 2)] & 0b00000011) << 6) |
          B64_REVERSE[str.charCodeAt(i + 3)];
      }
    }
    return arr;
  }

  static uint8ArrayToBase64(arr: Uint8Array, padding: boolean = true): string {
    if (arr.length === 0) return "";
    //deno-fmt-ignore
    const b64CharMap = [ "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "/" ];
    let out = "";
    let remain = 0;
    let halfNibbles = 0;
    for (let i = 0; i < arr.length; i++) {
      halfNibbles = i % 3;
      switch (halfNibbles) {
        case 0:
          out += b64CharMap[arr[i] >> 2]; // 00111111
          remain = (0b00000011 & arr[i]) << 4; // 00110000
          break;
        case 1:
          out += b64CharMap[remain | (arr[i] >> 4)]; // 00110000 + 00001111
          remain = (0b00001111 & arr[i]) << 2; // 00111100
          break;
        case 2:
          out += b64CharMap[remain | (arr[i] >> 6)]; // 00000011 + 00111100 = 00111111
          out += b64CharMap[0b00111111 & arr[i]]; // 00111111
          break;
      }
    }
    if (halfNibbles === 0) out += b64CharMap[remain] + (padding ? "==" : "");
    else if (halfNibbles === 1) out += b64CharMap[remain] + (padding ? "=" : "");
    return out;
  }

  static assertSubtleCrypto(): void {
    if (!crypto?.subtle) throw "Subtle crypto not available";
  }
}

export function hoistPromise<T = any>(): { res: Function; rej: Function; done: Promise<T> } {
  let res: (param: T | PromiseLike<T>) => void;
  let rej: (reason: any) => void;
  const done = new Promise((resolve, reject) => {
    res = resolve;
    rej = reject;
  }) as Promise<T>;
  return { res: res!, rej: rej!, done };
}

function debugLog(...args: unknown[]) {
  if (DEBUG) console.log(...args);
}
