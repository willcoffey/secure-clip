import html from "./qr-code.ai.html?raw";
import css from "./qr-code.ai.css?raw";

import encodeQR from "qr";
import { frameLoop, QRCanvas, rearCamera } from "qr/dom.js";
import { ClipboardPaste, Copy } from "lucide-static";

type Mode = "url" | "scan";

/** What a scanned share URL carries; each part only if present */
export type ScanDetail = {
  serverPath?: string;
  salt?: string;
  passphrase?: string;
};

/**
 * <qr-code> popover. Call show(passphrase, serverPath, salt) to display a QR
 * of the share URL, origin/<serverPath>/#s=<salt>, over a backdrop, with the
 * passphrase added (p) when the "with passphrase" checkbox is ticked; Copy
 * copies that same URL. The Scan button switches to the camera; when a share
 * URL is read (or pasted with Paste) the popover closes and a "scan"
 * CustomEvent<ScanDetail> is dispatched with its parts.
 * Escape or a backdrop click dismisses it.
 */
export class QrCodeElement extends HTMLElement {
  shadow?: ShadowRoot;
  private passphrase = "";
  private serverPath = "";
  private salt = "";
  private open = false;
  /** URL mode adds the passphrase to the QR'd URL */
  private withPassphrase = false;
  /** Stops the active camera + frame loop, if any */
  private stopScan?: () => void;
  /** Incremented on every mode change, so a slow camera start can tell it is stale */
  private scanToken = 0;

