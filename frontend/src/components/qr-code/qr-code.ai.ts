import html from "./qr-code.ai.html?raw";
import css from "./qr-code.ai.css?raw";

import encodeQR from "qr";
import { frameLoop, QRCanvas, rearCamera } from "qr/dom.js";

type Mode = "show" | "url" | "scan";

/**
 * <qr-code> popover. Call show(value) to display value as a QR code over a
 * backdrop; the URL button shows a QR of this page's URL, with value added as
 * the passphrase (p) when its "include passphrase" checkbox is ticked. The
 * Scan button switches to the camera; when a code is read the popover closes
 * and a "scan" CustomEvent<string> is dispatched with the decoded text.
 * Escape or a backdrop click dismisses it.
 */
export class QrCodeElement extends HTMLElement {
  shadow?: ShadowRoot;
  private value = "";
  private url = "";
  private open = false;
  /** URL mode adds the passphrase to the QR'd URL */
  private includePassphrase = false;
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
    this.el("show").addEventListener("click", () => this.setMode("show"));
    this.el("url").addEventListener("click", () => this.setMode("url"));
    this.el("scan").addEventListener("click", () => this.setMode("scan"));
    // The checkbox sits inside the URL button, so this click then bubbles to
    // it, which (re)renders URL mode with the new setting.
    this.el("include-passphrase").addEventListener("click", () => {
      this.setIncludePassphrase(!this.includePassphrase);
    });
  }

  disconnectedCallback() {
    this.hide();
  }

  show(value: string) {
    this.value = value;
    this.url = location.href;
    // Start unchecked each time so the passphrase is never shared by accident.
    this.setIncludePassphrase(false);
    this.el("backdrop").hidden = false;
    if (!this.open) document.addEventListener("keydown", this.onKeydown);
    this.open = true;
    this.setMode("show");
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
    this.el("show").setAttribute("aria-pressed", String(mode === "show"));
    this.el("url").setAttribute("aria-pressed", String(mode === "url"));
    this.el("scan").setAttribute("aria-pressed", String(mode === "scan"));
    if (mode === "show") this.renderQr(this.value);
    else if (mode === "url") this.renderQr(this.shareUrl());
    else this.startScan();
  }

  private setIncludePassphrase(on: boolean) {
    this.includePassphrase = on;
    this.el("include-passphrase").setAttribute("aria-checked", String(on));
  }

  /** This page's URL, plus &p=<passphrase> in the fragment when ticked */
  private shareUrl(): string {
    if (!this.includePassphrase || !this.value) return this.url;
    const url = new URL(this.url);
    const fragment = new URLSearchParams(url.hash.slice(1));
    fragment.set("p", this.value);
    url.hash = fragment.toString();
    return url.href;
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
      if (text === undefined) return;
      this.hide();
      this.dispatchEvent(new CustomEvent<string>("scan", { detail: text }));
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
