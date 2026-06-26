const MIN_PRODUCT_IMAGE_BYTES = 5 * 1024;
const MIN_PRODUCT_IMAGE_PX = 200;

const JUNK_URL_RE =
  /(?:favicon|icon|logo|sprite|spacer|pixel|1x1|placeholder|avatar|badge|arrow|chevron|social|share|menu|nav|button|tracking|blank|spinner|loader)/i;

const JUNK_MIME_RE = /^(image\/svg\+xml|image\/x-icon|image\/vnd\.microsoft\.icon)/i;

export type ImageDimensions = { width: number; height: number };

export function isJunkImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.endsWith(".svg") || lower.endsWith(".ico")) return true;
  if (JUNK_URL_RE.test(lower)) return true;
  return false;
}

export function isJunkImageElement(img: Element): boolean {
  const src = img.getAttribute("src") ?? "";
  if (!src || src.startsWith("data:image/svg")) return true;
  if (isJunkImageUrl(src)) return true;

  const alt = (img.getAttribute("alt") ?? "").toLowerCase();
  if (/(logo|icon|badge|avatar|menu|nav)/i.test(alt)) return true;

  const cls = (img.getAttribute("class") ?? "").toLowerCase();
  const id = (img.getAttribute("id") ?? "").toLowerCase();
  if (/(logo|icon|badge|avatar|nav|menu|header|footer|sprite|spacer)/i.test(`${cls} ${id}`)) {
    return true;
  }

  const w = parseInt(img.getAttribute("width") ?? "", 10);
  const h = parseInt(img.getAttribute("height") ?? "", 10);
  if ((w > 0 && w < MIN_PRODUCT_IMAGE_PX) || (h > 0 && h < MIN_PRODUCT_IMAGE_PX)) return true;

  const parent = img.parentElement;
  if (parent) {
    const tag = parent.tagName.toLowerCase();
    if (tag === "nav" || tag === "header" || tag === "footer" || tag === "button") return true;
    const parentCls = (parent.getAttribute("class") ?? "").toLowerCase();
    if (/(nav|menu|header|footer|breadcrumb|sidebar|toolbar|icon)/i.test(parentCls)) return true;
  }

  return false;
}

/** Read width/height from PNG or JPEG buffers; returns null if unknown. */
export function readImageDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null;

  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  // JPEG — scan for SOF0/SOF2
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const len = buffer.readUInt16BE(offset + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + len;
    }
  }

  // WebP (VP8X chunk)
  if (
    buffer.length >= 30 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return {
        width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
        height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
      };
    }
  }

  return null;
}

export type ProductImageRejectReason =
  | "too_small_file"
  | "too_small_dimensions"
  | "junk_mime"
  | "junk_url"
  | "svg_or_icon";

export function rejectProductImage(params: {
  buffer: Buffer;
  mime: string;
  url?: string;
}): ProductImageRejectReason | null {
  const { buffer, mime, url } = params;

  if (url && isJunkImageUrl(url)) return "junk_url";
  if (JUNK_MIME_RE.test(mime)) return "junk_mime";
  if (mime.includes("svg") || buffer.slice(0, 100).toString("utf8").trimStart().startsWith("<svg")) {
    return "svg_or_icon";
  }
  if (buffer.length < MIN_PRODUCT_IMAGE_BYTES) return "too_small_file";

  const dims = readImageDimensions(buffer);
  if (dims && (dims.width < MIN_PRODUCT_IMAGE_PX || dims.height < MIN_PRODUCT_IMAGE_PX)) {
    return "too_small_dimensions";
  }

  return null;
}

export function isUsableProductImage(params: {
  buffer: Buffer;
  mime: string;
  url?: string;
}): boolean {
  return rejectProductImage(params) === null;
}