  private onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.hide();
  };

  connectedCallback() {
    this.shadow = this.attachShadow({ mode: "open" });
    this.shadow.adoptedStyleSheets = [sheet];
    this.shadow.innerHTML = html;

    this.el("backdrop").addEventListener("click", () => this.hide());
    // Clicks inside the panel shouldn't reach the backdrop's dismiss handler.
    this.el("panel").addEventListener("click", (e) => e.stopPropagation());
    this.el("url").addEventListener("click", () => this.setMode("url"));
    this.el("scan").addEventListener("click", () => this.setMode("scan"));
    // The checkbox, Copy and Paste sit inside the URL button, so their clicks
    // then bubble to it, which (re)renders URL mode.
    this.el("with-passphrase").addEventListener("click", () => {
      this.setWithPassphrase(!this.withPassphrase);
    });
    const copy = this.el("copy");
    const label = copy.querySelector(".label")!;
    copy.querySelector(".icon")!.innerHTML = Copy;
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(this.shareUrl());
      label.textContent = "Copied";
      setTimeout(() => (label.textContent = "Copy"), 1500);
    });
    const paste = this.el("paste");
    const pasteLabel = paste.querySelector(".label")!;
    paste.querySelector(".icon")!.innerHTML = ClipboardPaste;
    paste.addEventListener("click", async () => {
      // Denied or unavailable clipboard reads as "" and shows Invalid.
      const text = await navigator.clipboard?.readText().catch(() => "");
      if (this.emitScan(text ?? "")) return;
      pasteLabel.textContent = "Invalid";
      setTimeout(() => (pasteLabel.textContent = "Paste"), 1500);
    });
  }

  /** Closes and dispatches "scan" if text is a share URL; false otherwise */
  private emitScan(text: string): boolean {
    const detail = parseShareUrl(text.trim());
    if (!detail) return false;
    this.hide();
    this.dispatchEvent(new CustomEvent<ScanDetail>("scan", { detail }));
    return true;
  }

  disconnectedCallback() {
    this.hide();
  }

  show(passphrase: string, serverPath: string, salt: string) {
    this.passphrase = passphrase;
    this.serverPath = serverPath;
    this.salt = salt;
    // Start unchecked each time so the passphrase is never shared by accident.
    this.setWithPassphrase(false);
    this.el("backdrop").hidden = false;
    if (!this.open) document.addEventListener("keydown", this.onKeydown);
    this.open = true;
    this.setMode("url");
  }

  hide() {
    this.cancelScan();
    if (!this.shadow) return;
    this.el("backdrop").hidden = true;
    document.removeEventListener("keydown", this.onKeydown);
    this.open = false;
  }

  private setMode(mode: Mode) {
    this.cancelScan();
    this.el("url").setAttribute("aria-pressed", String(mode === "url"));
    this.el("scan").setAttribute("aria-pressed", String(mode === "scan"));
    if (mode === "url") this.renderQr(this.shareUrl());
    else this.startScan();
  }

  private setWithPassphrase(on: boolean) {
    this.withPassphrase = on;
    this.el("with-passphrase").setAttribute("aria-checked", String(on));
  }

  /** origin/<serverPath>/#s=<salt>, plus &p=<passphrase> when ticked */
  private shareUrl(): string {
    const fragment = new URLSearchParams({ s: this.salt });
    if (this.withPassphrase && this.passphrase) fragment.set("p", this.passphrase);
    return `${location.origin}${this.serverPath}/#${fragment}`;
  }

  private renderQr(text: string) {
    const svg = encodeQR(text, "svg");
    this.el("popover").innerHTML = svg.replace(
      ">",
      `><rect width="100%" height="100%" fill="#e8e4c8"/>`,
    );
  }

  private async startScan() {
    const token = this.scanToken;
    const popover = this.el("popover");
    const video = document.createElement("video");
    popover.replaceChildren(video);

    let camera: Awaited<ReturnType<typeof rearCamera>>;
    try {
      camera = await rearCamera(video);
    } catch (e) {
      if (token !== this.scanToken) return;
      const msg = document.createElement("p");
      msg.className = "message";
      msg.textContent = cameraError(e);
      popover.replaceChildren(msg);
      return;
    }

    // Mode changed or popover closed while waiting for camera permission.
    if (token !== this.scanToken) {
      camera.stop();
      return;
    }

    // Mirror unless the camera says it's rear-facing. Laptop webcams usually
    // report "user" or nothing; phone rear cameras report "environment".
    const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
    video.classList.toggle("mirror", track?.getSettings().facingMode !== "environment");

    const canvas = new QRCanvas();
    let reading = false;
    const cancelLoop = frameLoop(async () => {
      // Wait until the video has a frame, and for the previous read to finish.
      if (reading || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      reading = true;
      let result;
      try {
        // fullSize: the default squashes the whole frame into the (square)
        // element's size, distorting the code; decode at native resolution.
        result = await camera.readFrame(canvas, true);
      } catch {
        return; // A failed frame just means no code yet; try the next one.
      } finally {
        reading = false;
      }
      // Stopped (closed / switched mode) while this frame was decoding.
      if (token !== this.scanToken) return;
      // Result is a string, or one entry per detected code (string or Error).
      const text = typeof result === "string"
        ? result
        : result?.find((r): r is string => typeof r === "string");
      // Codes that aren't share URLs are ignored; keep scanning.
      if (text !== undefined) this.emitScan(text);
    });
    this.stopScan = () => {
      cancelLoop();
      camera.stop();
      video.srcObject = null;
    };
  }

  private cancelScan() {
    this.scanToken++;
    this.stopScan?.();
    this.stopScan = undefined;
  }

  private el(id: string): HTMLElement {
    return this.shadow!.getElementById(id)!;
  }
}

/**
 * Reads a share URL, host/<path>/#s=<salt>[&p=<passphrase>]. Undefined when
 * the text isn't a URL or carries neither salt nor passphrase.
 */
function parseShareUrl(text: string): ScanDetail | undefined {
  if (!URL.canParse(text)) return;
  const url = new URL(text);
  const share = new URLSearchParams(url.hash.slice(1));
  const detail = {
    serverPath: url.pathname.replace(/\/$/, "") || undefined,
    salt: share.get("s") || undefined,
    passphrase: share.get("p") || undefined,
  };
  return detail.salt || detail.passphrase ? detail : undefined;
}

/** Types the "scan" event on this element only, so listeners get ScanDetail */
export interface QrCodeElement {
  addEventListener(
    type: "scan",
    listener: (e: CustomEvent<ScanDetail>) => void,
  ): void;
  addEventListener(...args: Parameters<HTMLElement["addEventListener"]>): void;
}

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return "Camera permission denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found";
  if (!navigator.mediaDevices) return "Camera unavailable (requires HTTPS)";
  return "Could not start camera";
}

const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
customElements.define("qr-code", QrCodeElement);

/** Lets querySelector("qr-code") return a typed QrCodeElement */
declare global {
  interface HTMLElementTagNameMap {
    "qr-code": QrCodeElement;
  }
}
