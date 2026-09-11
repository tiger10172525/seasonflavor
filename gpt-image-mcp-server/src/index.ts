#!/usr/bin/env node
/**
 * Local MCP server that exposes OpenAI's gpt-image model (image generation
 * and image editing) as MCP tools over stdio.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import OpenAI, { APIError, toFile } from "openai";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const DEFAULT_OUTPUT_DIR = process.env.GPT_IMAGE_OUTPUT_DIR || "./generated-images";
const MAX_INLINE_IMAGES = 4; // cap how many images are echoed back as inline content

// Constructed even if the key is missing so the module loads cleanly; main()
// checks OPENAI_API_KEY and exits with a clear message before any tool runs.
const client = new OpenAI({ apiKey: OPENAI_API_KEY || "missing-api-key" });

// ---------------------------------------------------------------------------
// Shared enums / schemas
// ---------------------------------------------------------------------------

const SizeSchema = z
  .enum(["auto", "1024x1024", "1536x1024", "1024x1536"])
  .default("auto")
  .describe(
    "Image dimensions. 'auto' lets the model choose, '1024x1024' is square, " +
      "'1536x1024' is landscape, '1024x1536' is portrait."
  );

const QualitySchema = z
  .enum(["auto", "low", "medium", "high"])
  .default("auto")
  .describe("Rendering quality/effort. Higher quality costs more and takes longer.");

const BackgroundSchema = z
  .enum(["auto", "opaque", "transparent"])
  .default("auto")
  .describe("Background handling. 'transparent' requires output_format 'png' or 'webp'.");

const OutputFormatSchema = z
  .enum(["png", "jpeg", "webp"])
  .default("png")
  .describe("File format used to save the returned image(s) to disk.");

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function handleApiError(error: unknown): string {
  if (error instanceof APIError) {
    switch (error.status) {
      case 401:
        return "Error: Authentication failed. Check that OPENAI_API_KEY is set and valid.";
      case 403:
        return "Error: Permission denied. Your API key may lack access to image generation, " +
          "or the organization needs to complete identity verification for this model.";
      case 404:
        return `Error: Model '${IMAGE_MODEL}' was not found. Set OPENAI_IMAGE_MODEL to an ` +
          "available image model (e.g. 'gpt-image-1') if 'gpt-image-2' is not yet available " +
          "on your account.";
      case 429:
        return "Error: Rate limit or quota exceeded. Wait and retry, or check your OpenAI billing.";
      case 400:
        return `Error: Invalid request - ${error.message}`;
      default:
        return `Error: OpenAI API request failed (status ${error.status}): ${error.message}`;
    }
  }
  return `Error: Unexpected error occurred: ${error instanceof Error ? error.message : String(error)}`;
}

function extensionFor(format: string): string {
  return format === "jpeg" ? "jpg" : format;
}

function slugify(input: string, maxLen = 40): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+)|(-+$)/g, "");
  return (slug || "image").slice(0, maxLen);
}

interface SavedImage {
  path: string;
  b64: string;
}

async function saveGeneratedImages(
  images: Array<{ b64_json?: string | null }>,
  outputDir: string,
  prefix: string,
  outputFormat: string
): Promise<SavedImage[]> {
  await mkdir(outputDir, { recursive: true });
  const ext = extensionFor(outputFormat);
  const timestamp = Date.now();
  const saved: SavedImage[] = [];

  for (let i = 0; i < images.length; i++) {
    const b64 = images[i]?.b64_json;
    if (!b64) continue;
    const filename = `${prefix}-${timestamp}-${i + 1}.${ext}`;
    const filePath = path.join(outputDir, filename);
    await writeFile(filePath, Buffer.from(b64, "base64"));
    saved.push({ path: filePath, b64 });
  }
  return saved;
}

function mimeTypeFor(format: string): string {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function buildImageResultContent(
  saved: SavedImage[],
  outputFormat: string
): Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> {
  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [
    {
      type: "text",
      text:
        `Saved ${saved.length} image(s):\n` +
        saved.map((s) => `- ${s.path}`).join("\n") +
        (saved.length > MAX_INLINE_IMAGES
          ? `\n\n(Only the first ${MAX_INLINE_IMAGES} are attached inline below; the rest are on disk.)`
          : ""),
    },
  ];

  for (const s of saved.slice(0, MAX_INLINE_IMAGES)) {
    content.push({ type: "image", data: s.b64, mimeType: mimeTypeFor(outputFormat) });
  }

  return content;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "gpt-image-mcp-server",
  version: "1.0.0",
});

// --- Tool: generate_image ---------------------------------------------------

const GenerateImageInputSchema = z
  .object({
    prompt: z
      .string()
      .min(1, "Prompt is required")
      .max(32000, "Prompt must not exceed 32000 characters")
      .describe("Text description of the desired image."),
    n: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(1)
      .describe("Number of images to generate (1-10)."),
    size: SizeSchema,
    quality: QualitySchema,
    background: BackgroundSchema,
    output_format: OutputFormatSchema,
    output_directory: z
      .string()
      .default(DEFAULT_OUTPUT_DIR)
      .describe("Local directory to save the generated image file(s) into. Created if missing."),
    filename_prefix: z
      .string()
      .max(60)
      .optional()
      .describe("Optional prefix for saved filenames. Defaults to a slug of the prompt."),
  })
  .strict();

type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;

server.registerTool(
  "generate_image",
  {
    title: "Generate Image (gpt-image)",
    description: `Generate one or more images from a text prompt using OpenAI's ${IMAGE_MODEL} model, and save them to a local directory.

Args:
  - prompt (string, required): Text description of the desired image.
  - n (number): Number of images to generate, 1-10 (default: 1).
  - size ('auto' | '1024x1024' | '1536x1024' | '1024x1536'): Image dimensions (default: 'auto').
  - quality ('auto' | 'low' | 'medium' | 'high'): Rendering quality (default: 'auto').
  - background ('auto' | 'opaque' | 'transparent'): Background handling; 'transparent' needs output_format 'png' or 'webp' (default: 'auto').
  - output_format ('png' | 'jpeg' | 'webp'): File format for saved images (default: 'png').
  - output_directory (string): Where to save files (default: './generated-images').
  - filename_prefix (string, optional): Prefix for saved filenames.

Returns:
  Text listing the saved file path(s), plus inline image content for up to ${MAX_INLINE_IMAGES} of the generated images.

Errors:
  Returns a descriptive "Error: ..." message on auth failure, missing model access, rate limits, or invalid requests (e.g. content policy violations).`,
    inputSchema: GenerateImageInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params: GenerateImageInput) => {
    try {
      const response = await client.images.generate({
        model: IMAGE_MODEL,
        prompt: params.prompt,
        n: params.n,
        size: params.size,
        quality: params.quality,
        background: params.background,
        output_format: params.output_format,
      });

      const images = response.data ?? [];
      if (images.length === 0) {
        return { content: [{ type: "text", text: "Error: The API returned no images." }] };
      }

      const prefix = params.filename_prefix
        ? slugify(params.filename_prefix)
        : slugify(params.prompt);

      const saved = await saveGeneratedImages(
        images,
        params.output_directory,
        prefix,
        params.output_format
      );

      return { content: buildImageResultContent(saved, params.output_format) };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

// --- Tool: edit_image --------------------------------------------------------

const EditImageInputSchema = z
  .object({
    prompt: z
      .string()
      .min(1, "Prompt is required")
      .max(32000, "Prompt must not exceed 32000 characters")
      .describe("Instructions describing how to edit/combine the input image(s)."),
    image_paths: z
      .array(z.string())
      .min(1, "At least one image path is required")
      .max(16, "At most 16 input images are supported")
      .describe("Local file path(s) to the source image(s) (PNG/JPEG/WEBP, each < 25MB)."),
    mask_path: z
      .string()
      .optional()
      .describe(
        "Optional local path to a PNG mask (same dimensions as the first image) whose " +
          "transparent areas mark where the image should be edited."
      ),
    n: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(1)
      .describe("Number of edited variations to generate (1-10)."),
    size: SizeSchema,
    quality: QualitySchema,
    background: BackgroundSchema,
    output_directory: z
      .string()
      .default(DEFAULT_OUTPUT_DIR)
      .describe("Local directory to save the edited image file(s) into. Created if missing."),
    filename_prefix: z
      .string()
      .max(60)
      .optional()
      .describe("Optional prefix for saved filenames. Defaults to a slug of the prompt."),
  })
  .strict();

type EditImageInput = z.infer<typeof EditImageInputSchema>;

server.registerTool(
  "edit_image",
  {
    title: "Edit Image (gpt-image)",
    description: `Edit, inpaint, or combine existing local image(s) using OpenAI's ${IMAGE_MODEL} model, guided by a text prompt, and save the result(s) to a local directory.

Args:
  - prompt (string, required): Instructions describing the desired edit.
  - image_paths (string[], required): Local path(s) to source image(s); pass multiple to compose them.
  - mask_path (string, optional): Local path to a PNG mask marking (via transparency) the region to edit.
  - n (number): Number of variations to generate, 1-10 (default: 1).
  - size ('auto' | '1024x1024' | '1536x1024' | '1024x1536'): Image dimensions (default: 'auto').
  - quality ('auto' | 'low' | 'medium' | 'high'): Rendering quality (default: 'auto').
  - background ('auto' | 'opaque' | 'transparent'): Background handling (default: 'auto').
  - output_directory (string): Where to save files (default: './generated-images').
  - filename_prefix (string, optional): Prefix for saved filenames.

Returns:
  Text listing the saved file path(s) (always saved as PNG), plus inline image content for up to ${MAX_INLINE_IMAGES} of the resulting images.

Errors:
  Returns "Error: ..." if an input file can't be read, or on auth failure, rate limits, or invalid requests.`,
    inputSchema: EditImageInputSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params: EditImageInput) => {
    try {
      const imageFiles = [];
      for (const p of params.image_paths) {
        let buf: Buffer;
        try {
          buf = await readFile(p);
        } catch {
          return {
            content: [
              { type: "text", text: `Error: Could not read input image at '${p}'. Check the path exists and is readable.` },
            ],
          };
        }
        imageFiles.push(await toFile(buf, path.basename(p)));
      }

      let maskFile;
      if (params.mask_path) {
        let maskBuf: Buffer;
        try {
          maskBuf = await readFile(params.mask_path);
        } catch {
          return {
            content: [
              { type: "text", text: `Error: Could not read mask image at '${params.mask_path}'.` },
            ],
          };
        }
        maskFile = await toFile(maskBuf, path.basename(params.mask_path));
      }

      const response = await client.images.edit({
        model: IMAGE_MODEL,
        prompt: params.prompt,
        image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
        ...(maskFile ? { mask: maskFile } : {}),
        n: params.n,
        size: params.size,
        quality: params.quality,
        background: params.background,
      });

      const images = response.data ?? [];
      if (images.length === 0) {
        return { content: [{ type: "text", text: "Error: The API returned no images." }] };
      }

      const prefix = params.filename_prefix
        ? slugify(params.filename_prefix)
        : slugify(params.prompt);

      const saved = await saveGeneratedImages(images, params.output_directory, prefix, "png");

      return { content: buildImageResultContent(saved, "png") };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// Entry point (stdio transport - local use only)
// ---------------------------------------------------------------------------

async function main() {
  if (!OPENAI_API_KEY) {
    console.error("ERROR: OPENAI_API_KEY environment variable is required.");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`gpt-image-mcp-server running via stdio (model: ${IMAGE_MODEL})`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
