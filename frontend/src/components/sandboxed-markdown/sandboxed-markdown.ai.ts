import html from "./sandboxed-markdown.ai.html?raw";
import css from "./sandboxed-markdown.ai.css?raw";
import { parse } from "../../lib/my-marked/src/markdown_compiler.ts";
import DEFAULT_THEME from "./theme.ai.css?raw";

/**
 * <sandboxed-markdown> renders untrusted markdown. Set `markdown` to update,
 * and optionally `theme` (a CSS string, trusted) to restyle; defaults to
 * theme.ai.css. Content is wrapped in <body class="markdown-body">.
 *
 * The HTML from parse() is treated as hostile and passed through unmodified.
 *  1. iframe sandbox (see .html), no tokens: no scripts, forms, popups, top
 *     navigation or same-origin access; can't touch our DOM or localStorage.
 *  2. CSP default-src 'none': no subresource requests (images, fonts, CSS
 *     url(), media, frames). Only inline styles.
 *  3. <base href="about:srcdoc">: srcdoc otherwise inherits our URL as its
 *     base, so "#footnote" links would load the app into the frame and
 *     relative links would hit our server. Now they stay in-document.
 * Not covered: the frame navigating itself (link click, meta refresh).
 */
export class SandboxedMarkdownElement extends HTMLElement {
  shadow?: ShadowRoot;
  private source = "";
  private css = DEFAULT_THEME;

  connectedCallback() {
    this.shadow = this.attachShadow({ mode: "open" });
    this.shadow.adoptedStyleSheets = [sheet];
    this.shadow.innerHTML = html;
    this.render();
  }

  get markdown(): string {
    return this.source;
  }

  set markdown(value: string) {
    this.source = value;
    this.render();
  }

  get theme(): string {
    return this.css;
  }

  set theme(value: string) {
    this.css = value;
    this.render();
  }

  private async render() {
    if (!this.shadow) return;
    const source = this.source;
    let body: string;
    try {
      body = await parse(source);
    } catch (e) {
      // Show the failure instead of silently keeping stale content.
      const pre = document.createElement("pre");
      pre.textContent = `Markdown parse error: ${e}`;
      body = pre.outerHTML;
    }
    // A newer value arrived while parsing; let that render win.
    if (source !== this.source) return;
    const frame = this.shadow.getElementById("frame") as HTMLIFrameElement;
    frame.srcdoc = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta charset="utf-8">
<base href="about:srcdoc">
<style>${this.css}</style>
<body class="markdown-body">${body}</body>`;
  }
}

const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
customElements.define("sandboxed-markdown", SandboxedMarkdownElement);

/** Lets querySelector("sandboxed-markdown") return a typed element */
declare global {
  interface HTMLElementTagNameMap {
    "sandboxed-markdown": SandboxedMarkdownElement;
  }
}
