import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import { micromark } from "micromark";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import {
  gfmAutolinkLiteralFromMarkdown,
  gfmAutolinkLiteralToMarkdown,
} from "mdast-util-gfm-autolink-literal";
import type { Definition, Nodes, Root, RootContent } from "mdast";

/** All links must be replaced by a host-issued destination. Images never load. */
export function safeMarkdown(
  input: string,
  resolveLink: (url: string) => string | undefined,
): string {
  const limit = 100_000;
  const tree = fromMarkdown(input.slice(0, limit), {
    extensions: [gfmAutolinkLiteral()],
    mdastExtensions: [gfmAutolinkLiteralFromMarkdown()],
  });
  const definitions = new Map<string, Definition>();
  const key = (value: string) =>
    value.toLowerCase().replace(/\s+/g, " ").trim();
  function collect(node: Nodes): void {
    if (node.type === "definition") definitions.set(key(node.identifier), node);
    if ("children" in node) node.children.forEach((child) => collect(child));
  }
  collect(tree);
  function clean(node: Nodes, parent: Nodes): Nodes[] {
    if (node.type === "definition") return [];
    if (node.type === "image" || node.type === "imageReference")
      return [{ type: "text", value: node.alt ?? "" }];
    if (node.type === "html") {
      const text = { type: "text" as const, value: node.value };
      // Keep block/phrasing structure valid so escaping a block cannot collapse adjacent code or lists.
      return ["root", "blockquote", "listItem"].includes(parent.type)
        ? [{ type: "paragraph", children: [text] }]
        : [text];
    }
    if ("children" in node) {
      // Parsing determines node structure; replacement nodes contain only escaped text or safe links.
      node.children = node.children.flatMap((child) =>
        clean(child, node),
      ) as typeof node.children;
    }
    if (node.type === "link" || node.type === "linkReference") {
      const definition =
        node.type === "linkReference"
          ? definitions.get(key(node.identifier))
          : node;
      const destination = definition && resolveLink(definition.url);
      if (!destination) return node.children;
      return [
        {
          type: "link",
          url: destination,
          title: definition?.title,
          children: node.children,
        },
      ];
    }
    return [node];
  }
  tree.children = tree.children.flatMap((node) =>
    clean(node, tree),
  ) as RootContent[];
  if (input.length > limit)
    tree.children.push({
      type: "paragraph",
      children: [
        {
          type: "text",
          value: "Display truncated. Open Raw JSON for the full review output.",
        },
      ],
    });
  return toMarkdown(tree as Root, {
    extensions: [gfmAutolinkLiteralToMarkdown()],
  });
}

export function safeMarkdownHtml(
  input: string,
  resolveLink: (url: string) => string | undefined,
): string {
  return micromark(safeMarkdown(input, resolveLink), {
    allowDangerousHtml: false,
    allowDangerousProtocol: false,
  });
}

export function webLink(raw: string): string | undefined {
  if (/[\x00-\x20\x7f]/.test(raw)) return undefined;
  try {
    const url = new URL(raw);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
