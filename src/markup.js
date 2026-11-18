// The formats are inline: offsets use UTF-16, as do CodeMirror and DOM Ranges.
export const critic = {
  addition: ["{++", "++}"],
  deletion: ["{--", "--}"],
  substitution: ["{~~", "~~}"],
  comment: ["{>>", "<<}"],
  anchor: ["{==", "==}"]
};
export const colors = [
  "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "magenta", "black"
];
const opening = /\{(?:\+\+|--|~~|>>|==)|~=\{([^\s{}]+)\}/g;
const kinds = new Map(Object.entries(critic).map(([kind, [open]]) => [open, kind]));
const reserved = /\{(?:\+\+|--|~~|>>|==)|(?:\+\+|--|~~|<<|==)\}|~>|~=\{|=~/;
const escaped = (text, at) => {
  let count = 0;
  while (at > 0 && text[--at] === "\\") count++;
  return count % 2 !== 0;
};
const intersects = (from, to, ranges) => ranges.some(range => from < range.to && to > range.from);

export function scan(text, excluded = []) {
  const tokens = [];
  const starts = new RegExp(opening);
  const enabled = (at, length) => !intersects(at, at + length, excluded) && !escaped(text, at);
  function find(delimiter, start) {
    for (let pos = text.indexOf(delimiter, start); pos !== -1; pos = text.indexOf(delimiter, pos + 1)) {
      if (enabled(pos, delimiter.length)) return pos;
    }
    return -1;
  }
  for (let start; (start = starts.exec(text)); ) {
    const from = start.index;
    const bodyFrom = starts.lastIndex;
    if (!enabled(from, bodyFrom - from)) continue;
    const kind = start[1] ? "color" : kinds.get(start[0]);
    const close = kind === "color" ? "=~" : critic[kind][1];
    const bodyTo = find(close, bodyFrom);
    if (bodyTo <= bodyFrom) continue;
    const body = text.slice(bodyFrom, bodyTo);
    if (/[\r\n]/.test(body)) continue;
    // A stray opener before a valid same-kind token must not swallow it.
    const nested = find(start[0], bodyFrom);
    if (nested !== -1 && nested < bodyTo) continue;
    const to = bodyTo + close.length;
    const token = { kind, from, to, bodyFrom, bodyTo };
    if (kind === "color") token.color = start[1];
    if (kind === "substitution") {
      token.split = find("~>", bodyFrom);
      if (token.split <= bodyFrom || token.split + 2 >= bodyTo) continue;
    }
    tokens.push(token);
    starts.lastIndex = to;
  }
  return tokens;
}

export const containsMarkup = text => reserved.test(text);
const endSafe = value => {
  // A trailing backslash may escape the wrapper's closing delimiter.
  const tail = value.match(/\\+$/);
  return !tail || tail[0].length % 2 === 0;
};
export const canWrap = value => !/[\r\n]/.test(value) && !containsMarkup(value) && endSafe(value);

export const paletteProperty = name => "--har-palette-" + name;

export function defaultPaletteColor(name) {
  return name === "black" || name === "magenta" ? name : `var(--color-${name}, ${name})`;
}

export function colorValue(name) {
  if (colors.includes(name)) return `var(${paletteProperty(name)}, ${defaultPaletteColor(name)})`;
  return /^(?:[a-z]{1,30}|#[\da-f]{3,8})$/i.test(name) ? name : null;
}

export function trackMarkup(before, after) {
  if (before && after) return { prefix: "{~~" + before + "~>", suffix: "~~}" };
  if (after) return { prefix: "{++", suffix: "++}" };
  return { prefix: "{--" + before + "--}", suffix: "" };
}

export function reviewText(line, token, accept) {
  const {kind, bodyFrom, bodyTo, split} = token;
  if (kind === "substitution") return accept ? line.slice(split + 2, bodyTo) : line.slice(bodyFrom, split);
  if ((kind === "addition" && accept) || (kind === "deletion" && !accept)) return line.slice(bodyFrom, bodyTo);
  return "";
}

export const isChange = token => ["addition", "deletion", "substitution"].includes(token.kind);
export const pendingFrom = token => token.kind === "substitution" ? token.split + 2 : token.bodyFrom;

export function overlaps(token, from, to) {
  return from === to ? token.from < from && from < token.to : from < token.to && to > token.from;
}

export function trackedInRange(doc, from, to, context) {
  const matches = [];
  const last = doc.lineAt(to).number;
  for (let number = doc.lineAt(from).number; number <= last; number++) {
    const line = doc.line(number);
    const {block, excluded} = context(line);
    if (block) continue;
    for (const token of scan(line.text, excluded)) {
      if (isChange(token) && overlaps(token, from - line.from, to - line.from)) {
        matches.push({line, token});
      }
    }
  }
  return matches;
}

export function anchoredComments(tokens) {
  const comments = [];
  tokens.forEach((token, index) => {
    if (token.kind !== "comment") return;
    const previous = tokens[index - 1];
    const anchor = previous?.kind === "anchor" && previous.to === token.from ? previous : null;
    comments.push({token, anchor});
  });
  return comments;
}
