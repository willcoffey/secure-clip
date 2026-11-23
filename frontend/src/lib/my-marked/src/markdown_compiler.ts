//@TODO - Css
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import markedFootnote from "marked-footnote";
import hljs from "highlight.js";

interface ParserState {
  marked: Marked;
}
const state: ParserState | { marked: false } = { marked: false };

/**
 * For setting up hljs to work with marked
 */
const HIGHLIGHT_CONFIG = {
  langPrefix: "hljs language-",
  highlight(code: string, lang: string) {
    const language = hljs.getLanguage(lang) ? lang : "plaintext";
    return hljs.highlight(code, { language }).value;
  },
};

/**
 * Creates an instance of marked with the extensions we are using
 */
function init() {
  //@ts-ignore
  const markedWithHighlight = new Marked(
    markedHighlight(HIGHLIGHT_CONFIG),
    markedFootnote(),
  );
  state.marked = markedWithHighlight;
}

async function parse(markdown: string): Promise<string> {
  if (!state.marked) init();
  if (!state.marked) throw ""; // Only needed for type narrowing, should be a better way

  return state.marked.parse(markdown);
}
export { parse };
