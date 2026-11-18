export function commentMarker(document) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "har-comment-marker har-annotation";
  button.setAttribute("aria-label", "Show comment");
  button.setAttribute("aria-haspopup", "dialog");
  return button;
}

export function placeFloating(element, rect, above = false) {
  const {innerWidth, innerHeight} = element.ownerDocument.defaultView;
  const {offsetWidth: width, offsetHeight: height} = element;
  const margin = 8;
  const gap = 6;
  const left = above ? (rect.left + rect.right - width) / 2 : rect.left;
  const before = rect.top - gap - height;
  const after = rect.bottom + gap;
  const top = above ? (before >= margin ? before : after) : (after + height <= innerHeight - margin ? after : before);
  element.style.left = Math.max(margin, Math.min(left, innerWidth - width - margin)) + "px";
  element.style.top = Math.max(margin, Math.min(top, innerHeight - height - margin)) + "px";
}
