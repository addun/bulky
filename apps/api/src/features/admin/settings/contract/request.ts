import { z } from 'zod';

export const UpdateAdminSettingsRequest = z.object({
  ocr_model: z.string().trim().min(1, 'AI model is required.'),
  piece_unit_id: z.number().int().positive('Choose a unit from the list.'),
  weight_unit_id: z.number().int().positive('Choose a unit from the list.'),
});
