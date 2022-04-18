import * as yaml from "js-yaml";
import * as Handlebars from "handlebars";
import * as fs from "fs";

const defaultEncoding = "utf8";

export class FileHelpers {
  public static utf8(content: string): Buffer {
    return Buffer.from(content, defaultEncoding);
  }

  public static base64(base64String: string): Buffer {
    return Buffer.from(base64String, "base64");
  }

  public static empty(): Buffer {
    return Buffer.from("");
  }

  public static yaml(config: any): Buffer {
    const yamlContent = yaml.dump(config, {
      indent: 2,
    });
    return this.utf8(yamlContent);
  }

  public static json(jsonObject: any): Buffer {
    return this.utf8(JSON.stringify(jsonObject, null, 2));
  }

  public static content(
    content: string,
    encoding: BufferEncoding = defaultEncoding
  ): Buffer {
    return Buffer.from(content, encoding);
  }

  public static template(
    contentOrPath: string,
    ctx: any,
    encoding: BufferEncoding = defaultEncoding
  ): Buffer {
    const buffer = this.resolve(contentOrPath);
    return this.templateContentWithOptions(
      buffer.toString("utf8"),
      ctx,
      encoding,
      {}
    );
  }

  public static templateContent(
    content: string,
    ctx: any,
    encoding: BufferEncoding = defaultEncoding
  ): Buffer {
    return this.templateContentWithOptions(content, ctx, encoding, {});
  }

  public static templateContentWithOptions(
    content: string,
    ctx: any,
    encoding: BufferEncoding = defaultEncoding,
    options = {}
  ): Buffer {
    const generator = Handlebars.compile(content, options);
    const generatedContent = generator(ctx);
    return Buffer.from(generatedContent, encoding);
  }

  public static resolve(contentOrPath?: Buffer | string): Buffer {
    if (contentOrPath === undefined) return this.empty();

    if (typeof contentOrPath === "string") {
      return fs.readFileSync(contentOrPath);
    }

    return contentOrPath;
  }
}
