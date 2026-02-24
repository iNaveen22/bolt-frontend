export type BoltAction =
  | { kind: "file"; filePath: string; content: string }
  | { kind: "other"; raw: string };

export class BoltStreamParser {
  private buffer = "";
  private max = 400_000;

  pushToken(token: string): BoltAction[] {
    this.buffer += token;

    // prevent memory blowup
    if (this.buffer.length > this.max) {
      this.buffer = this.buffer.slice(-this.max);
    }

    return this.extract();
  }

  private extract(): BoltAction[] {
    const out: BoltAction[] = [];

    while (true) {
      const start = this.buffer.indexOf("<boltAction");
      if (start === -1) break;

      const tagEnd = this.buffer.indexOf(">", start);
      if (tagEnd === -1) break; // wait for more tokens

      const close = this.buffer.indexOf("</boltAction>", tagEnd + 1);
      if (close === -1) break; // wait for more tokens

      const openTag = this.buffer.slice(start, tagEnd + 1); // includes >
      const inner = this.buffer.slice(tagEnd + 1, close); // content only

      // remove parsed segment from buffer
      this.buffer = this.buffer.slice(close + "</boltAction>".length);

      // parse filePath attribute safely
      const fp = this.readAttr(openTag, "filePath");
      const type = this.readAttr(openTag, "type");

      if (type === "file" && fp) {
        out.push({ kind: "file", filePath: fp, content: inner });
      } else {
        out.push({ kind: "other", raw: openTag + inner });
      }
    }

    return out;
  }

  private readAttr(tag: string, attr: string): string | null {
    // supports filePath="x" and filePath='x' and spaces
    const re = new RegExp(`${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`);
    const m = tag.match(re);
    return m ? (m[2] ?? m[3] ?? null) : null;
  }
}