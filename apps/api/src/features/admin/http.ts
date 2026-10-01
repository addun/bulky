import { HttpException } from '@nestjs/common';
import type { z } from 'zod';

export function problem(status: number, message: string): never {
  throw new HttpException({ message }, status);
}

export function asResponse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}
