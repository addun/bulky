import OpenAI, { APIError } from 'openai';
import { fileImage, filePDF, sniffFile } from './format';
import { prepareJPEG } from './image';
import { parseBill } from './parse';
import { pdfPageJPEGs } from './pdf';
import { imageUserPrompt, pageCaption, systemPrompt } from './prompt';
import {
  configured,
  DefaultBaseURL,
  marshalBill,
  MaxImageBytes,
  NoImageError,
  NoLinesError,
  NoModelError,
  NotABillError,
  NotConfiguredError,
  normalizeBaseURL,
  productLines,
  type Bill,
  type Config,
} from './types';

export class Agent {
  private constructor(
    private readonly cfg: Config,
    private readonly client: OpenAI,
  ) {}

  static create(cfg: Config): Agent {
    const next: Config = {
      APIKey: cfg.APIKey.trim(),
      BaseURL: normalizeBaseURL(cfg.BaseURL) || DefaultBaseURL,
      Model: cfg.Model.trim(),
    };
    const client = new OpenAI({
      apiKey: next.APIKey || 'sk-none',
      baseURL: next.BaseURL,
      timeout: 3 * 60 * 1000,
      maxRetries: 0,
    });
    return new Agent(next, client);
  }

  configured(): boolean {
    return configured(this.cfg);
  }

  withModel(model: string): Agent {
    return new Agent({ ...this.cfg, Model: model.trim() }, this.client);
  }

  async extract(file: Buffer): Promise<{ bill: Bill; rawJSON: Buffer }> {
    if (!this.configured()) throw new NotConfiguredError();
    if (this.cfg.Model === '') throw new NoModelError();
    if (file.length === 0) throw new NoImageError();
    if (file.length > MaxImageBytes) throw new Error('file must be 10 MB or smaller');
    switch (sniffFile(file)) {
      case filePDF:
        return this.extractPDF(file);
      case fileImage:
        return this.extractImage(file);
      default:
        throw new Error('file must be jpeg, png, webp, gif, or pdf');
    }
  }

  private async extractPDF(file: Buffer): Promise<{ bill: Bill; rawJSON: Buffer }> {
    const pages = await pdfPageJPEGs(file);
    return this.extractPreparedPages(pages);
  }

  private async extractImage(file: Buffer): Promise<{ bill: Bill; rawJSON: Buffer }> {
    const jpeg = await prepareJPEG(file);
    return this.extractPreparedPages([jpeg]);
  }

  private async extractPreparedPages(pages: Buffer[]): Promise<{ bill: Bill; rawJSON: Buffer }> {
    if (pages.length === 0) throw new NoImageError();
    const body = await this.chat(pages);
    return finishExtract(body);
  }

  private async chat(images: Buffer[]): Promise<Buffer> {
    const parts: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text: imageUserPrompt(images.length) },
    ];
    for (let i = 0; i < images.length; i++) {
      if (images.length > 1) {
        parts.push({ type: 'text', text: pageCaption(i, images.length) });
      }
      parts.push({
        type: 'image_url',
        image_url: {
          url: 'data:image/jpeg;base64,' + images[i]!.toString('base64'),
          detail: 'high',
        },
      });
    }
    return this.complete(this.cfg.Model, systemPrompt, parts);
  }

  private async complete(
    model: string,
    system: string,
    user: OpenAI.Chat.ChatCompletionContentPart[],
  ): Promise<Buffer> {
    let resp: OpenAI.Chat.ChatCompletion;
    try {
      resp = await this.client.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
    } catch (err) {
      if (err instanceof APIError) {
        let msg = (err.message ?? '').trim();
        if (msg === '') msg = String(err);
        throw new Error(`OCR model error: ${msg}`);
      }
      const wrapped = err instanceof Error ? err.message : String(err);
      throw new Error(`could not reach the OCR model: ${wrapped}`);
    }
    const content = resp.choices[0]?.message?.content?.trim() ?? '';
    if (content === '') throw new Error('OCR model returned no result');
    return Buffer.from(content);
  }
}

function finishExtract(body: Buffer): { bill: Bill; rawJSON: Buffer } {
  const bill = parseBill(body);
  const rawJSON = Buffer.from(marshalBill(bill));
  if (bill.NotABill) throw new NotABillError();
  if (productLines(bill).length === 0) throw new NoLinesError();
  return { bill, rawJSON };
}
