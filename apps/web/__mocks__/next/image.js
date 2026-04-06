import { createElement } from "react";

export default function Image({ alt, src, ...props }) {
  const resolvedSrc = typeof src === "string" ? src : src?.src ?? "";

  return createElement("img", {
    alt,
    src: resolvedSrc,
    ...props,
  });
}
