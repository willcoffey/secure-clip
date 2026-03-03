import html from "./secure-clip.html?raw";
import css from "./secure-clip.css?raw";
import eyeOn from "lucide-static/icons/eye.svg?raw";
import eyeOff from "lucide-static/icons/eye-off.svg?raw";
import qrCode from "lucide-static/icons/qr-code.svg?raw";
import encodeQR from "qr";

type Message =
  | { action: "set-id"; args: string }
  | { action: "set-password"; args: string }
  | { action: "set-plaintext"; args: string }
  | { action: "set-ciphertext"; args: EncryptedData };

interface EncryptedData {
  salt: string;
  sign: string;
  ciphertext: string;
}

interface WsMessage {
  command: string;
  body: { id: string; ciphertext: EncryptedData | null };
}

interface State {
  id: string;
  password: string;
  plaintext: string;
  encrypted: EncryptedData | false;
  status: string;
}

export class SecureClip {
  state: State;
  ws: WebSocket;
  render?: (plaintext: string) => void;

  constructor() {
    this.state = SecureClip.loadStateFromLocalStorage();
    this.ws = this.initWebSocket();
  }

  private static loadStateFromLocalStorage(): State {
    return {
      id: localStorage.getItem("sc:id") ?? "swordfish",
      password: localStorage.getItem("sc:password") ?? "swordfish",
      plaintext: "",
      encrypted: false,
      status: "",
    };
  }

  private initWebSocket(): WebSocket {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    ws.onopen = () => this.load();
    ws.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
    ws.onerror = (e) => console.error("WS error", e);
    ws.onclose = () => console.log("WS closed");
    return ws;
  }

