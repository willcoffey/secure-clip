/** How to communicate with server, either via POST requests or websocket */
/**
 * TODO - Exponential backoff on websocket reconnection
 */
const DEBUG = false;
type Transport = "post" | "socket";

export type Message =
  | { command: "set-passphrase"; body: string }
  | { command: "set-plaintext"; body: string }
  | { command: "set-ciphertext"; body: Encrypted | null }
  | { command: "connect" }
  | { command: "disconnect" };

export interface Encrypted {
  iv: string;
  ciphertext: string;
}

export interface State {
  passphrase: string;
  plaintext: string;
  encrypted: Encrypted | false;
  status: string;
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
  static RESERVED_KEYS = ["system-stats", "system-help"];
  state: State;
  options: Required<SecureClipOptions>;
  socket: Promise<WebSocket> | false = false;
  connected: boolean = false;

  /** Cache the PBKDF2 operations since they are expensive */
  cryptoCache: Record<string, { id: string; key: string }> = {};

  /** Render hook used for web component, called when state changes */
  render: () => void = console.log;

  /** @TODO - wrap inside render */
  onConnectionChange?: (connected: boolean) => void;

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
      status: "",
    };
  }

  /**
   * Runs PBKDF2 for key expansion on the passphrase and creates an id for it
   * by running SHA256 on it.
   */
  async deriveKeyAndId(passphrase: string): Promise<{ id: string; key: string }> {
    if (this.cryptoCache[passphrase]) return this.cryptoCache[passphrase];
    const key = await Crypt.expandKey(passphrase);
    const id = await Crypt.sha256(key);
    this.cryptoCache[passphrase] = { key, id };
    return this.cryptoCache[passphrase];
  }
  /**
   * stdin serves as the public interface for this class. Anything using this
   * class should only sudmit commands through stdin, no direct method calling
   */
  async stdin(message: Message) {
    debugLog("STDIN", message);
    const { transport } = this.options;
    let matched = true;

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
        this.state.status = "";
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
      default:
        matched = false;
    }

    /** If any command was processed, trigger a re-render */
    if (matched) this.render();
  }

  async load() {
    const { id } = await this.deriveKeyAndId(this.state.passphrase);
    this.send("load", { id });
  }

  /** */
  async connect(): Promise<any> {
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
      this.connected = true;
      this.send("load", { id });
      this.send("subscribe", { id });
      this.onConnectionChange?.(true);
    };

    /** Add message handling */
    ws.onmessage = (e: any) => this.handleMessage(JSON.parse(e.data) as Message);
    ws.onclose = () => {
      this.onConnectionChange?.(false);
      this.socket = false;
      this.connected = false;
    };
    ws.onerror = console.log;
    return done;
  }

  async disconnect() {
    if (this.options.transport !== "socket" || !this.socket) return;
    const socket = await this.socket;
    socket.close();
    this.connected = false // should also get set by close event
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
      if (this.socket && this.connected) {
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
      this.state.status = "";
      this.state.plaintext = msg.body;
      this.render();
      return;
    }
    if (msg.command === "set-ciphertext") {
      this.stdin({ command: "set-ciphertext", body: msg.body });
    }
  }
}

export class Crypt {
  static async expandKey(passphrase: string): Promise<string> {
    Crypt.assertSubtleCrypto();
    /**
     * In this context, purpose of the salt is to prevent rainbow tables. constant salt needed for
     * deterministic ids. Best practice would be to generate on per-host basis
     */
    const salt = Crypt.base64toUint8Array("CDVY91c4f1n+j5M8CeJjDg==");
    const baseKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"],
    );

    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: 650000, hash: "SHA-256" },
      baseKey,
      { name: "AES-CTR", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    return Crypt.uint8ArrayToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
  }

  static async sha256(input: string): Promise<string> {
    Crypt.assertSubtleCrypto();
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Crypt.uint8ArrayToBase64(new Uint8Array(hashBuffer));
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

    //deno-fmt-ignore
    const reverseMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11, M: 12, N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19, U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25, a: 26, b: 27, c: 28, d: 29, e: 30, f: 31, g: 32, h: 33, i: 34, j: 35, k: 36, l: 37, m: 38, n: 39, o: 40, p: 41, q: 42, r: 43, s: 44, t: 45, u: 46, v: 47, w: 48, x: 49, y: 50, z: 51, "0": 52, "1": 53, "2": 54, "3": 55, "4": 56, "5": 57, "6": 58, "7": 59, "8": 60, "9": 61, "+": 62, "/": 63, "=": 0 };

    for (let i = 0; i < str.length; i += 4) {
      const arrIndex = (i / 4) * 3;
      arr[arrIndex] = (reverseMap[str[i]] << 2) | (reverseMap[str[i + 1]] >> 4);
      if (arr.length > arrIndex + 1) {
        arr[arrIndex + 1] = ((reverseMap[str[i + 1]] & 0b00001111) << 4) |
          (reverseMap[str[i + 2]] >> 2);
      }
      if (arr.length > arrIndex + 2) {
        arr[arrIndex + 2] = ((reverseMap[str[i + 2]] & 0b00000011) << 6) | reverseMap[str[i + 3]];
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

export function sleep(ms: number) {
  if (ms <= 0) return;
  const { res, done } = hoistPromise();
  setTimeout(res as () => void, ms);
  return done;
}

function debugLog(...args: unknown[]) {
  if (DEBUG) console.log(...args);
}
