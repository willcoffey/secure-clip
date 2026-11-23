import html from "./secure-clip.html?raw";
import css from "./secure-clip.css?raw";

/** Components **/
import "./components/qr-code/qr-code.ai";

/** SVG Icons */
import eyeOn from "lucide-static/icons/eye.svg?raw";
import eyeOff from "lucide-static/icons/eye-off.svg?raw";
import qrCode from "lucide-static/icons/qr-code.svg?raw";
import circleHelp from "lucide-static/icons/circle-question-mark.svg?raw";
import dices from "lucide-static/icons/dices.svg?raw";
import globe from "lucide-static/icons/globe.svg?raw";
import globeOff from "lucide-static/icons/globe-off.svg?raw";

import { Crypt, SecureClip } from "./core";

class SecureClipElement extends HTMLElement {
  core = new SecureClip(
    {
      host: location.host,
      ssl: location.protocol === "https:",
      transport: "socket",
    },
    localStorage.getItem("sc:passphrase") ?? Crypt.uint8ArrayToBase64(Crypt.randomBytes(16), false),
  );
  shadow?: ShadowRoot;

  randomizePassphrase(field: HTMLInputElement) {
    const passphrase = Crypt.uint8ArrayToBase64(Crypt.randomBytes(16), false);
    field.value = passphrase;
    localStorage.setItem("sc:passphrase", passphrase);
    this.core.stdin({ command: "set-passphrase", body: passphrase });
  }

  initPassphraseField(field: HTMLInputElement, qr: HTMLButtonElement, help: HTMLButtonElement) {
    field.value = this.core.state.passphrase;

    /**
     * Update the passphrase only after change, not every keystroke. so as not
     * to leak hash of 'p' then 'pa', 'pas', 'pass' and so forth. Making it 
     * easy to crack
     */
    field.addEventListener("change", () => {
      localStorage.setItem("sc:passphrase", field.value);
      this.core.stdin({ command: "set-passphrase", body: field.value });
    });
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") field.blur();
    });

    qr.innerHTML = qrCode;
    qr.addEventListener("click", () => this.shadow!.querySelector("qr-code")!.show(field.value));
    help.innerHTML = circleHelp;
    help.addEventListener("click", () => {
      field.value = "system-help";
      this.core.stdin({ command: "set-passphrase", body: "system-help" });
    });
  }

  initHideShowIcon(field: HTMLInputElement, toggle: HTMLButtonElement) {
    toggle.addEventListener("click", () => {
      const show = field.type === "password";
      field.type = show ? "text" : "password";
      toggle.innerHTML = show ? eyeOff : eyeOn;
      toggle.setAttribute("aria-pressed", String(show));
      toggle.setAttribute("aria-label", show ? "Hide passphrase" : "Show passphrase");
    });
  }

  initTextarea(textarea: HTMLTextAreaElement) {
    let debounce: ReturnType<typeof setTimeout>;
    let dirty = false;

    const flush = () => {
      if (!dirty) return;
      clearTimeout(debounce);
      dirty = false;
      this.core.stdin({ command: "set-plaintext", body: textarea.value });
    };

    textarea.addEventListener("input", (e) => {
      dirty = true;
      const target = e.target as HTMLTextAreaElement;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        dirty = false;
        this.core.stdin({ command: "set-plaintext", body: target.value });
      }, 200);
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

    const passphraseField = this.shadow.getElementById("passphrase-field") as HTMLInputElement;
    const passphraseQr = this.shadow.getElementById("passphrase-qr") as HTMLButtonElement;
    const passphraseHelp = this.shadow.getElementById("passphrase-help") as HTMLButtonElement;
    const passphraseDice = this.shadow.getElementById("passphrase-dice") as HTMLButtonElement;
    const passphraseConnect = this.shadow.getElementById("passphrase-connect") as HTMLButtonElement;
    const toggle = this.shadow.getElementById("passphrase-toggle") as HTMLButtonElement;
    const textarea = this.shadow.getElementById("text-field") as HTMLTextAreaElement;

    toggle.innerHTML = eyeOn;
    passphraseDice.innerHTML = dices;
    passphraseConnect.classList.add("disconnected");
    passphraseConnect.innerHTML = globeOff;
    passphraseDice.addEventListener("click", () => this.randomizePassphrase(passphraseField));

    passphraseConnect.addEventListener("click", () => {
      const command = this.core.state.connected ? "disconnect" : "connect";
      this.core.stdin({ command });
    });

    this.initPassphraseField(passphraseField, passphraseQr, passphraseHelp);
    this.initHideShowIcon(passphraseField, toggle);
    this.initTextarea(textarea);
    this.core.render = (command) => {
      if (command === "set-plaintext" || command === "set-ciphertext") {
        textarea.value = this.core.state.plaintext;
      } else if (command === "socket-open" || command === "socket-close") {
        const connected = this.core.state.connected;
        passphraseConnect.classList.toggle("connected", connected);
        passphraseConnect.classList.toggle("disconnected", !connected);
        passphraseConnect.innerHTML = connected ? globe : globeOff;
        passphraseField.disabled = !connected;
        textarea.disabled = !connected;
      }
    };
    this.core.stdin({ command: "connect" });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      this.core.stdin({ command: "connect" });
    });
  }
}

const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
customElements.define("secure-clip", SecureClipElement);

navigator.serviceWorker?.register("/sw.js");
