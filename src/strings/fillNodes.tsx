import { Fragment, type ReactNode } from "react";

/**
 * fill() for a text with an element in one of its holes: "browse {where}."
 * with a link as `where`. The sentence stays one string for the translator,
 * in whatever order the language puts the link. A hole with nothing to fill
 * it stays visible, as in fill().
 */
export function fillNodes(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((piece, index) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    const part = name === undefined ? undefined : parts[name];
    return <Fragment key={index}>{part === undefined ? piece : part}</Fragment>;
  });
}
