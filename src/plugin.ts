import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { build, createServer } from "vite";

// https://regex101.com/r/roeve3/9
const CODE_GROUP_REGEX =
  /(?:^\s*?::: code-group[^\S\r\n]+?preview((?:[^\S\r\n]+[a-zA-Z0-9._-]+(?:=[a-zA-Z0-9._-]+)?)+?)?\s*\n)((?:^\s*```[^\s]+[^\S\r\n]\[[^\]]+\]\s*?$.*?^\s*?```\s*?)+)(?:^\s*?:::\s*?$)/gms;

// https://regex101.com/r/DwMkgE/2
const FILE_REGEX =
  /(?:^\s*```[^\s]+[^\S\r\n]\[([^\s\]]+)\]\s*$)\s*(?:(^.+?$))\s*(?:```)/gms;

// https://regex101.com/r/jtvxto/1
const ATTRIBUTE_REGEX = /[^\S\r\n]+([a-zA-Z0-9._-]+)(?:=([a-zA-Z0-9._-]+))?/g;

const getPluginDir = (root: string) => {
  const pluginDir = path.join(root, ".vitepress", ".previews");
  return pluginDir;
};

const getTmpDir = (root: string) => {
  const tmpdir = path.join(getPluginDir(root), "cache");
  return tmpdir;
};

const getTemplatesDir = (root: string) => {
  const templatesDir = path.join(getPluginDir(root), "templates");
  return templatesDir;
};

const generateHash = (id: string, index: number) => {
  const hash = crypto.createHash("md5");
  hash.update(`${id}-${index}`);
  return hash.digest("hex");
};

const generatePreview = async (
  id: string,
  index: number,
  codeGroup: string,
  root: string,
  template?: string
) => {
  const previewId = generateHash(id, index);

  const tmpdir = getTmpDir(root);

  // Copy the template
  const previewDir = path.join(tmpdir, previewId);

  if (template) {
    const templateDir = path.join(getTemplatesDir(root), template);

    try {
      await fs.cp(templateDir, previewDir, {
        recursive: true,
        force: true,
      });
    } catch {
      // TODO: Error handling
    }
  }

  // Write the files
  const matches = codeGroup.matchAll(FILE_REGEX);

  for (const match of matches) {
    const file = match[1];
    const content = match[2];

    if (!file || !content) continue;

    const filePath = path.join(previewDir, file);

    await fs.writeFile(filePath, content.trim(), "utf-8");
  }

  return previewId;
};

const parseAttributes = (attributes?: string) => {
  const parsedAttributes: Record<string, string | true | undefined> = {};
  if (!attributes) return parsedAttributes;

  const matches = attributes.matchAll(ATTRIBUTE_REGEX);

  for (const match of matches) {
    const [_, attribute, value] = match;
    if (!attribute) continue;

    parsedAttributes[attribute] = typeof value === "undefined" ? true : value;
  }

  return parsedAttributes;
};

const transform = async (
  previews: Record<string, string[]>,
  id: string,
  src: string,
  root: string,
  {
    server,
    options,
  }: {
    server?: import("vite").ViteDevServer;
    options: ResolvedPreviewsPluginOptions;
  }
) => {
  if (!id.includes(".md")) return;

  // Remove the existing previews
  const existingPreviews = previews[id];

  if (existingPreviews) {
    for (const previewId of existingPreviews) {
      const tmpdir = getTmpDir(root);

      try {
        await fs.rm(path.join(tmpdir, previewId), {
          recursive: true,
          force: true,
        });
      } catch {
        // TODO: Error handling
      }
    }
  }

  // Add the new previews
  let content = src;

  const matches = content.matchAll(CODE_GROUP_REGEX);

  let index = 0;

  for (const match of matches) {
    try {
      const [root, attributes, body] = match;

      // Code groups must have a body
      if (!body) continue;

      const parsedAttributes = parseAttributes(attributes);

      // Fall back to the default template
      const template =
        parsedAttributes.template &&
        typeof parsedAttributes.template === "string"
          ? parsedAttributes.template
          : options?.defaultTemplate;

      // Remove the code group during replacement
      const replace = parsedAttributes.replace === true;

      const previewId = await generatePreview(
        id,
        index,
        body as string,
        root,
        template
      );

      previews[id] = previews[id] || [];
      previews[id].push(previewId);

      const src = getSrc(previewId, options, server);

      let replacement = "\n<Preview";
      replacement += ` src="${encodeURIComponent(src)}"`;

      // Add attributes
      if (!replace) replacement += " replace";

      replacement += " />\n";

      // Include the original
      if (!replace) replacement += root;

      content = content.replace(root, replacement);

      index++;
    } catch {
      // TODO: Error handling
    }
  }

  // TODO: Remove any previews that no longer exist

  if (content === src) return;

  return content;
};

