import { RESERVED_KEYS } from "./reserved-keys.ts";

export type Message =
  | { action: "set-passphrase"; args: string }
  | { action: "set-plaintext"; args: string }
  | { action: "set-ciphertext"; args: EncryptedData };

export interface EncryptedData {
  salt: string;
  sign: string;
  ciphertext: string;
}

export interface WsMessage {
  command: string;
  body: { id: string; ciphertext: EncryptedData | null; plaintext?: string };
}

export interface State {
  id: string;
  passphrase: string;
  plaintext: string;
  encrypted: EncryptedData | false;
  status: string;
}

type Connection =
  | {
    type: "websocket";
    ws?: Promise<WebSocket>;
    status: "connected" | "connecting" | "disconnected";
    nextRetry: number;
    failures: number;
  }
  | { type: "http" };

export interface SecureClipOptions {
  passphrase: string;
  host: string;
  secure?: boolean; // true = wss/https, false = ws/http; defaults to true
  connection?: "ws" | "post";
}

export class SecureClip {
  static RESERVED_KEYS = RESERVED_KEYS;

  state: State;
  render?: (plaintext: string) => void;
  private connection: Connection;
  private host: string;
  private secure: boolean;

  constructor(options: SecureClipOptions) {
    this.host = options.host;
    this.secure = options.secure ?? true;
    this.connection = options.connection === "post"
      ? { type: "http" }
      : { type: "websocket", status: "disconnected", nextRetry: 0, failures: 0 };
    this.state = {
      id: "",
      passphrase: options.passphrase,
      plaintext: "",
      encrypted: false,
      status: "",
    };
    this.init();
  }

  private async init() {
    this.state.id = await this.resolveId(this.state.passphrase);
    await this.send("load", { id: this.state.id });
    if (this.connection.type === "websocket") {
      this.send("subscribe", { id: this.state.id });
    }
  }

  /**
   * Close any existing connection and connect to the server, only resolves
   * when the websocket has been opened. Throws if called on an http connection.
   */
  async connect(): Promise<WebSocket> {
    if (this.connection.type === "http") throw new Error("connect() called on http connection");
    if (
      this.connection.status === "connected" ||
      this.connection.status === "connecting"
    ) return this.connection.ws!;
    const { res, rej, done } = hoistPromise<WebSocket>();
    this.connection.ws = done;
    this.connection.status = "connecting";
    await sleep(this.connection.nextRetry - Date.now());

    const proto = this.secure ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${this.host}/api/ws`);

    ws.onopen = () => {
      if (this.connection.type !== "websocket") return;
      this.connection.status = "connected";
      res(ws);
      const clearErrors = () => {
        if (this.connection.type !== "websocket") return;
        this.connection.failures--;
        if (this.connection.failures > 0) setTimeout(clearErrors, 20000);
      };
      if (this.connection.failures > 0) clearErrors();
    };
    ws.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
    ws.onerror = (e) => rej(e);

    /** Whenever the connection is lost, retry with exponential backoff */
    ws.onclose = () => {
      if (this.connection.type !== "websocket") return;
      this.connection.failures++;
      this.connection.nextRetry = Date.now() + 5000 * Math.pow(2, this.connection.failures);
      this.connection.status = "disconnected";
      this.connect();
    };
    return done;
  }

  /**
   * Any state change should flow through here. WebSocket messages that set
   * ciphertext get sent here. User updates to passphrase / plaintext too.
   */
  async stdin(message: Message) {
    let matched = true;
    switch (message.action) {
      case "set-passphrase": {
        const oldId = this.state.id;
        this.state.passphrase = message.args;
        this.state.id = await this.resolveId(message.args);
        if (this.connection.type === "websocket") {
          this.send("unsubscribe", { id: oldId });
          this.send("subscribe", { id: this.state.id });
        }
        this.state.plaintext = "";
        this.state.encrypted = false;
        this.state.status = "";
        this.send("load", { id: this.state.id });
        break;
      }
      case "set-plaintext": {
        this.state.plaintext = message.args;
        const encrypted = await Crypt.encrypt(message.args, this.state.passphrase);
        this.state.encrypted = encrypted;
        this.send("update", { id: this.state.id, ciphertext: encrypted });
        break;
      }
      case "set-ciphertext": {
        const ciphertext = message.args;
        if (message.args.ciphertext) {
          this.state.encrypted = ciphertext;
          const { valid, plaintext } = await this.getDecrypted(ciphertext);
          this.state.plaintext = plaintext;
          this.state.status = valid ? "" : "HMAC Invalid";
        } else {
          this.state.plaintext = "";
          this.state.status = "";
        }
        break;
      }
      default:
        matched = false;
    }
    if (matched) this.render?.(this.state.plaintext);
  }

  private resolveId(passphrase: string): Promise<string> | string {
    if (SecureClip.RESERVED_KEYS.includes(passphrase)) return passphrase;
    return Crypt.deriveId(passphrase);
  }

  private async getDecrypted(data: EncryptedData): Promise<{ valid: boolean; plaintext: string }> {
    return Crypt.decrypt(data, this.state.passphrase);
  }

  private async send(command: string, body?: object) {
    if (this.connection.type === "websocket") {
      const ws = await this.connect();
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ command, body, meta: { date: Date.now() } }));
    } else {
      const proto = this.secure ? "https" : "http";
      const response = await fetch(`${proto}://${this.host}/api/ws`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, body, meta: { date: Date.now() } }),
      });
      if (response.ok && response.status !== 204) {
        const msg = await response.json() as WsMessage;
        if (msg?.command) this.handleMessage(msg);
      }
    }
  }

  private handleMessage(msg: WsMessage) {
    if (msg.body?.id !== this.state.id) {
      throw new Error(`id mismatch: ${msg.body.id} !== ${this.state.id}`);
    }
    if (msg.command === "set-plaintext") {
      this.state.plaintext = msg.body.plaintext ?? "";
      this.state.encrypted = false;
      this.state.status = "";
      this.render?.(this.state.plaintext);
      return;
    }
    const raw = msg.body.ciphertext;
    const ciphertext: EncryptedData = {
      salt: raw?.salt ?? "",
      sign: raw?.sign ?? "",
      ciphertext: raw?.ciphertext ?? "",
    };
    this.stdin({ action: "set-ciphertext", args: ciphertext });
  }
}

