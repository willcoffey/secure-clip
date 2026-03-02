import html from "./secure-clip.html?raw";
import css from "./secure-clip.css?raw";

interface Message {
  action: string;
  args: string;
}

interface WsMessage {
  command: "load" | "update";
  body: { id: string; ciphertext: string | null };
}

interface State {
  id: string;
  password: string;
  plaintext: string | false;
  ciphertext: string | false;
}

export class SecureClip {
  state: State = { id: "swordfish", password: "swordfish", plaintext: false, ciphertext: false };
  ws: WebSocket;
  stdout?: (plaintext: string) => void;

  constructor() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    this.ws.onopen = () => this.load();
    this.ws.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
    this.ws.onerror = (e) => console.error("WS error", e);
    this.ws.onclose = () => console.log("WS closed");
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

  private async handleMessage(msg: WsMessage) {
    if (msg.command !== "load" && msg.command !== "update") return;
    if (msg.body.id !== this.state.id) return;
    if (msg.body.ciphertext == null) return;
    const plaintext = await this.decrypt(msg.body.ciphertext);
    this.state.plaintext = plaintext;
    this.state.ciphertext = msg.body.ciphertext;
    this.stdout?.(plaintext);
  }

  async encrypt(plaintext: string): Promise<string> {
    return plaintext.toUpperCase();
  }

  async decrypt(ciphertext: string): Promise<string> {
    return ciphertext.toLowerCase();
  }

  async push(): Promise<void> {
    if (typeof this.state.plaintext !== "string") return;
    const ciphertext = await this.encrypt(this.state.plaintext);
    this.state.ciphertext = ciphertext;
    this.send("update", { id: this.state.id, ciphertext });
  }

  stdin(message: Message) {
    switch (message.action) {
      case "set-id":
        this.state.id = message.args;
        this.load();
        return;
      case "set-password":
        this.state.password = message.args;
        return;
      case "update":
        this.state.plaintext = message.args;
        this.push();
        return;
    }
  }
}

class SecureClipElement extends HTMLElement {
  core = new SecureClip();
  shadow?: ShadowRoot;

  connectedCallback() {
    this.shadow = this.attachShadow({ mode: "open" });
    this.shadow.adoptedStyleSheets = [sheet];
    this.shadow.innerHTML = html;

    const idField = this.shadow.getElementById("id-field") as HTMLInputElement;
    const passwordField = this.shadow.getElementById("password-field") as HTMLInputElement;
    const textarea = this.shadow.getElementById("text-field") as HTMLTextAreaElement;

    idField.value = this.core.state.id;
    passwordField.value = this.core.state.password;

    this.core.stdout = (plaintext) => { textarea.value = plaintext; };

    const eyeOn = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const eyeOff = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    const toggle = this.shadow.getElementById("password-toggle") as HTMLButtonElement;
    toggle.addEventListener("click", () => {
      const show = passwordField.type === "password";
      passwordField.type = show ? "text" : "password";
      toggle.innerHTML = show ? eyeOff : eyeOn;
      toggle.setAttribute("aria-pressed", String(show));
      toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });

    idField.addEventListener("blur", (e) => {
      const target = e.target as HTMLInputElement;
      this.core.stdin({ action: "set-id", args: target.value });
    });

    passwordField.addEventListener("blur", (e) => {
      const target = e.target as HTMLInputElement;
      this.core.stdin({ action: "set-password", args: target.value });
    });

    let debounce: ReturnType<typeof setTimeout>;
    textarea.addEventListener("input", (e) => {
      const target = e.target as HTMLTextAreaElement;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.core.stdin({ action: "update", args: target.value });
      }, 1000);
    });
    textarea.addEventListener("blur", (e) => {
      clearTimeout(debounce);
      const target = e.target as HTMLTextAreaElement;
      this.core.stdin({ action: "update", args: target.value });
    });
  }
}

const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
customElements.define("secure-clip", SecureClipElement);