const getSrc = (
  id: string,
  options: ResolvedPreviewsPluginOptions,
  server?: import("vite").ViteDevServer
) => {
  // Development - http://localhost:5173/:id/index.html
  if (server) {
    let src = server.config.server.https ? "https" : "http";
    src += "://localhost:" + server.config.server.port + "/";
    src += id + "/index.html";

    return src;
  }

  // Production - /_previews/:id/index.html
  let src = options.build.origin;
  src += options.build.base;
  src += id + "/index.html";

  return src;
};

const closeBundle = async (
  root: string,
  outDir: string,
  options: ResolvedPreviewsPluginOptions
) => {
  try {
    const tmpdir = getTmpDir(root);

    const entries = await fs.readdir(tmpdir);

    await build({
      root: tmpdir,
      base: options.build.base,
      ...options.vite,
      build: {
        emptyOutDir: true,
        outDir: path.isAbsolute(options.build.outDir)
          ? options.build.outDir
          : path.join(outDir, options.build.outDir),
        rollupOptions: {
          ...options?.vite?.build?.rollupOptions,
          input: entries.reduce((acc, id) => {
            acc[id] = path.join(tmpdir, id, "index.html");
            return acc;
          }, {} as Record<string, string>),
        },
        ...options.vite?.build,
      },
    });

    await fs.rm(tmpdir, { recursive: true, force: true });
  } catch (error) {
    // TODO: Error handling
  }
};

const buildStart = async (root: string) => {
  try {
    const tmpdir = getTmpDir(root);

    await fs.rm(tmpdir, { recursive: true, force: true });
  } catch {
    // TODO: Error handling
  }
};

const configureServer = async (
  root: string,
  options: ResolvedPreviewsPluginOptions
) => {
  const tmpdir = getTmpDir(root);

  try {
    await fs.access(tmpdir);
  } catch {
    await fs.mkdir(tmpdir, { recursive: true });
  }

  const server = await createServer({
    ...options.vite,
    root: tmpdir,
  });

  await server.listen();

  return server;
};

export interface PreviewsPluginOptions {
  /**
   * The Vite configuration to use for all previews.
   *
   * `build.emptyOutDir` will be set to `true` by default.
   *
   * `build.outDir` will be set based on `build.base`.
   */
  vite?: import("vite").UserConfig;

  /**
   * The default template to use for previews.
   *
   * This will be overridden by the template specified in the code group.
   */
  defaultTemplate?: string;

  build?: {
    /**
     * The origin of the previews in production.
     */
    origin?: string;

    /**
     * The base path of the previews in production.
     *
     * Defaults to `/` when the origin has been set, otherwise `/_previews/`.
     */
    base?: string;

    /**
     * Relative to the VitePress output directory, the output directory for the previews in production.
     *
     * Defaults to `_previews`.
     */
    outDir?: string;
  };
}

export interface ResolvedPreviewsPluginOptions extends PreviewsPluginOptions {
  build: {
    origin: string;
    base: string;
    outDir: string;
  };
}

const resolveOptions = (
  options?: PreviewsPluginOptions
): ResolvedPreviewsPluginOptions => {
  return {
    ...options,
    build: {
      ...options?.build,
      outDir: options?.build?.outDir ?? "_previews",
      base:
        options?.build?.base ?? (options?.build?.origin ? "/" : `/_previews/`),
      origin: options?.build?.origin ?? "",
    },
  };
};

export function PreviewsPlugin(
  options?: PreviewsPluginOptions
): import("vite").Plugin {
  const resolvedOptions = resolveOptions(options);

  let outDir: string;
  let root: string;
  let server: import("vite").ViteDevServer | undefined;

  let previews: Record<string, string[]> = {};

  return {
    name: "vitepress-plugin-preview",
    enforce: "pre",

    async configResolved(config) {
      outDir = config.build.outDir;
      root = config.root;
    },

    async transform(src, id) {
      // https://github.com/emersonbottero/vitepress-plugin-mermaid/blob/main/src/mermaid-plugin.ts#L39
      if (id.includes("vitepress/dist/client/app/index.js")) {
        src =
          "\nimport Preview from 'vitepress-plugin-previews/Preview.vue';\n" +
          src;

        const lines = src.split("\n");

        const targetLineIndex = lines.findIndex((line) =>
          line.includes("app.component")
        );

        lines.splice(
          targetLineIndex,
          0,
          '  app.component("Preview", Preview);'
        );

        src = lines.join("\n");

        return {
          code: src,
          map: null,
        };
      }

      return await transform(previews, id, src, root, {
        options: resolvedOptions,
        server,
      });
    },

    async configureServer() {
      server = await configureServer(root, resolvedOptions);
    },

    async buildStart() {
      await buildStart(root);
    },

    async closeBundle() {
      await server?.close();
      return await closeBundle(root, outDir, resolvedOptions);
    },
  };
}
