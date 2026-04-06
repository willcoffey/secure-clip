import html from "./secure-clip.html?raw";
import css from "./secure-clip.css?raw";

/** SVG Icons */
import eyeOn from "lucide-static/icons/eye.svg?raw";
import eyeOff from "lucide-static/icons/eye-off.svg?raw";
import qrCode from "lucide-static/icons/qr-code.svg?raw";
import circleHelp from "lucide-static/icons/circle-question-mark.svg?raw";
import dices from "lucide-static/icons/dices.svg?raw";
import globe from "lucide-static/icons/globe.svg?raw";
import globeOff from "lucide-static/icons/globe-off.svg?raw";

import encodeQR from "qr";
import { Crypt, SecureClip } from "./core";

class SecureClipElement extends HTMLElement {
  core = new SecureClip({
    passphrase: localStorage.getItem("sc:passphrase") ?? "swordfish",
    host: location.host,
    secure: location.protocol === "https:",
  });
  shadow?: ShadowRoot;

  randomizePassphrase(field: HTMLInputElement) {
    const passphrase = Crypt.uint8ArrayToBase64(Crypt.randomBytes(16), false);
    field.value = passphrase;
    localStorage.setItem("sc:passphrase", passphrase);
    this.core.stdin({ action: "set-passphrase", args: passphrase });
  }

  initPassphraseField(field: HTMLInputElement, qr: HTMLButtonElement, help: HTMLButtonElement) {
    field.value = this.core.state.passphrase;
    field.addEventListener("input", () => {
      localStorage.setItem("sc:passphrase", field.value);
      this.core.stdin({ action: "set-passphrase", args: field.value });
    });
    qr.innerHTML = qrCode;
    qr.addEventListener("click", () => this.showQrPopover(field.value));
    help.innerHTML = circleHelp;
    help.addEventListener("click", () => {
      field.value = "system-help";
      this.core.stdin({ action: "set-passphrase", args: "system-help" });
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
    this.core.render = (plaintext) => {
      textarea.value = plaintext;
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
      }, 200);
    });
    textarea.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("beforeunload", flush);
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

    this.core.onConnectionChange = (connected) => {
      passphraseConnect.classList.toggle("connected", connected);
      passphraseConnect.classList.toggle("disconnected", !connected);
      passphraseConnect.innerHTML = connected ? globe : globeOff;
      passphraseField.disabled = !connected;
      textarea.disabled = !connected;
    };

    passphraseConnect.addEventListener("click", () => {
      const action = this.core.connectionStatus === "disconnected" ? "connect" : "disconnect";
      this.core.stdin({ action });
    });

    this.initPassphraseField(passphraseField, passphraseQr, passphraseHelp);
    this.initHideShowIcon(passphraseField, toggle);
    this.initTextarea(textarea);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      this.core.connect();
    });
  }
}

const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
customElements.define("secure-clip", SecureClipElement);

navigator.serviceWorker?.register("/sw.js");