  async stdin(message: Message) {
    let matched = true;
    switch (message.action) {
      case "set-id": {
        this.send("unsubscribe", { id: this.state.id });
        this.state.id = message.args;
        localStorage.setItem("sc:id", message.args);
        this.state.status = "loading";
        this.load();
        break;
      }
      case "set-password": {
        this.state.password = message.args;
        localStorage.setItem("sc:password", message.args);
        if (this.state.encrypted) {
          const { valid, plaintext } = await this.getDecrypted(this.state.encrypted);
          this.state.plaintext = plaintext;
          this.state.status = valid ? "" : "HMAC Invalid";
        }
        break;
      }
      case "set-plaintext": {
        this.state.plaintext = message.args;
        const encrypted = await Crypt.encrypt(message.args, this.state.password);
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
          this.state.status = ""
        }
        break;
      }
      default:
        matched = false;
    }
    if (matched) this.render?.(this.state.plaintext);
  }

  private async getDecrypted(data: EncryptedData): Promise<{ valid: boolean; plaintext: string }> {
    if (this.state.id === "system-stats") return { valid: true, plaintext: data.ciphertext };
    return Crypt.decrypt(data, this.state.password);
  }

  private send(command: string, body?: object) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ command, body }));
  }

  private load() {
    const { id } = this.state;
    this.send("subscribe", { id });
    this.send("load", { id });
  }

  private handleMessage(msg: WsMessage) {
    console.log(msg);
    if (msg.body.id !== this.state.id) {
      throw new Error(`id mismatch: ${msg.body.id} !== ${this.state.id}`);
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

class SecureClipElement extends HTMLElement {
  core = new SecureClip();
  shadow?: ShadowRoot;

  initIdField(field: HTMLInputElement, qr: HTMLButtonElement) {
    field.value = this.core.state.id;
    field.addEventListener("input", () => {
      this.core.stdin({ action: "set-id", args: field.value });
    });
    qr.innerHTML = qrCode;
    qr.addEventListener("click", () => this.showQrPopover(field.value));
  }

  initPasswordField(field: HTMLInputElement, qr: HTMLButtonElement) {
    field.value = this.core.state.password;
    field.addEventListener("input", () => {
      this.core.stdin({ action: "set-password", args: field.value });
    });
    qr.innerHTML = qrCode;
    qr.addEventListener("click", () => this.showQrPopover(field.value));
  }

  showQrPopover(value: string) {
    const backdrop = this.shadow!.getElementById("qr-backdrop")!;
    const popover = this.shadow!.getElementById("qr-popover")!;
    const svg = encodeQR(value, "svg");
    popover.innerHTML = svg.replace(">", `><rect width="100%" height="100%" fill="#e8e4c8"/>`);
    backdrop.hidden = false;
    const dismiss = () => {
      backdrop.hidden = true;
      backdrop.removeEventListener("click", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
    backdrop.addEventListener("click", dismiss);
    document.addEventListener("keydown", dismiss);
  }

  initHideShowIcon(field: HTMLInputElement, toggle: HTMLButtonElement) {
    toggle.addEventListener("click", () => {
      const show = field.type === "password";
      field.type = show ? "text" : "password";
      toggle.innerHTML = show ? eyeOff : eyeOn;
      toggle.setAttribute("aria-pressed", String(show));
      toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  }

  initTextarea(textarea: HTMLTextAreaElement, errorMsg: HTMLParagraphElement) {
    this.core.render = (plaintext) => {
      textarea.value = plaintext;
      errorMsg.textContent = this.core.state.status;
      errorMsg.classList.toggle("visible", this.core.state.status !== "");
    };

    let debounce: ReturnType<typeof setTimeout>;
    let dirty = false;

    const flush = () => {
      if (!dirty) return;
      clearTimeout(debounce);
      dirty = false;
      this.core.stdin({ action: "set-plaintext", args: textarea.value });
    };

    textarea.addEventListener("input", (e) => {
      dirty = true;
      const target = e.target as HTMLTextAreaElement;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        dirty = false;
        this.core.stdin({ action: "set-plaintext", args: target.value });
      }, 1000);
    });
    textarea.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("beforeunload", flush);
  }

  connectedCallback() {
    this.shadow = this.attachShadow({ mode: "open" });
    this.shadow.adoptedStyleSheets = [sheet];
    this.shadow.innerHTML = html;

    const idField = this.shadow.getElementById("id-field") as HTMLInputElement;
    const idQr = this.shadow.getElementById("id-qr") as HTMLButtonElement;
    const passwordField = this.shadow.getElementById("password-field") as HTMLInputElement;
    const passwordQr = this.shadow.getElementById("password-qr") as HTMLButtonElement;
    const toggle = this.shadow.getElementById("password-toggle") as HTMLButtonElement;
    const textarea = this.shadow.getElementById("text-field") as HTMLTextAreaElement;
    const errorMsg = this.shadow.getElementById("error-msg") as HTMLParagraphElement;

    toggle.innerHTML = eyeOn;
    this.initIdField(idField, idQr);
    this.initPasswordField(passwordField, passwordQr);
    this.initHideShowIcon(passwordField, toggle);
    this.initTextarea(textarea, errorMsg);
  }
}

const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
customElements.define("secure-clip", SecureClipElement);

class Crypt {
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
   * Uses PBKDF2 to derive two keys, one to be used to encrypt/decrypt using AES-CTR and one for
   * signing and verifying data using HMAC.
   */
  static async deriveKeys(
    passphrase: string | Uint8Array,
    salt?: Uint8Array | string,
  ): Promise<{ aes: CryptoKey; hmac: CryptoKey }> {
    if (!crypto?.subtle?.importKey) throw "Subtle crypto not available";
    if (!crypto?.subtle?.deriveKey) throw "Subtle crypto not available";
    if (!salt) salt = Crypt.randomBytes(16);
    if (typeof salt === "string") salt = Crypt.base64toUint8Array(salt);
    if (typeof passphrase === "string") {
      passphrase = new TextEncoder().encode(passphrase);
    }

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
      await crypto.subtle.exportKey("raw", key),
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

    let remain = 0;

    let arrIndex = 0;
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
    else if (halfNibbles === 1) {
      out += b64CharMap[remain] + (padding ? "=" : "");
    }
    return out;
  }
}