export class Crypt {
  /**
   * Derives a deterministic channel id from the passphrase using PBKDF2
   * with a fixed salt. Slow by design — makes passphrase brute-forcing harder.
   */
  static async deriveId(passphrase: string): Promise<string> {
    if (!crypto?.subtle?.importKey) throw "Subtle crypto not available";
    if (!crypto?.subtle?.deriveKey) throw "Subtle crypto not available";

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

  /** Encrypts using AES-CTR with a PBKDF2-derived key, signed with HMAC. */
  static async encrypt(plaintext: string, passphrase: string): Promise<EncryptedData> {
    if (!crypto?.subtle?.encrypt) throw "Subtle crypto not available";

    const salt = Crypt.randomBytes(16);
    const { aes, hmac } = await Crypt.deriveKeys(passphrase, salt);

    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-CTR", counter: new Uint8Array(salt).buffer, length: 128 },
      aes,
      new TextEncoder().encode(plaintext),
    );

    const sign = await crypto.subtle.sign("HMAC", hmac, ciphertext);

    return {
      salt: Crypt.uint8ArrayToBase64(salt),
      sign: Crypt.uint8ArrayToBase64(new Uint8Array(sign)),
      ciphertext: Crypt.uint8ArrayToBase64(new Uint8Array(ciphertext)),
    };
  }

  static async decrypt(
    data: EncryptedData,
    passphrase: string,
  ): Promise<{ valid: boolean; plaintext: string }> {
    if (!crypto?.subtle?.decrypt) throw "Subtle crypto not available";
    const salt = Crypt.base64toUint8Array(data.salt);
    const sign = Crypt.base64toUint8Array(data.sign);
    const ciphertext = Crypt.base64toUint8Array(data.ciphertext);
    const { aes, hmac } = await Crypt.deriveKeys(passphrase, salt);
    const valid = await crypto.subtle.verify(
      "HMAC",
      hmac,
      new Uint8Array(sign).buffer,
      new Uint8Array(ciphertext).buffer,
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-CTR", counter: new Uint8Array(salt).buffer, length: 128 },
      aes,
      new Uint8Array(ciphertext).buffer,
    );
    return { valid, plaintext: new TextDecoder().decode(plaintext) };
  }

  /**
   * Uses PBKDF2 to derive two keys, one to be used to encrypt/decrypt using
   * AES-CTR and one for signing and verifying data using HMAC.
   */
  static async deriveKeys(
    passphrase: string | Uint8Array,
    salt?: Uint8Array | string,
  ): Promise<{ aes: CryptoKey; hmac: CryptoKey }> {
    if (!crypto?.subtle?.importKey) throw "Subtle crypto not available";
    if (!crypto?.subtle?.deriveKey) throw "Subtle crypto not available";
    if (!salt) salt = Crypt.randomBytes(16);
    if (typeof salt === "string") salt = Crypt.base64toUint8Array(salt);
    if (typeof passphrase === "string") passphrase = new TextEncoder().encode(passphrase);

    /** Import the raw key value submitted by the user so that PBKDF2 can be run on it */
    const baseKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(passphrase).buffer,
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"],
    );

    /** Derive a key to be used for encryption */
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: new Uint8Array(salt).buffer,
        iterations: 650000,
        hash: "SHA-256",
      },
      baseKey,
      { name: "AES-CTR", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );

    const hmac = await crypto.subtle.importKey(
      "raw",
      await crypto.subtle.exportKey("raw", key) as ArrayBuffer,
      { name: "HMAC", hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );

    return { aes: key, hmac: hmac };
  }

  static randomBytes(bytes = 16): Uint8Array {
    const values = new Uint8Array(bytes);
    crypto.getRandomValues(values);
    return values;
  }

  static base64toUint8Array(str?: string): Uint8Array {
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
