import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from './agent';
import { configured, type Bill, type Config } from './types';

@Injectable()
export class OcrService {
  private readonly agent: Agent;
  private readonly cfg: Config;

  constructor(config: ConfigService) {
    this.cfg = {
      APIKey: (config.get<string>('OCR_API_KEY') || config.get<string>('OPENAI_API_KEY') || '').trim(),
      BaseURL: (config.get<string>('OCR_BASE_URL') || '').trim(),
      Model: '',
    };
    this.agent = Agent.create(this.cfg);
  }

  configured(): boolean {
    return this.agent.configured() || configured(this.cfg);
  }

  withModel(model: string): Agent {
    return this.agent.withModel(model);
  }

  async extract(file: Buffer, model?: string): Promise<{ bill: Bill; rawJSON: Buffer }> {
    const agent = model ? this.agent.withModel(model) : this.agent;
    return agent.extract(file);
  }
}
