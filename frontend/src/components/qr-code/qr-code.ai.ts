import html from "./qr-code.ai.html?raw";
import css from "./qr-code.ai.css?raw";

import encodeQR from "qr";
import { frameLoop, frontalCamera, QRCanvas } from "qr/dom.js";

type Mode = "show" | "scan";

/**
 * <qr-code> popover. Call show(value) to display value as a QR code over a
 * backdrop. The Scan button switches to the camera; when a code is read the
 * popover closes and a "scan" CustomEvent<string> is dispatched with the
 * decoded text. Escape or a backdrop click dismisses it.
 */
export class QrCodeElement extends HTMLElement {
  shadow?: ShadowRoot;
  private value = "";
  private open = false;
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
    this.el("scan").addEventListener("click", () => this.setMode("scan"));
  }

  disconnectedCallback() {
    this.hide();
  }

  show(value: string) {
    this.value = value;
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
    this.el("scan").setAttribute("aria-pressed", String(mode === "scan"));
    if (mode === "show") this.renderQr();
    else this.startScan();
  }

  private renderQr() {
    const svg = encodeQR(this.value, "svg");
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

    let camera: Awaited<ReturnType<typeof frontalCamera>>;
    try {
      camera = await frontalCamera(video);
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

    const canvas = new QRCanvas();
    const cancelLoop = frameLoop(() => {
      // Wait until the video has a frame to decode.
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      // fullSize: the default squashes the whole frame into the (square)
      // element's size, distorting the code; decode at native resolution.
      const result = camera.readFrame(canvas, true);
      if (result === undefined) return;
      this.hide();
      this.dispatchEvent(new CustomEvent<string>("scan", { detail: result }));
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
