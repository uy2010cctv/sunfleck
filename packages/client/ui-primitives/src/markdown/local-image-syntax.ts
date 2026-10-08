/** Recover standalone image references without interpreting arbitrary HTML or changing source offsets. */
import type { Root, RootContent, PhrasingContent } from 'mdast'
import { classifyFileType } from '../FileTypeIcon.tsx'

declare module 'mdast' {
  interface ImageData {
    /** Recovered HTML image tags defer network requests until the message settles. */
    settledImageTag?: boolean
  }
}

/**
 * Recover unescaped image-only paragraphs with bare-space paths or simple img tags.
 * @param root - Parsed Markdown tree, modified in place.
 * @param source - Original source used to distinguish authored syntax from escaped examples.
 * @returns The same root with recovered image nodes.
 */
export function recoverLocalImages(root: Root, source: string): Root {
  const visit = (node: Root | RootContent): void => {
    if (node.type === 'root' || node.type === 'blockquote' || node.type === 'listItem') {
      node.children = node.children.map((child) => {
        if (child.type !== 'html') return child
        const image = simpleImageTag(child.value)
        return image === undefined ? child : { type: 'paragraph', position: child.position,
          children: [{ type: 'image', ...image, data: { settledImageTag: true }, position: child.position }] }
      })
    }
    if (node.type === 'paragraph' && node.children.length === 1) {
      const [child] = node.children as [PhrasingContent]
      if (child.type === 'html') {
        const image = simpleImageTag(child.value)
        if (image !== undefined) node.children = [{ type: 'image', ...image, data: { settledImageTag: true }, position: child.position }]
      }
      if (child.type === 'text' && child.position !== undefined
        && source.slice(child.position.start.offset, child.position.end.offset) === child.value) {
        const pattern = /^!\[([^\]\n]*)\]\(((?:\/(?!\/)|\.{1,2}\/|[a-z]:[\\/])[^\n<>()[\]"']+\.[a-z\d]+)\)$/iu
        const match = pattern.exec(child.value) as [string, string, string] | null
        if (match !== null && match[2].includes(' ') && classifyFileType(match[2]) === 'image') {
          node.children = [{ type: 'image', alt: match[1], url: match[2], position: child.position }]
        }
      }
    } else if ('children' in node) {
      for (const child of node.children) visit(child)
    }
  }
  visit(root)
  return root
}

/** Only one img tag with inert attributes can become a Markdown image; dimensions never control layout. */
function simpleImageTag(source: string): { url: string; alt: string } | undefined {
  const tag = /^<img\s+((?:(?:src|alt|width|height|title)\s*=\s*(?:"[^"<>\r\n]*"|'[^'<>\r\n]*'|\d+)\s*)+)\/?>(?:\n)?$/iu.exec(source)
  const attributeText = tag?.[1]
  if (attributeText === undefined) return undefined
  const attributes = new Map<string, string>()
  for (const match of attributeText.matchAll(/(src|alt|width|height|title)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)'|(\d+))/giu)) {
    const name = match[1]?.toLowerCase()
    const value = match[2] ?? match[3] ?? match[4]
    if (name === undefined || value === undefined || attributes.has(name)) return undefined
    attributes.set(name, value)
  }
  const url = attributes.get('src')
  if (url === undefined || url.trim() === '' || /^[\s\/]*\/\//u.test(url)
    || (/^[a-z][a-z\d+.-]*:/iu.test(url) && !/^(?:https?:\/\/|[a-z]:[\\/])/iu.test(url))) return undefined
  return { url, alt: attributes.get('alt') ?? '' }
}
