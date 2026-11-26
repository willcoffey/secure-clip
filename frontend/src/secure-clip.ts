import html from "./secure-clip.html?raw";
import css from "./secure-clip.css?raw";
import help from "./help.md?raw";

/** Components **/
import "./components/qr-code/qr-code.ai";
import "./components/sandboxed-markdown/sandboxed-markdown.ai";

/** SVG Icons */
import {
  CircleQuestionMark,
  Dices,
  Eye,
  EyeOff,
  FileText,
  Globe,
  GlobeOff,
  QrCode,
} from "lucide-static";

import { Crypt, SecureClip } from "./core";

class SecureClipElement extends HTMLElement {
  core = new SecureClip(
    {
      host: location.host,
      ssl: location.protocol === "https:",
      salt: document.querySelector<HTMLMetaElement>('meta[name="seclip-salt"]')?.content ?? "",
      transport: "socket",
    },
    localStorage.getItem("sc:passphrase") ?? Crypt.uint8ArrayToBase64(Crypt.randomBytes(16), false),
  );
  shadow?: ShadowRoot;
  /** Local presentation state; never sent to core */
  state = { markdown: false, help: false, showPassphrase: false };

  randomizePassphrase(field: HTMLInputElement) {
    const passphrase = Crypt.uint8ArrayToBase64(Crypt.randomBytes(16), false);
    field.value = passphrase;
    localStorage.setItem("sc:passphrase", passphrase);
    this.core.stdin({ command: "set-passphrase", body: passphrase });
  }

  initPassphraseField(field: HTMLInputElement, qr: HTMLButtonElement) {
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

    qr.innerHTML = QrCode;
    qr.addEventListener("click", () => this.shadow!.querySelector("qr-code")!.show(field.value));

    /**
     * Listen for events from qr-code scanning
     */
    this.shadow!.querySelector("qr-code")!.addEventListener("scan", (e) => {
      const passphrase = (e as CustomEvent<string>).detail;
      field.value = passphrase;
      localStorage.setItem("sc:passphrase", passphrase);
      this.core.stdin({ command: "set-passphrase", body: passphrase });
    });
  }

  initHideShowIcon(field: HTMLInputElement, toggle: HTMLButtonElement) {
    toggle.addEventListener("click", () => {
      this.state.showPassphrase = !this.state.showPassphrase;
      const show = this.state.showPassphrase;
      field.type = show ? "text" : "password";
      toggle.innerHTML = show ? EyeOff : Eye;
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
    const markdownToggle = this.shadow.getElementById("markdown-toggle") as HTMLButtonElement;
    const markdownView = this.shadow.querySelector("sandboxed-markdown")!;

    toggle.innerHTML = Eye;
    passphraseHelp.innerHTML = CircleQuestionMark;
    passphraseDice.innerHTML = Dices;
    passphraseConnect.classList.add("disconnected");
    passphraseConnect.innerHTML = GlobeOff;
    passphraseDice.addEventListener("click", () => this.randomizePassphrase(passphraseField));
    passphraseHelp.addEventListener("click", () => {
      this.state.help = !this.state.help;
      applyView();
    });

    passphraseConnect.addEventListener("click", () => {
      const command = this.core.state.connected ? "disconnect" : "connect";
      this.core.stdin({ command });
    });

    this.initPassphraseField(passphraseField, passphraseQr);
    this.initHideShowIcon(passphraseField, toggle);
    this.initTextarea(textarea);

    /** Initialize the mardkown button */
    markdownToggle.innerHTML = FileText;
    const applyView = () => {
      const { markdown: showMarkdown, help: showHelp } = this.state;
      const showRendered = showMarkdown || showHelp;
      if (showRendered) markdownView.markdown = showHelp ? help : textarea.value;
      markdownView.hidden = !showRendered;
      textarea.hidden = showRendered;
      passphraseHelp.setAttribute("aria-pressed", String(showHelp));
      markdownToggle.setAttribute("aria-pressed", String(showMarkdown));
      markdownToggle.setAttribute(
        "aria-label",
        showMarkdown ? "Hide rendered markdown" : "Show rendered markdown",
      );
    };
    markdownToggle.addEventListener("click", () => {
      this.state.markdown = !this.state.markdown;
      this.state.help = false;
      applyView();
    });

    this.core.render = (command) => {
      if (command === "set-plaintext" || command === "set-ciphertext") {
        textarea.value = this.core.state.plaintext;
        if (this.state.markdown && !this.state.help) {
          markdownView.markdown = this.core.state.plaintext;
        }
      } else if (command === "set-passphrase") {
        this.state.markdown = false;
        this.state.help = false;
        applyView();
      } else if (command === "socket-open" || command === "socket-close") {
        const connected = this.core.state.connected;
        passphraseConnect.classList.toggle("connected", connected);
        passphraseConnect.classList.toggle("disconnected", !connected);
        passphraseConnect.innerHTML = connected ? Globe : GlobeOff;
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
