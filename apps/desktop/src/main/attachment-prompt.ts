import { readFileSync } from "node:fs";
import type { CoreAgentImageInput, MessageAttachment } from "@geistr/core";

export interface AttachmentPromptInput { text: string; images?: CoreAgentImageInput[] }
export function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

export function buildAttachmentPrompt(text: string, attachments?: MessageAttachment[]): AttachmentPromptInput {
  if (!attachments?.length) return { text };
  const files = attachments.filter((file) => file.type !== "image");
  const images = attachments.filter((file) => file.type === "image").map(imageAttachmentToPiInput).filter((image): image is CoreAgentImageInput => Boolean(image));
  const notes: string[] = [];
  if (images.length > 0) notes.push(`Attached ${images.length} image${images.length === 1 ? "" : "s"}. Inspect the image input directly; do not ask the user to crop or compress it.`);
  if (files.length > 0) notes.push(`Attached files:\n${files.map((file) => `- ${file.name} (path: ${file.path}) [file]`).join("\n")}`);
  return { text: notes.length ? `${text.trim() ? text : "Please inspect the attached media."}\n\n---\n${notes.join("\n")}` : text, ...(images.length ? { images } : {}) };
}

function imageAttachmentToPiInput(file: MessageAttachment): CoreAgentImageInput | null {
  try {
    return { type: "image", mimeType: file.mimeType || "image/jpeg", data: readFileSync(file.path).toString("base64") };
  } catch { return null; }
}
