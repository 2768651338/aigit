import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { getExportDimensions, MAX_GIF_FRAMES, sanitizeFileName } from "./insights";

export type ExportFormat = "svg" | "png" | "gif" | "markdown" | "text";
export interface ExportFrame { canvas?: HTMLCanvasElement; rgba?: Uint8ClampedArray; svg?: SVGElement | string; width?: number; height?: number; }
export interface ExportRequest { format: ExportFormat; content?: string; svg?: SVGElement | string; canvas?: HTMLCanvasElement; frames?: ExportFrame[]; fileName?: string; width?: number; height?: number; scale?: number; frameRate?: number; }

function bytesFromDataUrl(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] || ""; const binary = atob(base64); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes;
}
function svgText(svg: SVGElement | string): string { return typeof svg === "string" ? svg : new XMLSerializer().serializeToString(svg); }
function extension(format: ExportFormat): string { return format === "text" ? "txt" : format; }
function defaultName(format: ExportFormat): string { return `insights-${new Date().toISOString().slice(0, 10)}.${extension(format)}`; }
function svgSize(source: string): { width: number; height: number } {
  const root = source.match(/<svg\b[^>]*>/i)?.[0] || "";
  const viewBox = root.match(/viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i);
  const width = Number(root.match(/\bwidth=["']([\d.]+)/i)?.[1]) || (viewBox ? Number(viewBox[1]) : 1200);
  const height = Number(root.match(/\bheight=["']([\d.]+)/i)?.[1]) || (viewBox ? Number(viewBox[2]) : 800);
  return { width: Math.max(1, width), height: Math.max(1, height) };
}
async function rasterizeSvg(source: string, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("无法创建 Canvas");
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("SVG 无法渲染")); });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`; await loaded;
  ctx.drawImage(image, 0, 0, width, height); return bytesFromDataUrl(canvas.toDataURL("image/png"));
}
async function rasterizeSvgRgba(source: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("无法创建 Canvas");
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("SVG 无法渲染")); });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`; await loaded;
  ctx.drawImage(image, 0, 0, width, height); return ctx.getImageData(0, 0, width, height).data;
}
async function frameRgba(frame: ExportFrame): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  if (frame.rgba) return { rgba: frame.rgba, width: frame.width || 1, height: frame.height || 1 };
  if (frame.canvas) { const ctx = frame.canvas.getContext("2d"); const data = ctx?.getImageData(0, 0, frame.canvas.width, frame.canvas.height).data; if (data) return { rgba: data, width: frame.canvas.width, height: frame.canvas.height }; }
  if (frame.svg) { const source = svgText(frame.svg); const size = svgSize(source); return { rgba: await rasterizeSvgRgba(source, size.width, size.height), width: size.width, height: size.height }; }
  throw new Error("GIF 帧缺少图像数据");
}
function resizeRgba(source: { rgba: Uint8ClampedArray; width: number; height: number }, width: number, height: number): Uint8ClampedArray {
  if (source.width === width && source.height === height && source.rgba.length === width * height * 4) return source.rgba;
  const canvas = document.createElement("canvas"); canvas.width = source.width; canvas.height = source.height;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("无法创建 Canvas");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(source.rgba), source.width, source.height), 0, 0);
  const out = document.createElement("canvas"); out.width = width; out.height = height; const outCtx = out.getContext("2d"); if (!outCtx) throw new Error("无法创建 Canvas");
  outCtx.drawImage(canvas, 0, 0, width, height); return outCtx.getImageData(0, 0, width, height).data;
}

export async function exportInsights(request: ExportRequest): Promise<string | null> {
  const path = await save({ defaultPath: request.fileName || defaultName(request.format), filters: [{ name: request.format.toUpperCase(), extensions: [extension(request.format)] }] });
  if (!path) return null;
  const format = request.format;
  if (format === "markdown" || format === "text") { await writeTextFile(path, request.content || ""); return path; }
  let bytes: Uint8Array;
  if (format === "svg") bytes = new TextEncoder().encode(svgText(request.svg || "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"));
  else if (format === "png") {
    const source = request.svg ? svgText(request.svg) : request.canvas ? undefined : undefined;
    const base = source ? svgSize(source) : { width: request.canvas?.width || request.width || 1200, height: request.canvas?.height || request.height || 800 };
    const dimensions = getExportDimensions(base.width, base.height, request.scale);
    if (source) bytes = await rasterizeSvg(source, dimensions.width, dimensions.height);
    else if (request.canvas) { const canvas = document.createElement("canvas"); canvas.width = dimensions.width; canvas.height = dimensions.height; const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("无法创建 Canvas"); ctx.drawImage(request.canvas, 0, 0, dimensions.width, dimensions.height); bytes = bytesFromDataUrl(canvas.toDataURL("image/png")); }
    else throw new Error("PNG 导出需要 SVG 或 Canvas");
  } else {
    const frames = (request.frames || []).slice(0, MAX_GIF_FRAMES); if (!frames.length) throw new Error("GIF 导出至少需要一帧");
    const first = await frameRgba(frames[0]); const dimensions = getExportDimensions(first.width, first.height, request.scale); const gif = GIFEncoder();
    for (const frame of frames) { const rgba = resizeRgba(await frameRgba(frame), dimensions.width, dimensions.height); const palette = quantize(rgba, 256); const index = applyPalette(rgba, palette); gif.writeFrame(index, dimensions.width, dimensions.height, { palette, delay: Math.max(20, 1000 / (request.frameRate || 8)), repeat: 0 }); }
    gif.finish(); bytes = gif.bytes();
  }
  await writeFile(path, bytes); return path;
}
export function makeExportFileName(repository: string, chart: string, format: ExportFormat): string { return `${sanitizeFileName(repository, "repository")}-${sanitizeFileName(chart, "insights")}-${new Date().toISOString().slice(0, 10)}.${extension(format)}`; }
